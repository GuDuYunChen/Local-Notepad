package syncengine

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	staleLockAge = 15 * time.Minute
	RecordFormat   = "local-notepad-sync-record"
	RecordVersion  = 1
	ManifestFormat = "local-notepad-sync-manifest"
	ManifestVersion = 1
	ProviderLocalLab = "local-lab"
	ProviderWebDAV   = "webdav"
)

var objectHashPattern = regexp.MustCompile("^[a-f0-9]{64}$")
var manifestNamePattern = regexp.MustCompile("^([0-9]{20})-([a-f0-9]{64})\\.json$")

type FilePayload struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
	IsFolder  bool   `json:"is_folder"`
	ParentID  string `json:"parent_id"`
	SortOrder int64  `json:"sort_order"`
	IsDeleted bool   `json:"is_deleted"`
	DeletedAt int64  `json:"deleted_at"`
	IsPinned  bool   `json:"is_pinned"`
}

type TagPayload struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type FileTagPayload struct {
	FileID string `json:"file_id"`
	TagID  string `json:"tag_id"`
}

type AttachmentPayload struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	BlobHash string `json:"blob_hash"`
}

type Record struct {
	Format     string             `json:"format"`
	Version    int                `json:"version"`
	Kind       string             `json:"kind"`
	ID         string             `json:"id"`
	State      string             `json:"state"`
	File       *FilePayload       `json:"file,omitempty"`
	Tag        *TagPayload        `json:"tag,omitempty"`
	FileTag    *FileTagPayload    `json:"file_tag,omitempty"`
	Attachment *AttachmentPayload `json:"attachment,omitempty"`
}

type Manifest struct {
	Format     string            `json:"format"`
	Version    int               `json:"version"`
	StoreID    string            `json:"store_id"`
	Generation int64             `json:"generation"`
	UpdatedAt  string            `json:"updated_at"`
	DeviceID   string            `json:"device_id"`
	Items      map[string]string `json:"items"`
	Revision   string            `json:"-"`
}

type State struct {
	DeviceID      string `json:"device_id"`
	Provider      string `json:"provider"`
	Enabled       bool   `json:"enabled"`
	RemoteStoreID string `json:"remote_store_id"`
	RemoteRevision string `json:"remote_revision"`
	LastSyncAt    int64  `json:"last_sync_at"`
	LastStatus    string `json:"last_status"`
	LastError     string `json:"last_error"`
	BaseItems     int    `json:"base_items"`
	OpenConflicts int    `json:"open_conflicts"`
}

type PlanItem struct {
	ID         string `json:"id"`
	Action     string `json:"action"`
	BaseHash   string `json:"base_hash"`
	LocalHash  string `json:"local_hash"`
	RemoteHash string `json:"remote_hash"`
}

type Plan struct {
	StoreID        string     `json:"store_id"`
	Generation     int64      `json:"generation"`
	Revision       string     `json:"revision"`
	NeedsInit      bool       `json:"needs_init"`
	Uploads        int        `json:"uploads"`
	Downloads      int        `json:"downloads"`
	Conflicts      int        `json:"conflicts"`
	Noops          int        `json:"noops"`
	Items          []PlanItem `json:"items"`
}

type Conflict struct {
	ID         string `json:"id"`
	ItemID     string `json:"item_id"`
	BaseHash   string `json:"base_hash"`
	LocalHash  string `json:"local_hash"`
	RemoteHash string `json:"remote_hash"`
	LocalRecord *Record `json:"local_record,omitempty"`
	RemoteRecord *Record `json:"remote_record,omitempty"`
	CreatedAt  int64  `json:"created_at"`
	Status     string `json:"status"`
	Resolution string `json:"resolution"`
}

type RunResult struct {
	Plan       Plan `json:"plan"`
	AppliedUp  int  `json:"applied_uploads"`
	AppliedDown int `json:"applied_downloads"`
	Conflicts  int  `json:"conflicts"`
}

type AutoTickResult struct {
	Ran    bool      `json:"ran"`
	Reason string    `json:"reason"`
	Result RunResult `json:"result"`
}

type RemoteCheck struct {
	Provider    string `json:"provider"`
	Initialized bool   `json:"initialized"`
	StoreID     string `json:"store_id"`
	Generation  int64  `json:"generation"`
	Revision    string `json:"revision"`
	Items       int    `json:"items"`
}

type Engine struct {
	DB         *sql.DB
	DataDir    string
	RemoteRoot      string
	WebDAVPassword  string
	Now             func() time.Time
	runMu           sync.Mutex
}

type SyncRemote interface {
	AcquireLock() (*RemoteLock, error)
	SaveObject(hash string, data []byte) error
	LoadRecord(hash string) (Record, error)
	VerifyBlob(hash string, size int64) error
	SaveBlobFile(hash, source string, size int64) error
	MaterializeBlobExclusive(hash string, size int64, target string) error
	LoadManifest() (Manifest, error)
	SaveManifest(manifest Manifest) (Manifest, error)
}

func (e *Engine) now() time.Time {
	if e.Now != nil { return e.Now() }
	return time.Now()
}

func hashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func randomID(bytes int) (string, error) {
	raw := make([]byte, bytes)
	if _, err := rand.Read(raw); err != nil { return "", err }
	return hex.EncodeToString(raw), nil
}

func tagItemKey(id string) string { return "tag:" + id }
func fileTagItemKey(fileID, tagID string) string { return "filetag:" + fileID + ":" + tagID }
func attachmentItemKey(name string) string { return "attachment:" + hex.EncodeToString([]byte(name)) }

func safeAttachmentName(name string) bool {
	return name!="" && name!="." && name!=".." &&
		filepath.Base(name)==name && !strings.ContainsRune(name,'\x00') &&
		!strings.ContainsAny(name,"/\\")
}

func attachmentNameFromKey(key string) (string,bool) {
	if !strings.HasPrefix(key,"attachment:") { return "",false }
	raw,err:=hex.DecodeString(strings.TrimPrefix(key,"attachment:"))
	if err!=nil { return "",false }
	name:=string(raw)
	return name,safeAttachmentName(name)
}

func recordItemKey(record Record) (string,error) {
	switch record.Kind {
	case "file":
		if strings.TrimSpace(record.ID)=="" { return "",fmt.Errorf("文件同步对象 ID 为空") }
		return record.ID,nil
	case "tag":
		if record.Tag!=nil { return tagItemKey(record.Tag.ID),nil }
		if strings.HasPrefix(record.ID,"tag:") { return record.ID,nil }
	case "file-tag":
		if record.FileTag!=nil { return fileTagItemKey(record.FileTag.FileID,record.FileTag.TagID),nil }
		if strings.HasPrefix(record.ID,"filetag:") { return record.ID,nil }
	case "attachment":
		if record.Attachment!=nil { return attachmentItemKey(record.Attachment.Name),nil }
		if _,ok:=attachmentNameFromKey(record.ID);ok { return record.ID,nil }
	}
	return "",fmt.Errorf("同步对象键无效")
}

func kindForItemKey(key string) string {
	switch {
	case strings.HasPrefix(key,"tag:"): return "tag"
	case strings.HasPrefix(key,"filetag:"): return "file-tag"
	case strings.HasPrefix(key,"attachment:"): return "attachment"
	default: return "file"
	}
}

func normalizeRecord(record Record) (Record, error) {
	if record.Format != RecordFormat || record.Version != RecordVersion || strings.TrimSpace(record.ID)=="" {
		return Record{}, fmt.Errorf("同步对象格式无效")
	}
	if record.State!="present" && record.State!="purged" { return Record{},fmt.Errorf("同步对象状态无效") }
	if record.State=="purged" {
		if record.File!=nil||record.Tag!=nil||record.FileTag!=nil||record.Attachment!=nil {
			return Record{},fmt.Errorf("永久删除标记不能携带对象内容")
		}
		if kindForItemKey(record.ID)!=record.Kind { return Record{},fmt.Errorf("永久删除标记类型与键不一致") }
		return record,nil
	}
	switch record.Kind {
	case "file":
		if record.File==nil||record.File.ID!=record.ID||strings.TrimSpace(record.File.Title)=="" { return Record{},fmt.Errorf("同步文件对象无效") }
		if record.Tag!=nil||record.FileTag!=nil||record.Attachment!=nil { return Record{},fmt.Errorf("同步文件对象包含额外 payload") }
	case "tag":
		if record.Tag==nil||strings.TrimSpace(record.Tag.ID)==""||strings.TrimSpace(record.Tag.Name)==""||record.ID!=tagItemKey(record.Tag.ID) { return Record{},fmt.Errorf("同步标签对象无效") }
		if record.File!=nil||record.FileTag!=nil||record.Attachment!=nil { return Record{},fmt.Errorf("同步标签对象包含额外 payload") }
	case "file-tag":
		if record.FileTag==nil||record.FileTag.FileID==""||record.FileTag.TagID==""||record.ID!=fileTagItemKey(record.FileTag.FileID,record.FileTag.TagID) { return Record{},fmt.Errorf("同步标签关联对象无效") }
		if record.File!=nil||record.Tag!=nil||record.Attachment!=nil { return Record{},fmt.Errorf("同步标签关联对象包含额外 payload") }
	case "attachment":
		if record.Attachment==nil||!safeAttachmentName(record.Attachment.Name)||record.Attachment.Size<0||
			!objectHashPattern.MatchString(record.Attachment.BlobHash)||record.ID!=attachmentItemKey(record.Attachment.Name) {
			return Record{},fmt.Errorf("同步附件对象无效")
		}
		if record.File!=nil||record.Tag!=nil||record.FileTag!=nil { return Record{},fmt.Errorf("同步附件对象包含额外 payload") }
	default:
		return Record{},fmt.Errorf("未知同步对象类型: %s",record.Kind)
	}
	return record,nil
}

func encodeRecord(record Record) ([]byte, string, error) {
	record, err := normalizeRecord(record)
	if err != nil { return nil, "", err }
	data, err := json.Marshal(record)
	if err != nil { return nil, "", err }
	return data, hashBytes(data), nil
}

func presentRecord(file FilePayload) Record {
	return Record{Format:RecordFormat,Version:RecordVersion,Kind:"file",ID:file.ID,State:"present",File:&file}
}
func presentTagRecord(tag TagPayload) Record {
	id:=tagItemKey(tag.ID)
	return Record{Format:RecordFormat,Version:RecordVersion,Kind:"tag",ID:id,State:"present",Tag:&tag}
}
func presentFileTagRecord(link FileTagPayload) Record {
	id:=fileTagItemKey(link.FileID,link.TagID)
	return Record{Format:RecordFormat,Version:RecordVersion,Kind:"file-tag",ID:id,State:"present",FileTag:&link}
}
func presentAttachmentRecord(attachment AttachmentPayload) Record {
	id:=attachmentItemKey(attachment.Name)
	return Record{Format:RecordFormat,Version:RecordVersion,Kind:"attachment",ID:id,State:"present",Attachment:&attachment}
}
func purgedRecordForKey(key string) Record {
	return Record{Format:RecordFormat,Version:RecordVersion,Kind:kindForItemKey(key),ID:key,State:"purged"}
}

func stableFileDigest(filename string) (int64,string,error) {
	before,err:=os.Lstat(filename);if err!=nil{return 0,"",err}
	if !before.Mode().IsRegular()||before.Mode()&os.ModeSymlink!=0{return 0,"",fmt.Errorf("附件不是普通文件: %s",filepath.Base(filename))}
	file,err:=os.Open(filename);if err!=nil{return 0,"",err}
	h:=sha256.New();_,copyErr:=io.Copy(h,file);closeErr:=file.Close()
	if copyErr!=nil{return 0,"",copyErr};if closeErr!=nil{return 0,"",closeErr}
	after,err:=os.Lstat(filename);if err!=nil{return 0,"",err}
	if !os.SameFile(before,after)||before.Size()!=after.Size()||!before.ModTime().Equal(after.ModTime()){
		return 0,"",fmt.Errorf("附件在计算哈希期间发生变化: %s",filepath.Base(filename))
	}
	return after.Size(),hex.EncodeToString(h.Sum(nil)),nil
}


func (e *Engine) config(ctx context.Context) (enabled bool, provider, endpoint, username, password string, err error) {
	var flag int
	err = e.DB.QueryRowContext(ctx, `SELECT COALESCE(sync_enabled,0), COALESCE(sync_provider,''), COALESCE(sync_endpoint,''),
		COALESCE(sync_username,''), COALESCE(sync_password,'') FROM settings WHERE id=1`).
		Scan(&flag, &provider, &endpoint, &username, &password)
	if err != nil { return false, "", "", "", "", err }
	if e.WebDAVPassword != "" { password = e.WebDAVPassword }
	return flag != 0, provider, endpoint, username, password, nil
}

func (e *Engine) state(ctx context.Context) (State, error) {
	var state State
	var enabled int
	err := e.DB.QueryRowContext(ctx, `SELECT s.device_id, COALESCE(st.sync_provider,''), COALESCE(st.sync_enabled,0),
		s.remote_store_id, s.remote_revision, s.last_sync_at, s.last_status, s.last_error
		FROM sync_state s JOIN settings st ON st.id=1 WHERE s.id=1`).Scan(
		&state.DeviceID, &state.Provider, &enabled, &state.RemoteStoreID, &state.RemoteRevision,
		&state.LastSyncAt, &state.LastStatus, &state.LastError)
	if err != nil { return state, err }
	state.Enabled = enabled != 0
	if err = e.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM sync_base`).Scan(&state.BaseItems); err != nil { return state, err }
	if err = e.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM sync_conflicts WHERE status='open'`).Scan(&state.OpenConflicts); err != nil { return state, err }
	return state, nil
}

func (e *Engine) Status(ctx context.Context) (State, error) { return e.state(ctx) }

func (e *Engine) Rebind(ctx context.Context) (State, error) {
	tx, err := e.DB.BeginTx(ctx, nil)
	if err != nil { return State{}, err }
	defer tx.Rollback()
	now := e.now().Unix()
	if _, err = tx.ExecContext(ctx, `DELETE FROM sync_base`); err != nil { return State{}, err }
	if _, err = tx.ExecContext(ctx, `UPDATE sync_conflicts
		SET status='superseded',resolution='remote-rebind',resolved_at=?
		WHERE status='open'`, now); err != nil { return State{}, err }
	if _, err = tx.ExecContext(ctx, `UPDATE sync_state
		SET remote_store_id='',remote_revision='',last_sync_at=0,last_status='rebound',last_error=''
		WHERE id=1`); err != nil { return State{}, err }
	if _, err = tx.ExecContext(ctx, `UPDATE settings SET sync_auto_enabled=0 WHERE id=1`); err != nil { return State{}, err }
	if err = tx.Commit(); err != nil { return State{}, err }
	return e.state(ctx)
}

func (e *Engine) remoteWithPolicy(ctx context.Context, requireEnabled bool) (SyncRemote, error) {
	enabled, provider, endpoint, username, password, err := e.config(ctx)
	if err != nil { return nil, err }
	if requireEnabled && !enabled { return nil, fmt.Errorf("同步尚未启用") }
	if e.DataDir == "" { return nil, fmt.Errorf("同步数据目录未配置") }
	switch provider {
	case ProviderLocalLab:
		root := e.RemoteRoot
		if root == "" { root = filepath.Join(e.DataDir, "sync-lab-remote") }
		return NewDirRemote(root)
	case ProviderWebDAV:
		return newWebDAVRemoteContext(ctx, endpoint, username, password)
	default:
		return nil, fmt.Errorf("不支持的同步 provider: %s", provider)
	}
}

func (e *Engine) remote(ctx context.Context) (SyncRemote, error) {
	return e.remoteWithPolicy(ctx, true)
}

func (e *Engine) ensureUploadDir() (string,error) {
	dir:=filepath.Join(e.DataDir,"uploads")
	if err:=os.MkdirAll(dir,0700);err!=nil{return "",err}
	info,err:=os.Lstat(dir);if err!=nil{return "",err}
	if !info.IsDir()||info.Mode()&os.ModeSymlink!=0{return "",fmt.Errorf("附件目录不安全，拒绝同步")}
	return dir,nil
}

func (e *Engine) localRecords(ctx context.Context) (map[string]Record, error) {
	out:=map[string]Record{}
	rows,err:=e.DB.QueryContext(ctx,`SELECT id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned FROM files`)
	if err!=nil{return nil,err}
	for rows.Next(){
		var f FilePayload
		if err:=rows.Scan(&f.ID,&f.Title,&f.Content,&f.CreatedAt,&f.UpdatedAt,&f.IsFolder,&f.ParentID,&f.SortOrder,&f.IsDeleted,&f.DeletedAt,&f.IsPinned);err!=nil{rows.Close();return nil,err}
		out[f.ID]=presentRecord(f)
	}
	if err=rows.Close();err!=nil{return nil,err};if err=rows.Err();err!=nil{return nil,err}

	rows,err=e.DB.QueryContext(ctx,`SELECT id,name,color FROM tags`)
	if err!=nil{return nil,err}
	for rows.Next(){
		var tag TagPayload
		if err:=rows.Scan(&tag.ID,&tag.Name,&tag.Color);err!=nil{rows.Close();return nil,err}
		record:=presentTagRecord(tag);out[record.ID]=record
	}
	if err=rows.Close();err!=nil{return nil,err};if err=rows.Err();err!=nil{return nil,err}

	rows,err=e.DB.QueryContext(ctx,`SELECT file_id,tag_id FROM file_tags ORDER BY file_id,tag_id`)
	if err!=nil{return nil,err}
	for rows.Next(){
		var link FileTagPayload
		if err:=rows.Scan(&link.FileID,&link.TagID);err!=nil{rows.Close();return nil,err}
		record:=presentFileTagRecord(link);out[record.ID]=record
	}
	if err=rows.Close();err!=nil{return nil,err};if err=rows.Err();err!=nil{return nil,err}

	uploadDir,err:=e.ensureUploadDir();if err!=nil{return nil,err}
	entries,err:=os.ReadDir(uploadDir);if err!=nil{return nil,err}
	for _,entry:=range entries{
		if !safeAttachmentName(entry.Name())||entry.IsDir()||entry.Type()&os.ModeSymlink!=0{return nil,fmt.Errorf("附件目录包含不受支持的条目: %s",entry.Name())}
		size,hash,err:=stableFileDigest(filepath.Join(uploadDir,entry.Name()));if err!=nil{return nil,err}
		record:=presentAttachmentRecord(AttachmentPayload{Name:entry.Name(),Size:size,BlobHash:hash})
		out[record.ID]=record
	}
	return out,nil
}

func (e *Engine) base(ctx context.Context) (map[string]string, error) {
	rows, err := e.DB.QueryContext(ctx, `SELECT item_id, object_hash FROM sync_base`)
	if err != nil { return nil, err }
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, hash string
		if err := rows.Scan(&id, &hash); err != nil { return nil, err }
		out[id] = hash
	}
	return out, rows.Err()
}

func recordHash(record Record) (string, error) {
	_, hash, err := encodeRecord(record)
	return hash, err
}

func localRecordFor(id string, locals map[string]Record, base map[string]string) (Record, string, bool, error) {
	if record,ok:=locals[id];ok { hash,err:=recordHash(record);return record,hash,true,err }
	if _,hadBase:=base[id];hadBase {
		record:=purgedRecordForKey(id);hash,err:=recordHash(record);return record,hash,true,err
	}
	return Record{},"",false,nil
}

func unionIDs(locals map[string]Record, base map[string]string, remote map[string]string) []string {
	seen := map[string]bool{}
	ids := make([]string, 0, len(locals)+len(base)+len(remote))
	for id := range locals { seen[id] = true; ids = append(ids,id) }
	for id := range base { if !seen[id] { seen[id]=true; ids=append(ids,id) } }
	for id := range remote { if !seen[id] { seen[id]=true; ids=append(ids,id) } }
	sort.Strings(ids)
	return ids
}

func classifyItem(id, baseHash, localHash, remoteHash string, localExists bool) string {
	if kindForItemKey(id)=="attachment" && baseHash!="" {
		if localHash==remoteHash && remoteHash!="" { return "noop" }
		if localHash==baseHash && remoteHash==baseHash { return "noop" }
		// Attachment names become immutable slots once a common base exists.
		// Byte changes or deletion on either side require explicit resolution.
		return "conflict"
	}
	if localExists && localHash == remoteHash && remoteHash != "" { return "noop" }
	if baseHash == "" {
		if !localExists && remoteHash != "" { return "download" }
		if localExists && remoteHash == "" { return "upload" }
		if localExists && remoteHash != "" {
			if localHash == remoteHash { return "noop" }
			return "conflict"
		}
		return "noop"
	}
	if remoteHash == "" {
		// Protocol never removes known keys: purges are explicit objects.
		return "conflict"
	}
	if localHash == baseHash && remoteHash == baseHash { return "noop" }
	if localHash == baseHash && remoteHash != baseHash { return "download" }
	if remoteHash == baseHash && localHash != baseHash { return "upload" }
	if localHash == remoteHash { return "noop" }
	return "conflict"
}

func (e *Engine) buildPlan(ctx context.Context, remote SyncRemote, manifest Manifest) (Plan, map[string]Record, map[string]Record, map[string]string, error) {
	locals, err := e.localRecords(ctx)
	if err != nil { return Plan{}, nil,nil,nil,err }
	base, err := e.base(ctx)
	if err != nil { return Plan{}, nil,nil,nil,err }
	state, err := e.state(ctx)
	if err != nil { return Plan{}, nil,nil,nil,err }
	if state.RemoteStoreID != "" {
		if manifest.StoreID == "" { return Plan{},nil,nil,nil,fmt.Errorf("远端同步仓库已被清空或切换，拒绝自动覆盖") }
		if manifest.StoreID != state.RemoteStoreID { return Plan{},nil,nil,nil,fmt.Errorf("远端同步仓库身份发生变化，拒绝自动覆盖") }
	}
	plan := Plan{StoreID: manifest.StoreID, Generation: manifest.Generation, Revision: manifest.Revision, NeedsInit: manifest.StoreID==""}
	localResolved := map[string]Record{}
	remoteResolved := map[string]Record{}
	for _, id := range unionIDs(locals, base, manifest.Items) {
		local, localHash, localExists, err := localRecordFor(id, locals, base)
		if err != nil { return Plan{},nil,nil,nil,err }
		remoteHash := manifest.Items[id]
		action := classifyItem(id, base[id], localHash, remoteHash, localExists)
		item := PlanItem{ID:id,Action:action,BaseHash:base[id],LocalHash:localHash,RemoteHash:remoteHash}
		plan.Items = append(plan.Items,item)
		switch action {
		case "upload": plan.Uploads++; localResolved[id]=local
		case "download":
			plan.Downloads++
			record, err := remote.LoadRecord(remoteHash)
			if err != nil { return Plan{},nil,nil,nil,err }
			remoteResolved[id]=record
		case "conflict":
			plan.Conflicts++
			if localExists { localResolved[id]=local }
			if remoteHash != "" {
				record, err := remote.LoadRecord(remoteHash)
				if err != nil { return Plan{},nil,nil,nil,err }
				remoteResolved[id]=record
			}
		default: plan.Noops++
		}
	}
	if err := validateRemoteStructure(manifest, remote, remoteResolved); err != nil {
		return Plan{},nil,nil,nil,err
	}
	return plan, localResolved, remoteResolved, base, nil
}

func validateRemoteStructure(manifest Manifest, remote SyncRemote, cache map[string]Record) error {
	records:=map[string]Record{}
	for key,hash:=range manifest.Items{
		record,ok:=cache[key]
		if !ok { var err error;record,err=remote.LoadRecord(hash);if err!=nil{return err} }
		actual,err:=recordItemKey(record);if err!=nil{return err}
		if actual!=key{return fmt.Errorf("远端对象键与清单不一致: %s",key)}
		records[key]=record
	}
	activeNames:=map[string]string{}
	tagNames:=map[string]string{}
	for key,record:=range records{
		if record.State!="present"{continue}
		switch record.Kind{
		case "file":
			f:=record.File
			if f.ParentID==f.ID{return fmt.Errorf("远端文件层级包含自引用: %s",f.ID)}
			if f.ParentID!=""{
				parent,ok:=records[f.ParentID]
				if !ok||parent.State!="present"||parent.Kind!="file"||parent.File==nil||!parent.File.IsFolder{return fmt.Errorf("远端文件层级缺少有效父目录: %s",f.ID)}
			}
			if !f.IsDeleted{
				nameKey:=f.ParentID+"\x00"+strings.ToLower(f.Title)
				if previous,ok:=activeNames[nameKey];ok&&previous!=key{return fmt.Errorf("远端同一目录存在重复标题: %s",f.Title)}
				activeNames[nameKey]=key
			}
		case "tag":
			nameKey:=strings.ToLower(record.Tag.Name)
			if previous,ok:=tagNames[nameKey];ok&&previous!=key{return fmt.Errorf("远端存在重复标签名: %s",record.Tag.Name)}
			tagNames[nameKey]=key
		case "file-tag":
			fileRecord,fileOK:=records[record.FileTag.FileID]
			tagRecord,tagOK:=records[tagItemKey(record.FileTag.TagID)]
			if !fileOK||fileRecord.State!="present"||fileRecord.Kind!="file"||!tagOK||tagRecord.State!="present"||tagRecord.Kind!="tag"{
				return fmt.Errorf("远端标签关联引用不存在的文件或标签: %s",key)
			}
		case "attachment":
			if record.Attachment.Size<0||!objectHashPattern.MatchString(record.Attachment.BlobHash){return fmt.Errorf("远端附件元数据无效: %s",key)}
		}
	}
	for key,record:=range records{
		if record.State!="present"||record.Kind!="file"||record.File==nil||!record.File.IsFolder{continue}
		seen:=map[string]bool{record.File.ID:true}
		parent:=record.File.ParentID
		for parent!=""{
			if seen[parent]{return fmt.Errorf("远端文件夹层级存在循环: %s",key)}
			seen[parent]=true
			p:=records[parent]
			if p.File==nil{break}
			parent=p.File.ParentID
		}
	}
	return nil
}

func (e *Engine) checkRemoteUnlocked(ctx context.Context) (RemoteCheck,error) {
	remote,err:=e.remoteWithPolicy(ctx,false)
	if err!=nil{return RemoteCheck{},err}
	manifest,err:=remote.LoadManifest()
	if err!=nil{return RemoteCheck{},err}
	state,err:=e.state(ctx)
	if err!=nil{return RemoteCheck{},err}
	if state.RemoteStoreID!=""{
		if manifest.StoreID==""{return RemoteCheck{},fmt.Errorf("远端同步仓库已被清空或切换")}
		if manifest.StoreID!=state.RemoteStoreID{return RemoteCheck{},fmt.Errorf("远端同步仓库身份发生变化")}
	}
	if manifest.StoreID!=""{
		if err=validateRemoteStructure(manifest,remote,nil);err!=nil{return RemoteCheck{},fmt.Errorf("远端结构校验失败: %w",err)}
	}
	return RemoteCheck{
		Provider:state.Provider,
		Initialized:manifest.StoreID!="",
		StoreID:manifest.StoreID,
		Generation:manifest.Generation,
		Revision:manifest.Revision,
		Items:len(manifest.Items),
	},nil
}

func (e *Engine) CheckRemote(ctx context.Context) (RemoteCheck,error) {
	e.runMu.Lock()
	defer e.runMu.Unlock()
	return e.checkRemoteUnlocked(ctx)
}

func (e *Engine) ConfigureAuto(ctx context.Context, enabled bool, intervalMinutes int) (State,error) {
	if intervalMinutes < 1 || intervalMinutes > 1440 {
		return State{},fmt.Errorf("自动同步间隔必须在 1 到 1440 分钟之间")
	}
	e.runMu.Lock()
	defer e.runMu.Unlock()
	state,err:=e.state(ctx)
	if err!=nil{return State{},err}
	if enabled {
		if !state.Enabled || state.Provider!=ProviderWebDAV {
			return State{},fmt.Errorf("自动同步仅可在已启用的 WebDAV provider 上使用")
		}
		if _,err=e.checkRemoteUnlocked(ctx);err!=nil{
			return State{},fmt.Errorf("开启自动同步前远端验证失败: %w",err)
		}
	}
	if _,err=e.DB.ExecContext(ctx,`UPDATE settings SET sync_auto_enabled=?,sync_interval_minutes=? WHERE id=1`,enabled,intervalMinutes);err!=nil{
		return State{},err
	}
	return e.state(ctx)
}

func (e *Engine) Plan(ctx context.Context) (Plan, error) {
	remote, err := e.remote(ctx)
	if err != nil { return Plan{}, err }
	manifest, err := remote.LoadManifest()
	if err != nil { return Plan{}, err }
	plan,_,_,_,err := e.buildPlan(ctx,remote,manifest)
	return plan, err
}

func (e *Engine) ensureStoreID(manifest *Manifest) error {
	if manifest.StoreID != "" { return nil }
	id, err := randomID(16)
	if err != nil { return err }
	manifest.StoreID = id
	return nil
}

func conflictID(item PlanItem) string {
	raw := item.ID+"\x00"+item.BaseHash+"\x00"+item.LocalHash+"\x00"+item.RemoteHash
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:16])
}

func nullableRecord(record Record, ok bool) string {
	if !ok { return "" }
	data,_ := json.Marshal(record)
	return string(data)
}

type sqlExecer interface {
	ExecContext(context.Context, string, ...interface{}) (sql.Result, error)
}

func (e *Engine) storeConflictWith(exec sqlExecer, ctx context.Context, item PlanItem, local Record, localOK bool, remote Record, remoteOK bool) error {
	// A conflict ID identifies one open lifecycle, not just its version tuple.
	// Reusing an old superseded/resolved ID loses A -> B -> A conflicts and can
	// revive a previously reviewed request. Identical still-open tuples keep
	// their existing ID (including legacy deterministic IDs); history is kept.
	id, err := randomID(16)
	if err != nil {
		return err
	}
	now := e.now().Unix()
	_, err = exec.ExecContext(ctx, `UPDATE sync_conflicts SET status='superseded', resolved_at=?
		WHERE item_id=? AND status='open' AND NOT (base_hash=? AND local_hash=? AND remote_hash=?)`,
		now, item.ID, item.BaseHash, item.LocalHash, item.RemoteHash)
	if err != nil {
		return err
	}
	_, err = exec.ExecContext(ctx, `INSERT INTO sync_conflicts
		(id,item_id,base_hash,local_hash,remote_hash,local_record,remote_record,created_at,status,resolution,resolved_at)
		SELECT ?,?,?,?,?,?,?,?,'open','',0
		WHERE NOT EXISTS (SELECT 1 FROM sync_conflicts WHERE item_id=? AND status='open'
			AND base_hash=? AND local_hash=? AND remote_hash=?)`,
		id, item.ID, item.BaseHash, item.LocalHash, item.RemoteHash, nullableRecord(local, localOK), nullableRecord(remote, remoteOK), now,
		item.ID, item.BaseHash, item.LocalHash, item.RemoteHash)
	return err
}

func (e *Engine) storeConflict(ctx context.Context, item PlanItem, local Record, localOK bool, remote Record, remoteOK bool) error {
	tx, err := e.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = e.storeConflictWith(tx, ctx, item, local, localOK, remote, remoteOK); err != nil {
		return err
	}
	return tx.Commit()
}

func (e *Engine) setBaseWith(exec sqlExecer, ctx context.Context, id, hash string) error {
	_, err := exec.ExecContext(ctx, `INSERT INTO sync_base(item_id,object_hash,synced_at) VALUES(?,?,?)
		ON CONFLICT(item_id) DO UPDATE SET object_hash=excluded.object_hash,synced_at=excluded.synced_at`, id,hash,e.now().Unix())
	return err
}

func (e *Engine) setBase(ctx context.Context, id, hash string) error {
	return e.setBaseWith(e.DB, ctx, id, hash)
}

func parseWikiLinks(content string) []string {
	seen := make(map[string]bool)
	ids := make([]string, 0)

	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}

	var state interface{}
	if err := json.Unmarshal([]byte(content), &state); err == nil {
		var walk func(interface{})
		walk = func(value interface{}) {
			switch node := value.(type) {
			case map[string]interface{}:
				if nodeType, _ := node["type"].(string); nodeType == "wiki-link" {
					if id, _ := node["id"].(string); id != "" {
						add(id)
					}
				}
				for _, child := range node {
					walk(child)
				}
			case []interface{}:
				for _, child := range node {
					walk(child)
				}
			}
		}
		walk(state)
	}

	// Compatibility for older notes that stored literal [[target-id]] text.
	re := regexp.MustCompile(`\[\[([^\]]+)\]\]`)
	for _, match := range re.FindAllStringSubmatch(content, -1) {
		add(match[1])
	}

	return ids
}

func (e *Engine) applyRemoteTx(ctx context.Context, tx *sql.Tx, record Record) error {
	record,err:=normalizeRecord(record);if err!=nil{return err}
	if record.State=="purged"{
		switch record.Kind{
		case "file":
			for _,query:=range []string{
				`DELETE FROM file_tags WHERE file_id=?`,
				`DELETE FROM file_versions WHERE file_id=?`,
				`DELETE FROM links WHERE source_id=? OR target_id=?`,
				`DELETE FROM files WHERE id=?`,
			}{
				args:=[]interface{}{record.ID};if strings.Contains(query," OR "){args=[]interface{}{record.ID,record.ID}}
				if _,err=tx.ExecContext(ctx,query,args...);err!=nil{return err}
			}
		case "tag":
			tagID:=strings.TrimPrefix(record.ID,"tag:")
			if _,err=tx.ExecContext(ctx,`DELETE FROM file_tags WHERE tag_id=?`,tagID);err!=nil{return err}
			if _,err=tx.ExecContext(ctx,`DELETE FROM tags WHERE id=?`,tagID);err!=nil{return err}
		case "file-tag":
			parts:=strings.Split(strings.TrimPrefix(record.ID,"filetag:"),":")
			if len(parts)!=2{return fmt.Errorf("标签关联 tombstone 无效")}
			if _,err=tx.ExecContext(ctx,`DELETE FROM file_tags WHERE file_id=? AND tag_id=?`,parts[0],parts[1]);err!=nil{return err}
		case "attachment":
			// A remote tombstone on a device that never had the attachment only
			// establishes base state. Existing attachment deletion is classified
			// as a conflict and handled by the explicit filesystem resolver.
			return nil
		}
		return nil
	}

	switch record.Kind{
	case "file":
		f:=record.File
		var oldTitle,oldContent string
		err=tx.QueryRowContext(ctx,`SELECT title,content FROM files WHERE id=?`,f.ID).Scan(&oldTitle,&oldContent)
		if err==nil&&(oldTitle!=f.Title||oldContent!=f.Content){
			_,_=tx.ExecContext(ctx,`INSERT INTO file_versions(file_id,content,title,created_at) VALUES(?,?,?,?)`,f.ID,oldContent,oldTitle,e.now().Unix())
		}else if err!=nil&&!errors.Is(err,sql.ErrNoRows){return err}
		_,err=tx.ExecContext(ctx,`INSERT INTO files(id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned)
			VALUES(?,?,?,?,?,?,?,?,?,?,?)
			ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,created_at=excluded.created_at,updated_at=excluded.updated_at,
			is_folder=excluded.is_folder,parent_id=excluded.parent_id,sort_order=excluded.sort_order,is_deleted=excluded.is_deleted,deleted_at=excluded.deleted_at,is_pinned=excluded.is_pinned`,
			f.ID,f.Title,f.Content,f.CreatedAt,f.UpdatedAt,f.IsFolder,f.ParentID,f.SortOrder,f.IsDeleted,f.DeletedAt,f.IsPinned)
		if err!=nil{return err}
		if _,err=tx.ExecContext(ctx,`DELETE FROM links WHERE source_id=?`,f.ID);err!=nil{return err}
		now:=e.now().Unix()
		for _,target:=range parseWikiLinks(f.Content){
			if _,err=tx.ExecContext(ctx,`INSERT OR IGNORE INTO links(source_id,target_id,created_at) VALUES(?,?,?)`,f.ID,target,now);err!=nil{return err}
		}
	case "tag":
		t:=record.Tag
		_,err=tx.ExecContext(ctx,`INSERT INTO tags(id,name,color) VALUES(?,?,?)
			ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color`,t.ID,t.Name,t.Color)
		if err!=nil{return err}
	case "file-tag":
		link:=record.FileTag
		if _,err=tx.ExecContext(ctx,`INSERT OR IGNORE INTO file_tags(file_id,tag_id) VALUES(?,?)`,link.FileID,link.TagID);err!=nil{return err}
	case "attachment":
		// Blob materialization happens before the SQLite transaction.
		return nil
	}
	return nil
}

func (e *Engine) applyRemote(ctx context.Context, record Record) error {
	tx, err := e.DB.BeginTx(ctx,nil)
	if err != nil { return err }
	defer tx.Rollback()
	if err = e.applyRemoteTx(ctx, tx, record); err != nil { return err }
	return tx.Commit()
}

func copyItems(source map[string]string) map[string]string {
	out:=make(map[string]string,len(source))
	for k,v:=range source { out[k]=v }
	return out
}

func (e *Engine) updateState(ctx context.Context, manifest Manifest, status, lastErr string) error {
	_,err:=e.DB.ExecContext(ctx,`UPDATE sync_state SET remote_store_id=?,remote_revision=?,last_sync_at=?,last_status=?,last_error=? WHERE id=1`,
		manifest.StoreID,manifest.Revision,e.now().Unix(),status,lastErr)
	return err
}

func (e *Engine) autoConfig(ctx context.Context) (bool, time.Duration, error) {
	var syncEnabled, autoEnabled, intervalMinutes int
	var provider string
	err := e.DB.QueryRowContext(ctx, `SELECT COALESCE(sync_enabled,0),COALESCE(sync_auto_enabled,0),
		COALESCE(sync_interval_minutes,5),COALESCE(sync_provider,'') FROM settings WHERE id=1`).
		Scan(&syncEnabled,&autoEnabled,&intervalMinutes,&provider)
	if err != nil { return false,0,err }
	if intervalMinutes < 1 || intervalMinutes > 1440 { return false,0,fmt.Errorf("自动同步间隔无效") }
	enabled := syncEnabled != 0 && autoEnabled != 0 && provider == ProviderWebDAV
	return enabled,time.Duration(intervalMinutes)*time.Minute,nil
}

func (e *Engine) recordRunError(ctx context.Context, err error) {
	if err == nil { return }
	message:=err.Error()
	if len(message)>2048 { message=message[:2048] }
	_,_=e.DB.ExecContext(ctx,`UPDATE sync_state SET last_sync_at=?,last_status='error',last_error=? WHERE id=1`,e.now().Unix(),message)
}

func (e *Engine) AutoTick(ctx context.Context) (AutoTickResult,error) {
	enabled,interval,err:=e.autoConfig(ctx)
	if err!=nil{return AutoTickResult{},err}
	if !enabled{return AutoTickResult{Reason:"disabled"},nil}
	state,err:=e.state(ctx)
	if err!=nil{return AutoTickResult{},err}
	if state.OpenConflicts>0{return AutoTickResult{Reason:"conflicts"},nil}
	if state.LastSyncAt>0 && e.now().Sub(time.Unix(state.LastSyncAt,0))<interval{
		return AutoTickResult{Reason:"not-due"},nil
	}
	if !e.runMu.TryLock(){return AutoTickResult{Reason:"busy"},nil}
	defer e.runMu.Unlock()
	result,err:=e.runUnlocked(ctx)
	if err!=nil{e.recordRunError(ctx,err);return AutoTickResult{Ran:true,Reason:"error"},err}
	return AutoTickResult{Ran:true,Reason:"ok",Result:result},nil
}

func RunAutoScheduler(ctx context.Context,e *Engine,startupDelay,pollInterval time.Duration) {
	if e==nil{return}
	if startupDelay<0{startupDelay=0}
	if pollInterval<=0{pollInterval=30*time.Second}
	timer:=time.NewTimer(startupDelay)
	defer timer.Stop()
	select{case <-ctx.Done():return;case <-timer.C:}
	for{
		_,_=e.AutoTick(ctx)
		timer.Reset(pollInterval)
		select{case <-ctx.Done():return;case <-timer.C:}
	}
}

func (e *Engine) Run(ctx context.Context) (RunResult,error) {
	e.runMu.Lock()
	defer e.runMu.Unlock()
	result,err:=e.runUnlocked(ctx)
	if err!=nil{e.recordRunError(ctx,err)}
	return result,err
}

func (e *Engine) runUnlocked(ctx context.Context) (RunResult,error) {
	remote, err := e.remote(ctx)
	if err!=nil{return RunResult{},err}
	lock, err := remote.AcquireLock()
	if err!=nil{return RunResult{},err}
	defer lock.Release()

	manifest, err := remote.LoadManifest()
	if err!=nil{return RunResult{},err}
	plan,locals,remotes,_,err:=e.buildPlan(ctx,remote,manifest)
	if err!=nil{_ = e.updateState(ctx,manifest,"error",err.Error());return RunResult{},err}
	if err=e.ensureStoreID(&manifest);err!=nil{return RunResult{},err}
	if plan.StoreID=="" { plan.StoreID=manifest.StoreID; plan.NeedsInit=true }

	// Upload immutable objects first. They are unreachable until a manifest is
	// published, so a later local failure can leave only harmless orphan data.
	nextItems:=copyItems(manifest.Items)
	currentState,stateErr:=e.state(ctx)
	if stateErr!=nil{return RunResult{},stateErr}
	deviceID:=currentState.DeviceID
	uploads:=0
	for _,item:=range plan.Items {
		if item.Action!="upload"{continue}
		record:=locals[item.ID]
		data,hash,err:=encodeRecord(record)
		if err!=nil{return RunResult{},err}
		if hash!=item.LocalHash{return RunResult{},fmt.Errorf("本机对象在同步计划后发生变化: %s",item.ID)}
		if record.Kind=="attachment"&&record.State=="present"{
			uploadDir,dirErr:=e.ensureUploadDir();if dirErr!=nil{return RunResult{},dirErr}
			source:=filepath.Join(uploadDir,record.Attachment.Name)
			if err=remote.SaveBlobFile(record.Attachment.BlobHash,source,record.Attachment.Size);err!=nil{return RunResult{},err}
		}
		if err=remote.SaveObject(hash,data);err!=nil{return RunResult{},err}
		nextItems[item.ID]=hash
		uploads++
	}

	createdAttachments:=[]string{}
	cleanupAttachments:=true
	defer func(){if cleanupAttachments{for _,filename:=range createdAttachments{_ = os.Remove(filename)}}}()
	uploadDir,err:=e.ensureUploadDir();if err!=nil{return RunResult{},err}
	for _,item:=range plan.Items{
		if item.Action!="download"{continue}
		record:=remotes[item.ID]
		if record.Kind!="attachment"||record.State!="present"{continue}
		target:=filepath.Join(uploadDir,record.Attachment.Name)
		if err=remote.MaterializeBlobExclusive(record.Attachment.BlobHash,record.Attachment.Size,target);err!=nil{return RunResult{},err}
		createdAttachments=append(createdAttachments,target)
	}

	tx, err := e.DB.BeginTx(ctx,nil)
	if err!=nil{return RunResult{},err}
	defer tx.Rollback()

	downloads:=0
	applyItem:=func(item PlanItem) error {
		switch item.Action {
		case "download":
			if err=e.applyRemoteTx(ctx,tx,remotes[item.ID]);err!=nil{return err}
			if err=e.setBaseWith(tx,ctx,item.ID,item.RemoteHash);err!=nil{return err}
			downloads++
		case "upload":
			if err=e.setBaseWith(tx,ctx,item.ID,item.LocalHash);err!=nil{return err}
		case "noop":
			hash:=item.LocalHash
			if hash==""{hash=item.RemoteHash}
			if hash!=""{if err=e.setBaseWith(tx,ctx,item.ID,hash);err!=nil{return err}}
		case "conflict":
			local,localOK:=locals[item.ID]
			remoteRecord,remoteOK:=remotes[item.ID]
			if err=e.storeConflictWith(tx,ctx,item,local,localOK,remoteRecord,remoteOK);err!=nil{return err}
		}
		// Retire obsolete snapshots only alongside a successfully applied plan.
		// This is version convergence, not an implicit local/remote resolution.
		if item.Action == "upload" || item.Action == "download" || item.Action == "noop" {
			if _, err = tx.ExecContext(ctx, `UPDATE sync_conflicts SET status='superseded',resolved_at=?
				WHERE item_id=? AND status='open'`, e.now().Unix(), item.ID); err != nil {
				return err
			}
		}
		return nil
	}
	// File-tag relations depend on both file and tag rows. Apply all other
	// records first, then relations, inside the same transaction.
	for _,item:=range plan.Items {
		record:=remotes[item.ID]
		if item.Action=="download"&&record.Kind=="file-tag"{continue}
		if err=applyItem(item);err!=nil{
			_ = tx.Rollback()
			_ = e.updateState(ctx,manifest,"error",err.Error())
			return RunResult{},err
		}
	}
	for _,item:=range plan.Items {
		if item.Action!="download"||remotes[item.ID].Kind!="file-tag"{continue}
		if err=applyItem(item);err!=nil{
			_ = tx.Rollback()
			_ = e.updateState(ctx,manifest,"error",err.Error())
			return RunResult{},err
		}
	}

	manifestChanged:=uploads>0 || manifest.Generation==0
	if manifestChanged {
		candidate:=manifest
		candidate.Items=nextItems
		if err=validateRemoteStructure(candidate,remote,nil);err!=nil{
			_ = tx.Rollback()
			_ = e.updateState(ctx,manifest,"error",err.Error())
			return RunResult{},fmt.Errorf("同步后的远端结构无效，未发布: %w",err)
		}

		manifest.Items=nextItems
		manifest.Generation++
		manifest.UpdatedAt=e.now().UTC().Format(time.RFC3339Nano)
		manifest.DeviceID=deviceID
		manifest,err=remote.SaveManifest(manifest)
		if err!=nil{return RunResult{},err}
	}

	// Commit only after the remote manifest is durably published. If commit
	// unexpectedly fails, the next sync can recover from immutable remote state;
	// the reverse ordering could expose remote changes after a local apply error.
	if err=tx.Commit();err!=nil{
		_ = e.updateState(ctx,manifest,"error",err.Error())
		return RunResult{},err
	}
	cleanupAttachments=false

	status:="ok"
	if plan.Conflicts>0{status="conflicts"}
	if err=e.updateState(ctx,manifest,status,"");err!=nil{return RunResult{},err}
	return RunResult{Plan:plan,AppliedUp:uploads,AppliedDown:downloads,Conflicts:plan.Conflicts},nil
}

func (e *Engine) Conflicts(ctx context.Context) ([]Conflict,error) {
	rows,err:=e.DB.QueryContext(ctx,`SELECT id,item_id,base_hash,local_hash,remote_hash,local_record,remote_record,created_at,status,resolution
		FROM sync_conflicts WHERE status='open' ORDER BY created_at DESC,id`)
	if err!=nil{return nil,err}
	defer rows.Close()
	out:=[]Conflict{}
	for rows.Next(){
		var c Conflict
		var localRaw,remoteRaw string
		if err=rows.Scan(&c.ID,&c.ItemID,&c.BaseHash,&c.LocalHash,&c.RemoteHash,&localRaw,&remoteRaw,&c.CreatedAt,&c.Status,&c.Resolution);err!=nil{return nil,err}
		if localRaw!=""{var record Record;if json.Unmarshal([]byte(localRaw),&record)==nil{c.LocalRecord=&record}}
		if remoteRaw!=""{var record Record;if json.Unmarshal([]byte(remoteRaw),&record)==nil{c.RemoteRecord=&record}}
		out=append(out,c)
	}
	return out,rows.Err()
}

func (e *Engine) applyRemoteAttachmentChoice(remote SyncRemote, record Record) (string,error) {
	if record.Kind!="attachment"{return "",fmt.Errorf("不是附件冲突")}
	name,ok:=attachmentNameFromKey(record.ID);if !ok{return "",fmt.Errorf("附件冲突键无效")}
	uploadDir,err:=e.ensureUploadDir();if err!=nil{return "",err}
	target:=filepath.Join(uploadDir,name)
	preserveRoot:=filepath.Join(e.DataDir,"sync-preserved")
	if err:=os.MkdirAll(preserveRoot,0700);err!=nil{return "",err}
	preserveInfo,err:=os.Lstat(preserveRoot);if err!=nil{return "",err}
	if !preserveInfo.IsDir()||preserveInfo.Mode()&os.ModeSymlink!=0{return "",fmt.Errorf("同步保留目录不安全")}
	preserved:=""
	if info,err:=os.Lstat(target);err==nil{
		if !info.Mode().IsRegular()||info.Mode()&os.ModeSymlink!=0{return "",fmt.Errorf("本机附件目标不安全")}
		suffix,randErr:=randomID(6);if randErr!=nil{return "",randErr}
		preserved=filepath.Join(preserveRoot,name+"."+suffix)
		if err=os.Rename(target,preserved);err!=nil{return "",err}
	}else if !os.IsNotExist(err){return "",err}
	rollback:=func(){if preserved!=""{_ = os.Rename(preserved,target)}}
	if record.State=="purged"{return preserved,nil}
	if err:=remote.MaterializeBlobExclusive(record.Attachment.BlobHash,record.Attachment.Size,target);err!=nil{rollback();return "",err}
	return preserved,nil
}

func (e *Engine) Resolve(ctx context.Context, conflictID, choice string) error {
	if choice!="local"&&choice!="remote"{return fmt.Errorf("冲突解决方式仅支持 local 或 remote")}
	remote,err:=e.remote(ctx);if err!=nil{return err}
	lock,err:=remote.AcquireLock();if err!=nil{return err};defer lock.Release()
	var c Conflict
	var localRaw,remoteRaw string
	err=e.DB.QueryRowContext(ctx,`SELECT id,item_id,base_hash,local_hash,remote_hash,local_record,remote_record,created_at,status,resolution
		FROM sync_conflicts WHERE id=? AND status='open'`,conflictID).Scan(
		&c.ID,&c.ItemID,&c.BaseHash,&c.LocalHash,&c.RemoteHash,&localRaw,&remoteRaw,&c.CreatedAt,&c.Status,&c.Resolution)
	if err!=nil{return fmt.Errorf("同步冲突不存在或已解决")}
	base,err:=e.base(ctx);if err!=nil{return err}
	if base[c.ItemID]!=c.BaseHash{return fmt.Errorf("冲突基线已变化，请重新同步生成冲突")}
	locals,err:=e.localRecords(ctx);if err!=nil{return err}
	localRecord,localHash,localExists,err:=localRecordFor(c.ItemID,locals,base);if err!=nil{return err}
	if localHash!=c.LocalHash{return fmt.Errorf("本机内容在冲突产生后已变化，请重新同步")}
	manifest,err:=remote.LoadManifest();if err!=nil{return err}
	if manifest.Items[c.ItemID]!=c.RemoteHash{return fmt.Errorf("远端内容在冲突产生后已变化，请重新同步")}
	if choice=="local"{
		if !localExists{return fmt.Errorf("本机冲突对象不可用")}
		data,hash,err:=encodeRecord(localRecord);if err!=nil{return err}
		if localRecord.Kind=="attachment"&&localRecord.State=="present"{
			uploadDir,dirErr:=e.ensureUploadDir();if dirErr!=nil{return dirErr}
			source:=filepath.Join(uploadDir,localRecord.Attachment.Name)
			if err=remote.SaveBlobFile(localRecord.Attachment.BlobHash,source,localRecord.Attachment.Size);err!=nil{return err}
		}
		if err=remote.SaveObject(hash,data);err!=nil{return err}
		manifest.Items=copyItems(manifest.Items);manifest.Items[c.ItemID]=hash;manifest.Generation++
		manifest.UpdatedAt=e.now().UTC().Format(time.RFC3339Nano)
		state,_:=e.state(ctx);manifest.DeviceID=state.DeviceID
		manifest,err=remote.SaveManifest(manifest);if err!=nil{return err}
		if err=e.setBase(ctx,c.ItemID,hash);err!=nil{return err}
	}else{
		record,err:=remote.LoadRecord(c.RemoteHash);if err!=nil{return err}
		if record.Kind=="attachment"{
			if _,err=e.applyRemoteAttachmentChoice(remote,record);err!=nil{return err}
		}else{
			if err=e.applyRemote(ctx,record);err!=nil{return err}
		}
		if err=e.setBase(ctx,c.ItemID,c.RemoteHash);err!=nil{return err}
	}
	_,err=e.DB.ExecContext(ctx,`UPDATE sync_conflicts SET status='resolved',resolution=?,resolved_at=? WHERE id=? AND status='open'`,choice,e.now().Unix(),conflictID)
	if err!=nil{return err}
	latest,err:=remote.LoadManifest();if err==nil{_ = e.updateState(ctx,latest,"ok","")}
	return err
}

// DirRemote is a deliberately small filesystem provider used to prove the core
// protocol before WebDAV/S3/Git adapters are added. All objects/manifests are immutable.
type DirRemote struct { Root string }

type RemoteLock struct {
	path    string
	file    *os.File
	release func()
}

func NewDirRemote(root string) (*DirRemote,error) {
	if strings.TrimSpace(root)=="" { return nil,fmt.Errorf("同步远端目录为空") }
	return &DirRemote{Root:root},nil
}

func (r *DirRemote) ensure() error {
	for _,dir:=range []string{r.Root,filepath.Join(r.Root,"objects"),filepath.Join(r.Root,"blobs"),filepath.Join(r.Root,"manifests"),filepath.Join(r.Root,"locks")} {
		if err:=os.MkdirAll(dir,0700);err!=nil{return err}
		info,err:=os.Lstat(dir);if err!=nil{return err}
		if !info.IsDir()||info.Mode()&os.ModeSymlink!=0{return fmt.Errorf("同步远端目录不安全: %s",dir)}
	}
	return nil
}

func (r *DirRemote) AcquireLock() (*RemoteLock,error) {
	if err:=r.ensure();err!=nil{return nil,err}
	filename:=filepath.Join(r.Root,"locks","sync.lock")
	open := func() (*os.File,error) {
		return os.OpenFile(filename,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
	}
	file,err:=open()
	if err!=nil && os.IsExist(err) {
		info,statErr:=os.Lstat(filename)
		if statErr!=nil{return nil,statErr}
		if !info.Mode().IsRegular()||info.Mode()&os.ModeSymlink!=0{return nil,fmt.Errorf("同步锁文件不安全，拒绝自动处理")}
		age:=time.Since(info.ModTime())
		if age<0 || age<=staleLockAge{return nil,fmt.Errorf("同步远端正被其他设备使用，请稍后重试")}
		suffix,randErr:=randomID(6);if randErr!=nil{return nil,randErr}
		stale:=filename+".stale-"+suffix
		if linkErr:=os.Link(filename,stale);linkErr!=nil{return nil,fmt.Errorf("无法保留过期同步锁: %w",linkErr)}
		if removeErr:=os.Remove(filename);removeErr!=nil{return nil,fmt.Errorf("无法回收过期同步锁: %w",removeErr)}
		file,err=open()
	}
	if err!=nil{return nil,err}
	payload,_:=json.Marshal(map[string]interface{}{"pid":os.Getpid(),"at":time.Now().UTC().Format(time.RFC3339Nano)})
	if _,err=file.Write(payload);err!=nil{file.Close();os.Remove(filename);return nil,err}
	if err=file.Sync();err!=nil{file.Close();os.Remove(filename);return nil,err}
	return &RemoteLock{path:filename,file:file},nil
}

func (l *RemoteLock) Release() {
	if l==nil{return}
	if l.release!=nil{l.release();return}
	if l.file!=nil{_ = l.file.Close()}
	_ = os.Remove(l.path)
}

func writeImmutable(target string,data []byte) error {
	if info,err:=os.Lstat(target);err==nil {
		if !info.Mode().IsRegular()||info.Mode()&os.ModeSymlink!=0{return fmt.Errorf("同步对象目标不安全")}
		existing,err:=os.ReadFile(target);if err!=nil{return err}
		if hashBytes(existing)!=hashBytes(data){return fmt.Errorf("同步对象哈希碰撞或远端损坏")}
		return nil
	}else if !os.IsNotExist(err){return err}
	dir:=filepath.Dir(target)
	temp,err:=os.CreateTemp(dir,".sync-*.partial");if err!=nil{return err}
	name:=temp.Name()
	defer os.Remove(name)
	if _,err=temp.Write(data);err!=nil{temp.Close();return err}
	if err=temp.Sync();err!=nil{temp.Close();return err}
	if err=temp.Close();err!=nil{return err}
	if err=os.Link(name,target);err!=nil {
		if os.IsExist(err){
			existing,readErr:=os.ReadFile(target);if readErr!=nil{return readErr}
			if hashBytes(existing)==hashBytes(data){return nil}
		}
		return err
	}
	return nil
}

func (r *DirRemote) SaveObject(hash string,data []byte) error {
	if !objectHashPattern.MatchString(hash)||hashBytes(data)!=hash{return fmt.Errorf("同步对象哈希无效")}
	if err:=r.ensure();err!=nil{return err}
	return writeImmutable(filepath.Join(r.Root,"objects",hash+".json"),data)
}

func (r *DirRemote) LoadRecord(hash string) (Record,error) {
	var record Record
	if !objectHashPattern.MatchString(hash){return record,fmt.Errorf("远端对象哈希无效")}
	filename:=filepath.Join(r.Root,"objects",hash+".json")
	info,err:=os.Lstat(filename);if err!=nil{return record,err}
	if !info.Mode().IsRegular()||info.Mode()&os.ModeSymlink!=0{return record,fmt.Errorf("远端对象不是普通文件")}
	data,err:=os.ReadFile(filename);if err!=nil{return record,err}
	if hashBytes(data)!=hash{return record,fmt.Errorf("远端对象 SHA-256 校验失败")}
	if err=json.Unmarshal(data,&record);err!=nil{return record,fmt.Errorf("远端对象 JSON 无效: %w",err)}
	return normalizeRecord(record)
}

func (r *DirRemote) blobPath(hash string) (string,error) {
	if !objectHashPattern.MatchString(hash){return "",fmt.Errorf("附件 blob 哈希无效")}
	return filepath.Join(r.Root,"blobs",hash),nil
}

func (r *DirRemote) VerifyBlob(hash string,size int64) error {
	filename,err:=r.blobPath(hash);if err!=nil{return err}
	info,err:=os.Lstat(filename);if err!=nil{return err}
	if !info.Mode().IsRegular()||info.Mode()&os.ModeSymlink!=0||info.Size()!=size{return fmt.Errorf("远端附件 blob 元数据不匹配")}
	actualSize,actualHash,err:=stableFileDigest(filename);if err!=nil{return err}
	if actualSize!=size||actualHash!=hash{return fmt.Errorf("远端附件 blob SHA-256 校验失败")}
	return nil
}

func (r *DirRemote) SaveBlobFile(hash,source string,size int64) error {
	if err:=r.ensure();err!=nil{return err}
	target,err:=r.blobPath(hash);if err!=nil{return err}
	if info,statErr:=os.Lstat(target);statErr==nil{
		if !info.Mode().IsRegular()||info.Mode()&os.ModeSymlink!=0{return fmt.Errorf("远端附件 blob 目标不安全")}
		return r.VerifyBlob(hash,size)
	}else if !os.IsNotExist(statErr){return statErr}
	before,err:=os.Lstat(source);if err!=nil{return err}
	if !before.Mode().IsRegular()||before.Mode()&os.ModeSymlink!=0||before.Size()!=size{return fmt.Errorf("本机附件在同步前发生变化")}
	in,err:=os.Open(source);if err!=nil{return err};defer in.Close()
	tmp,err:=os.CreateTemp(filepath.Dir(target),".blob-*.partial");if err!=nil{return err}
	tmpName:=tmp.Name();defer os.Remove(tmpName)
	h:=sha256.New();written,copyErr:=io.Copy(io.MultiWriter(tmp,h),in)
	if copyErr!=nil{tmp.Close();return copyErr}
	if written!=size||hex.EncodeToString(h.Sum(nil))!=hash{tmp.Close();return fmt.Errorf("本机附件内容与同步计划不一致")}
	if err=tmp.Sync();err!=nil{tmp.Close();return err};if err=tmp.Close();err!=nil{return err}
	after,err:=os.Lstat(source);if err!=nil{return err}
	if !os.SameFile(before,after)||before.Size()!=after.Size()||!before.ModTime().Equal(after.ModTime()){return fmt.Errorf("本机附件在上传期间发生变化")}
	if err=os.Link(tmpName,target);err!=nil{
		if os.IsExist(err){return r.VerifyBlob(hash,size)}
		return err
	}
	return nil
}

func (r *DirRemote) MaterializeBlobExclusive(hash string,size int64,target string) error {
	if err:=r.VerifyBlob(hash,size);err!=nil{return err}
	if _,err:=os.Lstat(target);err==nil{return fmt.Errorf("本机附件目标已存在，拒绝覆盖: %s",filepath.Base(target))}else if !os.IsNotExist(err){return err}
	source,_:=r.blobPath(hash)
	tmp,err:=os.CreateTemp(filepath.Dir(target),".sync-download-*.partial");if err!=nil{return err}
	tmpName:=tmp.Name();defer os.Remove(tmpName)
	in,err:=os.Open(source);if err!=nil{tmp.Close();return err}
	h:=sha256.New();written,copyErr:=io.Copy(io.MultiWriter(tmp,h),in);closeIn:=in.Close()
	if copyErr!=nil{tmp.Close();return copyErr};if closeIn!=nil{tmp.Close();return closeIn}
	if written!=size||hex.EncodeToString(h.Sum(nil))!=hash{tmp.Close();return fmt.Errorf("远端附件下载校验失败")}
	if err=tmp.Sync();err!=nil{tmp.Close();return err};if err=tmp.Close();err!=nil{return err}
	if err=os.Link(tmpName,target);err!=nil{return fmt.Errorf("发布下载附件失败: %w",err)}
	return nil
}

func (r *DirRemote) LoadManifest() (Manifest,error) {
	empty:=Manifest{Format:ManifestFormat,Version:ManifestVersion,Items:map[string]string{}}
	rootInfo,err:=os.Lstat(r.Root)
	if os.IsNotExist(err){return empty,nil}
	if err!=nil{return empty,err}
	if !rootInfo.IsDir()||rootInfo.Mode()&os.ModeSymlink!=0{return empty,fmt.Errorf("同步远端目录不安全: %s",r.Root)}
	manifestDir:=filepath.Join(r.Root,"manifests")
	info,err:=os.Lstat(manifestDir)
	if os.IsNotExist(err){return empty,nil}
	if err!=nil{return empty,err}
	if !info.IsDir()||info.Mode()&os.ModeSymlink!=0{return empty,fmt.Errorf("远端 manifest 目录不安全")}
	entries,err:=os.ReadDir(manifestDir);if err!=nil{return empty,err}
	type candidate struct{name string;generation int64;hash string}
	list:=[]candidate{}
	for _,entry:=range entries{
		if entry.IsDir(){continue}
		match:=manifestNamePattern.FindStringSubmatch(entry.Name());if match==nil{continue}
		gen,err:=strconv.ParseInt(match[1],10,64);if err!=nil{continue}
		list=append(list,candidate{entry.Name(),gen,match[2]})
	}
	if len(list)==0{return empty,nil}
	sort.Slice(list,func(i,j int)bool{
		if list[i].generation==list[j].generation{return list[i].name<list[j].name}
		return list[i].generation>list[j].generation
	})
	if len(list)>1 && list[0].generation==list[1].generation {
		return empty,fmt.Errorf("远端存在同一代的多个 manifest，拒绝猜测当前版本")
	}
	item:=list[0]
	filename:=filepath.Join(r.Root,"manifests",item.name)
	fileInfo,err:=os.Lstat(filename);if err!=nil{return empty,err}
	if !fileInfo.Mode().IsRegular()||fileInfo.Mode()&os.ModeSymlink!=0{return empty,fmt.Errorf("远端清单不是普通文件")}
	data,err:=os.ReadFile(filename);if err!=nil{return empty,err}
	if hashBytes(data)!=item.hash{return empty,fmt.Errorf("远端清单 SHA-256 校验失败")}
	var manifest Manifest
	if err=json.Unmarshal(data,&manifest);err!=nil{return empty,fmt.Errorf("远端清单 JSON 无效: %w",err)}
	if manifest.Format!=ManifestFormat||manifest.Version!=ManifestVersion||manifest.Generation!=item.generation||
		strings.TrimSpace(manifest.StoreID)==""||manifest.Items==nil{return empty,fmt.Errorf("远端清单格式无效")}
	for _,hash:=range manifest.Items{if !objectHashPattern.MatchString(hash){return empty,fmt.Errorf("远端清单对象哈希无效")}}
	manifest.Revision=item.hash
	return manifest,nil
}

func (r *DirRemote) SaveManifest(manifest Manifest) (Manifest,error) {
	if err:=r.ensure();err!=nil{return Manifest{},err}
	if manifest.Format==""{manifest.Format=ManifestFormat}
	if manifest.Version==0{manifest.Version=ManifestVersion}
	if manifest.Format!=ManifestFormat||manifest.Version!=ManifestVersion||manifest.Generation<1||
		strings.TrimSpace(manifest.StoreID)==""||manifest.Items==nil{return Manifest{},fmt.Errorf("同步清单格式无效")}
	manifest.Revision=""
	data,err:=json.Marshal(manifest);if err!=nil{return Manifest{},err}
	hash:=hashBytes(data)
	name:=fmt.Sprintf("%020d-%s.json",manifest.Generation,hash)
	if err=writeImmutable(filepath.Join(r.Root,"manifests",name),data);err!=nil{return Manifest{},err}
	manifest.Revision=hash
	return manifest,nil
}

func CopyFile(source,dest string) error {
	in,err:=os.Open(source);if err!=nil{return err};defer in.Close()
	out,err:=os.OpenFile(dest,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600);if err!=nil{return err}
	_,copyErr:=io.Copy(out,in);syncErr:=out.Sync();closeErr:=out.Close()
	if copyErr!=nil{return copyErr};if syncErr!=nil{return syncErr};return closeErr
}
