package syncjob

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
)

// FileStore is local runtime state, deliberately outside the database/.lnw
// format. It covers process restarts, not hostile filesystem writers or machine
// power-loss durability. One managed backend owns the application data directory.
type FileStore struct{ DataDir string }

const journalLimit = 8192

func (f FileStore) directory(create bool) (string, error) {
	if f.DataDir == "" {
		return "", ErrJournal
	}
	root, err := os.Lstat(f.DataDir)
	if err != nil || !root.IsDir() || root.Mode()&os.ModeSymlink != 0 {
		return "", ErrJournal
	}
	dir := filepath.Join(f.DataDir, "sync-runtime")
	if create {
		if err = os.Mkdir(dir, 0700); err != nil && !os.IsExist(err) {
			return "", ErrJournal
		}
	}
	info, err := os.Lstat(dir)
	if os.IsNotExist(err) && !create {
		return dir, nil
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", ErrJournal
	}
	return dir, nil
}
func (f FileStore) Load() (Snapshot, error) {
	dir, err := f.directory(false)
	if err != nil {
		return Snapshot{}, err
	}
	filename := filepath.Join(dir, "job.json")
	before, err := os.Lstat(filename)
	if os.IsNotExist(err) {
		return Empty(), nil
	}
	if err != nil || !before.Mode().IsRegular() || before.Mode()&os.ModeSymlink != 0 || before.Size() > journalLimit {
		return Snapshot{}, ErrJournal
	}
	file, err := os.Open(filename)
	if err != nil {
		return Snapshot{}, ErrJournal
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return Snapshot{}, ErrJournal
	}
	data, err := io.ReadAll(io.LimitReader(file, journalLimit+1))
	if err != nil || len(data) > journalLimit {
		return Snapshot{}, ErrJournal
	}
	var s Snapshot
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&s); err != nil {
		return Snapshot{}, ErrJournal
	}
	if dec.Decode(new(any)) != io.EOF {
		return Snapshot{}, ErrJournal
	}
	if err = s.Validate(); err != nil {
		return Snapshot{}, err
	}
	return s, nil
}
func (f FileStore) Save(s Snapshot) error {
	if err := s.Validate(); err != nil {
		return err
	}
	dir, err := f.directory(true)
	if err != nil {
		return err
	}
	target := filepath.Join(dir, "job.json")
	if info, e := os.Lstat(target); e == nil {
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return ErrJournal
		}
	} else if !os.IsNotExist(e) {
		return ErrJournal
	}
	data, err := json.Marshal(s)
	if err != nil || len(data) > journalLimit {
		return ErrJournal
	}
	tmp, err := os.CreateTemp(dir, ".job-*.partial")
	if err != nil {
		return ErrJournal
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err = tmp.Chmod(0600); err == nil {
		_, err = tmp.Write(data)
	}
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err != nil || closeErr != nil {
		return ErrJournal
	}
	// Never delete the previous marker before publishing its replacement.
	if err = os.Rename(name, target); err != nil {
		return ErrJournal
	}
	return nil
}
