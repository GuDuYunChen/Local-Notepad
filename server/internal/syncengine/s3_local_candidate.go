package syncengine

import (
	"context"
	"database/sql"
	"errors"
	"reflect"
	"time"
)

var (
	ErrS3LocalCandidateInput   = errors.New("本地联合读取的能力或预算无效")
	ErrS3LocalCandidateLimit   = errors.New("本地联合记录超过显式预算，未返回部分结果")
	ErrS3LocalCandidateChanged = errors.New("本地数据库或附件在交叉复核时不一致，未采用候选")
)

// S3LocalCandidateLimits retains the independent readers' limits and adds a
// combined record count (1..256) and canonical JSON budget (1..2MiB).
// Component budgets apply PER observation: at most two attachment passes read
// 2*(TotalFileBytes+Attachments) bytes including the growth-detection sentinels.
// This is not a total process-memory bound. All observations share ONE deadline.
type S3LocalCandidateLimits struct {
	Database         S3LocalDatabaseLimits
	Attachments      S3LocalAttachmentLimits
	Records          int
	TotalRecordBytes int64
}

// S3LocalCandidate is PRIVATE, locally sampled data, NOT an IPC-safe summary or
// an S3PlanRecordBasis. ObservedStable only means that the two bounded reads of
// EACH component agreed. They are NOT one atomic cross-resource transaction:
// changes after a component's final observation and ABA/timestamp restoration
// can escape detection. CompleteForPreview is always false, even when empty.
// StoredRemote* is copied without rebinding; it is not a trusted S3 pin or proof
// of provider/store ownership. A caller must establish those missing properties
// separately before authorizing a preview. This API never promotes the result.
type S3LocalCandidate struct {
	LocalRecords         map[string]string
	BaseItems            map[string]string
	StoredRemoteStoreID  string
	StoredRemoteRevision string
	AttachmentBytes      int64
	ObservedStable       bool
	CompleteForPreview   bool
}

// ReadS3LocalCandidate reads database D1, attachments A1, database D2, attachments
// A2, in that order, with no retry. An ordinary observed edit to either part,
// membership, common base or stored identity rejects the WHOLE candidate. Every
// component read finishes its own cleanup before the next begins. The existing
// readers are reused unchanged; only owned temporary handles/transactions are
// closed, never the borrowed db/root. No path lookup, default directory, DML,
// settings, network, provider, pin inference or automatic work is introduced.
//
// Validate ALL budgets/capabilities before the first I/O. The shared 5s or earlier
// caller deadline is not refreshed between observations; it cannot interrupt an
// uncooperative filesystem/driver syscall. Fixed component errors are preserved;
// any error or cancellation returns the zero value, not previously collected data.
func ReadS3LocalCandidate(ctx context.Context, db *sql.DB, root S3LocalAttachmentRoot, limits S3LocalCandidateLimits) (S3LocalCandidate, error) {
	zero := S3LocalCandidate{}
	if ctx == nil || db == nil || s3NilAttachmentRoot(root) || !s3AttachmentPlatform || !s3LocalCandidateLimitsValid(limits) {
		return zero, ErrS3LocalCandidateInput
	}
	call, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if call.Err() != nil {
		return zero, call.Err()
	}
	d1, err := ReadS3LocalDatabaseSnapshot(call, db, limits.Database)
	if err != nil {
		return zero, err
	}
	a1, err := ReadS3LocalAttachmentSnapshot(call, root, limits.Attachments)
	if err != nil {
		return zero, err
	}
	// Enforce the UNION budget, not merely each component's independent budget.
	if len(d1.DatabaseRecords)+len(a1.AttachmentRecords) > limits.Records {
		return zero, ErrS3LocalCandidateLimit
	}
	out := S3LocalCandidate{LocalRecords: make(map[string]string, len(d1.DatabaseRecords)+len(a1.AttachmentRecords)),
		BaseItems: make(map[string]string, len(d1.BaseItems)), StoredRemoteStoreID: d1.StoredRemoteStoreID,
		StoredRemoteRevision: d1.StoredRemoteRevision, AttachmentBytes: a1.ContentBytes}
	charged := int64(0)
	for _, records := range []map[string]string{d1.DatabaseRecords, a1.AttachmentRecords} {
		for id, raw := range records {
			if call.Err() != nil {
				return zero, call.Err()
			}
			if _, duplicate := out.LocalRecords[id]; duplicate {
				return zero, ErrS3LocalCandidateInput
			}
			if int64(len(raw)) > limits.TotalRecordBytes-charged {
				return zero, ErrS3LocalCandidateLimit
			}
			charged += int64(len(raw))
			out.LocalRecords[id] = raw
		}
	}
	for id, hash := range d1.BaseItems {
		out.BaseItems[id] = hash
	}
	d2, err := ReadS3LocalDatabaseSnapshot(call, db, limits.Database)
	if err != nil {
		return zero, err
	}
	sameDatabase := reflect.DeepEqual(d1, d2)
	if call.Err() != nil {
		return zero, call.Err()
	}
	if !sameDatabase {
		return zero, ErrS3LocalCandidateChanged
	}
	a2, err := ReadS3LocalAttachmentSnapshot(call, root, limits.Attachments)
	if err != nil {
		return zero, err
	}
	if call.Err() != nil {
		return zero, call.Err()
	}
	sameAttachments := reflect.DeepEqual(a1, a2)
	if call.Err() != nil {
		return zero, call.Err()
	}
	if !sameAttachments {
		return zero, ErrS3LocalCandidateChanged
	}
	out.ObservedStable = true
	return out, nil
}

func s3LocalCandidateLimitsValid(l S3LocalCandidateLimits) bool {
	d, a := l.Database, l.Attachments
	return l.Records >= 1 && l.Records <= 256 && l.TotalRecordBytes >= 1 && l.TotalRecordBytes <= 2*1024*1024 &&
		d.Records >= 1 && d.Records <= 128 && d.BaseItems >= 1 && d.BaseItems <= 128 &&
		d.RecordBytes >= 1 && d.RecordBytes <= 256*1024 && d.TotalRecordBytes >= 1 && d.TotalRecordBytes <= 1024*1024 &&
		a.Attachments >= 1 && a.Attachments <= 128 && a.FileBytes >= 1 && a.FileBytes <= 32*1024*1024 &&
		a.TotalFileBytes >= 1 && a.TotalFileBytes <= 64*1024*1024 && a.RecordBytes >= 1 && a.RecordBytes <= 256*1024 &&
		a.TotalRecordBytes >= 1 && a.TotalRecordBytes <= 1024*1024
}
