package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type Recovery struct {
	Source       string `json:"source"`
	PreservedDir string `json:"preservedDir"`
}

func copyExclusive(source, target string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	syncErr := out.Sync()
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if syncErr != nil {
		return syncErr
	}
	return closeErr
}

// Recover never deletes the original .db, WAL or SHM. A crash leaves a durable
// marker which main checks BEFORE opening (and potentially creating) data.db.
func Recover(ctx context.Context, dbPath string) (Recovery, error) {
	return recoverWithRename(ctx, dbPath, os.Rename)
}
func recoverWithRename(ctx context.Context, dbPath string, rename func(string, string) error) (Recovery, error) {
	var result Recovery
	if err := CheckPending(dbPath); err != nil {
		return result, err
	}
	entries, err := candidates(dbPath, false)
	if err != nil {
		return result, err
	}
	var staged string
	for _, item := range entries {
		source, e := ResolveName(dbPath, item.name)
		if e != nil {
			continue
		}
		info, e := Inspect(ctx, source)
		if e != nil {
			continue
		}
		tmp, e := os.CreateTemp(filepath.Dir(dbPath), ".restore-*.partial")
		if e != nil {
			return result, e
		}
		target := tmp.Name()
		tmp.Close()
		os.Remove(target)
		if e = copyExclusive(source, target); e != nil {
			os.Remove(target)
			continue
		}
		copied, e := Inspect(ctx, target)
		if e != nil || copied.SHA256 != info.SHA256 {
			os.Remove(target)
			continue
		}
		staged = target
		result.Source = item.name
		break
	}
	if staged == "" {
		return result, fmt.Errorf("没有通过完整性与版本校验的备份；原数据库保持不变")
	}
	defer os.Remove(staged)
	// Reject directories/symlinks before moving any of the user's files.
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if _, e := regular(dbPath + suffix); e != nil && !os.IsNotExist(e) {
			return result, e
		}
	}
	quarantine, err := os.MkdirTemp(filepath.Dir(dbPath), "recovery-preserved-")
	if err != nil {
		return result, err
	}
	result.PreservedDir = quarantine
	raw, _ := json.Marshal(result)
	marker, err := os.OpenFile(PendingPath(dbPath), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return result, err
	}
	_, err = marker.Write(raw)
	if err == nil {
		err = marker.Sync()
	}
	closeErr := marker.Close()
	if err != nil {
		return result, err
	}
	if closeErr != nil {
		return result, closeErr
	}
	// Keep a permanent receipt next to the preserved originals as well.
	if err = os.WriteFile(filepath.Join(quarantine, "recovery.json"), raw, 0600); err != nil {
		return result, err
	}
	moved := []string{}
	rollback := func(cause error) (Recovery, error) {
		for i := len(moved) - 1; i >= 0; i-- {
			original := dbPath + moved[i]
			if _, e := os.Lstat(original); !os.IsNotExist(e) {
				return result, fmt.Errorf("%v；回退受阻，请检查 %s（标记保留）", cause, quarantine)
			}
			if e := rename(filepath.Join(quarantine, filepath.Base(original)), original); e != nil {
				return result, fmt.Errorf("%v；回退失败: %w（标记保留）", cause, e)
			}
		}
		if e := os.Remove(PendingPath(dbPath)); e != nil {
			return result, fmt.Errorf("%v；恢复标记未清理: %w", cause, e)
		}
		return result, cause
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		source := dbPath + suffix
		if _, e := os.Lstat(source); os.IsNotExist(e) {
			continue
		} else if e != nil {
			return rollback(e)
		}
		if err = rename(source, filepath.Join(quarantine, filepath.Base(source))); err != nil {
			return rollback(err)
		}
		moved = append(moved, suffix)
	}
	if err = os.Link(staged, dbPath); err != nil {
		return rollback(err)
	}
	if err = os.Remove(PendingPath(dbPath)); err != nil {
		return result, fmt.Errorf("数据库已恢复但恢复标记清理失败: %w；请检查后再启动", err)
	}
	return result, nil
}
