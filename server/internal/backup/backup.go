// Package backup creates verified SQLite snapshots and preserves failed databases.
// Recovery is startup-only: callers must close the active database before Recover.
package backup

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const SupportedSchemaVersion = 10

var autoName = regexp.MustCompile(`^backup-(\d{8}-\d{6})(?:-[a-f0-9]{12})?\.db$`)
var safeName = regexp.MustCompile(`^backup-(?:manual-)?[a-zA-Z0-9-]+\.db$`)

type Info struct {
	Name          string `json:"name"`
	Size          int64  `json:"size"`
	Date          string `json:"date"`
	SHA256        string `json:"sha256"`
	Files         int64  `json:"files"`
	SchemaVersion int    `json:"schemaVersion"`
}

func PendingPath(dbPath string) string { return dbPath + ".recovery-pending" }
func CheckPending(dbPath string) error {
	if _, err := os.Lstat(PendingPath(dbPath)); err == nil {
		return fmt.Errorf("存在未完成恢复标记 %s；原文件已保留，请先检查恢复目录，未创建空数据库", PendingPath(dbPath))
	} else if !os.IsNotExist(err) {
		return err
	}
	return nil
}
func randomSuffix() (string, error) {
	var bytes [6]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

// URI parameters are encoded, including Windows drive paths, apostrophes and #.
func SQLiteURI(filename, mode string, immutable bool) (string, error) {
	absolute, err := filepath.Abs(filename)
	if err != nil {
		return "", err
	}
	p := filepath.ToSlash(absolute)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	u := url.URL{Scheme: "file", Path: p}
	q := url.Values{"mode": {mode}}
	if immutable {
		q.Set("immutable", "1")
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}
func regular(filename string) (os.FileInfo, error) {
	s, err := os.Lstat(filename)
	if err != nil {
		return nil, err
	}
	if !s.Mode().IsRegular() {
		return nil, fmt.Errorf("不是普通文件（不接受目录或符号链接）")
	}
	return s, nil
}
func digest(filename string) (string, error) {
	f, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func ResolveName(dbPath, name string) (string, error) {
	if !safeName.MatchString(name) || filepath.Base(name) != name {
		return "", fmt.Errorf("无效备份名称")
	}
	dir := filepath.Join(filepath.Dir(dbPath), "backups")
	s, err := os.Lstat(dir)
	if err != nil || !s.IsDir() || s.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("备份目录不可用或为符号链接")
	}
	filename := filepath.Join(dir, name)
	if _, err := regular(filename); err != nil {
		return "", err
	}
	return filename, nil
}

// Inspect is read-only. The digest is checked twice to reject changing files.
// Integrity and schema checks do not establish completeness of external attachments.
func Inspect(ctx context.Context, filename string) (Info, error) {
	var info Info
	before, err := regular(filename)
	if err != nil {
		return info, err
	}
	if before.Size() < 100 {
		return info, fmt.Errorf("备份为空或不是完整 SQLite 文件")
	}
	first, err := digest(filename)
	if err != nil {
		return info, err
	}
	uri, err := SQLiteURI(filename, "ro", true)
	if err != nil {
		return info, err
	}
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		return info, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	var integrity string
	if err = db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil {
		return info, err
	}
	if integrity != "ok" {
		return info, fmt.Errorf("SQLite 完整性检查未通过: %s", integrity)
	}
	// Requiring real tables prevents a valid but unrelated SQLite file being restored.
	var tables int
	if err = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('files','schema_migrations')`).Scan(&tables); err != nil || tables != 2 {
		return info, fmt.Errorf("不是受支持的记事本数据库")
	}
	rows, err := db.QueryContext(ctx, `SELECT id,title,content FROM files LIMIT 0`)
	if err != nil {
		return info, fmt.Errorf("笔记表结构不兼容: %w", err)
	}
	rows.Close()
	if err = db.QueryRowContext(ctx, `SELECT COALESCE(MAX(version),0) FROM schema_migrations`).Scan(&info.SchemaVersion); err != nil {
		return info, err
	}
	if info.SchemaVersion < 1 || info.SchemaVersion > SupportedSchemaVersion {
		return info, fmt.Errorf("数据库版本 %d 不受当前应用支持", info.SchemaVersion)
	}
	if info.SchemaVersion >= 10 {
		rows, schemaErr := db.QueryContext(ctx, `SELECT request_id,payload_sha256,file_id,title,parent_id,created_at FROM research_note_requests LIMIT 0`)
		if schemaErr != nil {
			return info, fmt.Errorf("研究任务回执表结构不兼容: %w", schemaErr)
		}
		rows.Close()
	}
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM files").Scan(&info.Files); err != nil {
		return info, err
	}
	if err = db.Close(); err != nil {
		return info, err
	}
	second, err := digest(filename)
	if err != nil {
		return info, err
	}
	after, err := regular(filename)
	if err != nil {
		return info, err
	}
	if first != second || !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return info, fmt.Errorf("校验期间文件发生变化，请重试")
	}
	info.Name, info.Size, info.Date, info.SHA256 = filepath.Base(filename), after.Size(), after.ModTime().UTC().Format(time.RFC3339Nano), second
	return info, nil
}

func Create(ctx context.Context, db *sql.DB, dbPath string, manual bool) (Info, error) {
	var zero Info
	if err := CheckPending(dbPath); err != nil {
		return zero, err
	}
	dir := filepath.Join(filepath.Dir(dbPath), "backups")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return zero, err
	}
	if s, err := os.Lstat(dir); err != nil || s.Mode()&os.ModeSymlink != 0 {
		return zero, fmt.Errorf("备份目录不可用或为符号链接")
	}
	suffix, err := randomSuffix()
	if err != nil {
		return zero, err
	}
	prefix := "backup-"
	if manual {
		prefix += "manual-"
	}
	name := prefix + time.Now().Format("20060102-150405") + "-" + suffix + ".db"
	staged, err := os.CreateTemp(dir, ".snapshot-*.partial")
	if err != nil {
		return zero, err
	}
	stage := staged.Name()
	staged.Close()
	defer os.Remove(stage)
	// SQLite accepts a bound filename. Never copy an active WAL database with fs.Copy.
	if _, err = db.ExecContext(ctx, "VACUUM INTO ?", stage); err != nil {
		return zero, fmt.Errorf("创建一致性快照失败: %w", err)
	}
	info, err := Inspect(ctx, stage)
	if err != nil {
		return zero, fmt.Errorf("新备份校验失败，未发布: %w", err)
	}
	// Explicit sync also covers older bundled SQLite versions.
	file, err := os.OpenFile(stage, os.O_RDWR, 0)
	if err != nil {
		return zero, err
	}
	err = file.Sync()
	closeErr := file.Close()
	if err != nil {
		return zero, err
	}
	if closeErr != nil {
		return zero, closeErr
	}
	target := filepath.Join(dir, name)
	// Hard-link publish is no-replace, on the same filesystem, and exposes only complete bytes.
	if err = os.Link(stage, target); err != nil {
		return zero, fmt.Errorf("发布备份失败，旧记录未改动: %w", err)
	}
	info.Name = name
	return info, nil
}

type candidate struct {
	name string
	at   time.Time
}

func candidates(dbPath string, automaticOnly bool) ([]candidate, error) {
	dir := filepath.Join(filepath.Dir(dbPath), "backups")
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	result := []candidate{}
	for _, e := range entries {
		if !e.Type().IsRegular() || !safeName.MatchString(e.Name()) {
			continue
		}
		m := autoName.FindStringSubmatch(e.Name())
		if automaticOnly && m == nil {
			continue
		}
		var at time.Time
		if m != nil {
			at, err = time.ParseInLocation("20060102-150405", m[1], time.Local)
		} else {
			s, e := e.Info()
			if e != nil {
				continue
			}
			at = s.ModTime()
			err = nil
		}
		if err != nil {
			continue
		}
		result = append(result, candidate{name: e.Name(), at: at})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].at.Equal(result[j].at) {
			return result[i].name > result[j].name
		}
		return result[i].at.After(result[j].at)
	})
	return result, nil
}

// Explicit manual snapshots are never pruned by automatic retention.
func Automatic(ctx context.Context, db *sql.DB, dbPath string) error {
	entries, err := candidates(dbPath, true)
	if err != nil {
		return err
	}
	if len(entries) > 0 && time.Since(entries[0].at) >= 0 && time.Since(entries[0].at) < 8*time.Hour {
		p, e := ResolveName(dbPath, entries[0].name)
		if e == nil {
			if _, e = Inspect(ctx, p); e == nil {
				return nil
			}
		}
	}
	if _, err = Create(ctx, db, dbPath, false); err != nil {
		return err
	}
	entries, err = candidates(dbPath, true)
	if err != nil {
		return err
	}
	for i := 100; i < len(entries); i++ {
		filename, e := ResolveName(dbPath, entries[i].name)
		if e != nil {
			continue
		}
		if e = os.Remove(filename); e != nil {
			return e
		}
	}
	return nil
}
