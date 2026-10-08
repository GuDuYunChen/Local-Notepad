package syncengine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"reflect"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrS3LocalAttachmentInput   = errors.New("本地附件盘点的目录能力或预算无效")
	ErrS3LocalAttachmentRead    = errors.New("未能完整读取本地附件盘点，未返回部分结果")
	ErrS3LocalAttachmentEntry   = errors.New("本地附件包含不支持的名称或文件类型")
	ErrS3LocalAttachmentLimit   = errors.New("本地附件盘点超过显式预算，未返回部分结果")
	ErrS3LocalAttachmentChanged = errors.New("本地附件在盘点期间发生变化，未采用结果")
)

// S3LocalAttachmentRoot is a BORROWED, already-authorized directory capability.
// The production caller must supply a traversal-resistant implementation such
// as *os.Root from the project's pinned Go toolchain. A pathname, os.DirFS or
// arbitrary callback is not a substitute for that security property. This API
// cannot authenticate an interface implementation. It never opens a root from
// a string, closes/reconfigures the borrowed root, or calls any write method.
// OpenFile must return a fresh owned handle and honor the requested flags.
type S3LocalAttachmentRoot interface {
	OpenFile(string, int, os.FileMode) (*os.File, error)
	Lstat(string) (os.FileInfo, error)
}

type S3LocalAttachmentLimits struct {
	Attachments      int   // 1..128; every directory entry counts, none are silently skipped.
	FileBytes        int64 // 1..32MiB; zero-length ordinary files are still read and hashed.
	TotalFileBytes   int64 // 1..64MiB across all files.
	RecordBytes      int64 // 1..256KiB per existing-engine canonical Record JSON.
	TotalRecordBytes int64 // 1..1MiB across canonical records.
}

// S3LocalAttachmentSnapshot contains PRIVATE names/metadata, never file bodies.
// It covers only the attachment directory, not the database, common base or a
// trusted remote pin. CompleteForPreview is always false. Matching directory
// listings and file identity/size/mode/mtime observations detect ordinary drift;
// they do NOT prove an atomic filesystem snapshot, prevent hostile timestamp
// restoration, or establish freshness after return. A root is not a hard-link,
// mount-point, provenance or device sandbox. Callers must authorize its contents.
type S3LocalAttachmentSnapshot struct {
	AttachmentRecords  map[string]string
	ContentBytes       int64
	CompleteForPreview bool
}

// ReadS3LocalAttachmentSnapshot inventories one level of an authorized root.
// No recursive traversal, creation of a missing directory, path-string fallback,
// cache, retry, network or database operation. It refuses ALL non-regular entries
// and nonportable names, including simple Unicode case-fold aliases within
// one inventory. No names are renamed, normalized or deduplicated. Unix opens
// use NOFOLLOW|NONBLOCK to refuse a last-moment symlink or FIFO without following/blocking on it; Windows names are restricted
// and the root capability must enforce containment. Only Linux/macOS/FreeBSD and
// Windows are supported; other platforms fail before directory I/O.
//
// The same 5s or earlier caller deadline covers enumeration, streaming hashes,
// canonical encoding and final verification. A 32KiB buffer bounds body memory;
// at most declared-size+1 bytes are read per file, and declared sizes are charged
// before opening bodies. The +1 detects growth. Budgets are not total OS/runtime
// memory or a guarantee to interrupt an uncooperative filesystem syscall.
// Every opened handle is closed on all paths. Any error/cancellation, including
// Close, discards the entire result and returns a fixed error/context sentinel.
func ReadS3LocalAttachmentSnapshot(ctx context.Context, root S3LocalAttachmentRoot, limits S3LocalAttachmentLimits) (S3LocalAttachmentSnapshot, error) {
	zero := S3LocalAttachmentSnapshot{}
	if ctx == nil || s3NilAttachmentRoot(root) || !s3AttachmentPlatform ||
		limits.Attachments < 1 || limits.Attachments > 128 ||
		limits.FileBytes < 1 || limits.FileBytes > 32*1024*1024 ||
		limits.TotalFileBytes < 1 || limits.TotalFileBytes > 64*1024*1024 ||
		limits.RecordBytes < 1 || limits.RecordBytes > 256*1024 ||
		limits.TotalRecordBytes < 1 || limits.TotalRecordBytes > 1024*1024 {
		return zero, ErrS3LocalAttachmentInput
	}
	call, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	names, directory, err := s3AttachmentNames(call, root, limits.Attachments)
	if err != nil {
		return zero, err
	}
	out := S3LocalAttachmentSnapshot{AttachmentRecords: make(map[string]string, len(names))}
	identities := make(map[string]os.FileInfo, len(names))
	metadataBytes := int64(0)
	buffer := make([]byte, 32*1024)
	for _, name := range names {
		if call.Err() != nil {
			return zero, call.Err()
		}
		raw, info, err := s3ReadLocalAttachment(call, root, name, limits.FileBytes, limits.TotalFileBytes-out.ContentBytes, buffer)
		if err != nil {
			return zero, err
		}
		if int64(len(raw)) > limits.RecordBytes || int64(len(raw)) > limits.TotalRecordBytes-metadataBytes {
			return zero, ErrS3LocalAttachmentLimit
		}
		metadataBytes += int64(len(raw))
		out.ContentBytes += info.Size()
		out.AttachmentRecords[attachmentItemKey(name)] = raw
		identities[name] = info
	}
	// Use entry names only: DirEntry.Info may resolve against a stale pathname on
	// older Go versions. All authoritative metadata is obtained through the root.
	finalNames, finalDirectory, err := s3AttachmentNames(call, root, limits.Attachments)
	if err != nil {
		return zero, err
	}
	if !s3SameAttachmentFile(directory, finalDirectory) || !reflect.DeepEqual(names, finalNames) {
		return zero, ErrS3LocalAttachmentChanged
	}
	for _, name := range names {
		if call.Err() != nil {
			return zero, call.Err()
		}
		info, err := root.Lstat(name)
		if err != nil {
			return zero, s3AttachmentError(call, ErrS3LocalAttachmentRead)
		}
		if !s3SameAttachmentFile(identities[name], info) {
			return zero, ErrS3LocalAttachmentChanged
		}
	}
	if call.Err() != nil {
		return zero, call.Err()
	}
	return out, nil
}

func s3NilAttachmentRoot(root S3LocalAttachmentRoot) bool {
	if root == nil {
		return true
	}
	v := reflect.ValueOf(root)
	switch v.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return v.IsNil()
	}
	return false
}

func s3LocalAttachmentName(name string) bool {
	if !utf8.ValidString(name) || !safeAttachmentName(name) || !s3ManifestID(attachmentItemKey(name)) ||
		strings.ContainsAny(name, "<>:\"|?*") || strings.TrimRight(name, " .") != name {
		return false
	}
	for _, r := range name {
		if r < 32 || r == 127 {
			return false
		}
	}
	stem := strings.ToUpper(strings.TrimRight(strings.SplitN(name, ".", 2)[0], " "))
	switch stem {
	case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$":
		return false
	}
	if len(stem) >= 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) {
		suffix := strings.TrimPrefix(strings.TrimPrefix(stem, "COM"), "LPT")
		if strings.Contains("123456789¹²³", suffix) && len([]rune(suffix)) == 1 {
			return false
		}
	}
	return true
}

// Local-only conservative name-set policy. Simple Unicode folding also catches
// aliases (for example K/kelvin-sign and sigma/final-sigma) that strings.ToLower
// equality misses. Callers cap seen at 128 and check context around each record.
// This is NOT filesystem collation/normalization, short-name or hard-link proof;
// a future writer still needs independent target-filesystem collision checks.
func s3LocalAttachmentNameAvailable(name string, seen []string) bool {
	if !s3LocalAttachmentName(name) {
		return false
	}
	for _, previous := range seen {
		if strings.EqualFold(name, previous) {
			return false
		}
	}
	return true
}

func s3AttachmentError(ctx context.Context, fallback error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return fallback
}
func s3SameAttachmentFile(a, b os.FileInfo) bool {
	return a != nil && b != nil && os.SameFile(a, b) && a.Mode() == b.Mode() &&
		a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
}
func s3AttachmentNames(ctx context.Context, root S3LocalAttachmentRoot, max int) (names []string, info os.FileInfo, err error) {
	if ctx.Err() != nil {
		return nil, nil, ctx.Err()
	}
	f, e := root.OpenFile(".", os.O_RDONLY|s3AttachmentOpenFlags, 0)
	if e != nil {
		return nil, nil, s3AttachmentError(ctx, ErrS3LocalAttachmentRead)
	}
	if f == nil {
		return nil, nil, ErrS3LocalAttachmentRead
	}
	defer func() {
		if f.Close() != nil {
			err = ErrS3LocalAttachmentRead
		}
		err = s3AttachmentError(ctx, err)
		if err != nil {
			names, info = nil, nil
		}
	}()
	info, e = f.Stat()
	if e != nil || !info.IsDir() {
		return nil, nil, ErrS3LocalAttachmentEntry
	}
	entries, e := f.ReadDir(max + 1)
	if e != nil && !errors.Is(e, io.EOF) {
		return nil, nil, ErrS3LocalAttachmentRead
	}
	if len(entries) > max {
		return nil, nil, ErrS3LocalAttachmentLimit
	}
	names = make([]string, 0, len(entries))
	for _, entry := range entries {
		if ctx.Err() != nil {
			return nil, nil, ctx.Err()
		}
		name := entry.Name()
		if !s3LocalAttachmentNameAvailable(name, names) || entry.Type()&os.ModeType != 0 {
			return nil, nil, ErrS3LocalAttachmentEntry
		}
		names = append(names, name)
	}
	sort.Strings(names)
	return names, info, nil
}

type s3AttachmentReader struct {
	ctx    context.Context
	source io.Reader
}

func (r s3AttachmentReader) Read(p []byte) (int, error) {
	if r.ctx.Err() != nil {
		return 0, r.ctx.Err()
	}
	return r.source.Read(p)
}
func s3ReadLocalAttachment(ctx context.Context, root S3LocalAttachmentRoot, name string, perFile, remaining int64, buffer []byte) (raw string, accepted os.FileInfo, err error) {
	before, e := root.Lstat(name)
	if e != nil {
		return "", nil, s3AttachmentError(ctx, ErrS3LocalAttachmentRead)
	}
	if before == nil || !before.Mode().IsRegular() || before.Size() < 0 {
		return "", nil, ErrS3LocalAttachmentEntry
	}
	if before.Size() > perFile || before.Size() > remaining {
		return "", nil, ErrS3LocalAttachmentLimit
	}
	if ctx.Err() != nil {
		return "", nil, ctx.Err()
	}
	f, e := root.OpenFile(name, os.O_RDONLY|s3AttachmentOpenFlags, 0)
	if e != nil {
		return "", nil, s3AttachmentError(ctx, ErrS3LocalAttachmentRead)
	}
	if f == nil {
		return "", nil, ErrS3LocalAttachmentRead
	}
	defer func() {
		if f.Close() != nil {
			err = ErrS3LocalAttachmentRead
		}
		err = s3AttachmentError(ctx, err)
		if err != nil {
			raw, accepted = "", nil
		}
	}()
	opened, e := f.Stat()
	if e != nil {
		return "", nil, ErrS3LocalAttachmentRead
	}
	if !opened.Mode().IsRegular() || !s3SameAttachmentFile(before, opened) {
		return "", nil, ErrS3LocalAttachmentChanged
	}
	hash := sha256.New()
	n, e := io.CopyBuffer(hash, io.LimitReader(s3AttachmentReader{ctx, f}, before.Size()+1), buffer)
	if e != nil {
		return "", nil, s3AttachmentError(ctx, ErrS3LocalAttachmentRead)
	}
	if n != before.Size() {
		return "", nil, ErrS3LocalAttachmentChanged
	}
	after, e := f.Stat()
	if e != nil {
		return "", nil, ErrS3LocalAttachmentRead
	}
	named, e := root.Lstat(name)
	if e != nil {
		return "", nil, s3AttachmentError(ctx, ErrS3LocalAttachmentRead)
	}
	if !s3SameAttachmentFile(before, after) || !s3SameAttachmentFile(after, named) {
		return "", nil, ErrS3LocalAttachmentChanged
	}
	encoded, _, e := encodeRecord(presentAttachmentRecord(AttachmentPayload{Name: name, Size: n, BlobHash: hex.EncodeToString(hash.Sum(nil))}))
	if e != nil {
		return "", nil, ErrS3LocalAttachmentEntry
	}
	if _, e = decodeS3Record(ctx, encoded, attachmentItemKey(name)); e != nil {
		return "", nil, s3AttachmentError(ctx, ErrS3LocalAttachmentEntry)
	}
	return string(encoded), after, nil
}
