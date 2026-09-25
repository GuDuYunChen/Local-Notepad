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
	"time"
)

const (
	RecordFormat   = "local-notepad-sync-record"
	RecordVersion  = 1
	ManifestFormat = "local-notepad-sync-manifest"
	ManifestVersion = 1
	ProviderLocalLab = "local-lab"
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

type Record struct {
	Format  string       `json:"format"`
	Version int          `json:"version"`
	Kind    string       `json:"kind"`
	ID      string       `json:"id"`
	State   string       `json:"state"`
	File    *FilePayload `json:"file,omitempty"`
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

type Engine struct {
	DB      *sql.DB
	DataDir string
	Now     func() time.Time
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

func normalizeRecord(record Record) (Record, error) {
	if record.Format != RecordFormat || record.Version != RecordVersion || record.Kind != "file" || strings.TrimSpace(record.ID) == "" {
		return Record{}, fmt.Errorf("同步对象格式无效")
	}
	if record.State != "present" && record.State != "purged" {
		return Record{}, fmt.Errorf("同步对象状态无效")
	}
	if record.State == "present" {
		if record.File == nil || record.File.ID != record.ID || strings.TrimSpace(record.File.Title) == "" {
			return Record{}, fmt.Errorf("同步文件对象无效")
		}
	} else if record.File != nil {
		return Record{}, fmt.Errorf("永久删除标记不能携带文件正文")
	}
	return record, nil
}

func encodeRecord(record Record) ([]byte, string, error) {
	record, err := normalizeRecord(record)
	if err != nil { return nil, "", err }
	data, err := json.Marshal(record)
	if err != nil { return nil, "", err }
	return data, hashBytes(data), nil
}

func presentRecord(file FilePayload) Record {
	return Record{Format: RecordFormat, Version: RecordVersion, Kind: "file", ID: file.ID, State: "present", File: &file}
}

func purgedRecord(id string) Record {
	return Record{Format: RecordFormat, Version: RecordVersion, Kind: "file", ID: id, State: "purged"}
}

func (e *Engine) config(ctx context.Context) (enabled bool, provider string, err error) {
	var flag int
	err = e.DB.QueryRowContext(ctx, `SELECT COALESCE(sync_enabled,0), COALESCE(sync_provider,'') FROM settings WHERE id=1`).Scan(&flag, &provider)
	if err != nil { return false, "", err }
	return flag != 0, provider, nil
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

func (e *Engine) remote(ctx context.Context) (*DirRemote, error) {
	enabled, provider, err := e.config(ctx)
	if err != nil { return nil, err }
	if !enabled { return nil, fmt.Errorf("同步尚未启用") }
	if provider != ProviderLocalLab {
		return nil, fmt.Errorf("当前阶段仅支持本地同步实验室 provider")
	}
	if e.DataDir == "" { return nil, fmt.Errorf("同步数据目录未配置") }
	return NewDirRemote(filepath.Join(e.DataDir, "sync-lab-remote"))
}

func (e *Engine) localFiles(ctx context.Context) (map[string]Record, error) {
	rows, err := e.DB.QueryContext(ctx, `SELECT id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned FROM files`)
	if err != nil { return nil, err }
	defer rows.Close()
	out := map[string]Record{}
	for rows.Next() {
		var f FilePayload
		if err := rows.Scan(&f.ID,&f.Title,&f.Content,&f.CreatedAt,&f.UpdatedAt,&f.IsFolder,&f.ParentID,&f.SortOrder,&f.IsDeleted,&f.DeletedAt,&f.IsPinned); err != nil {
			return nil, err
		}
		out[f.ID] = presentRecord(f)
	}
	return out, rows.Err()
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
	if record, ok := locals[id]; ok {
		hash, err := recordHash(record)
		return record, hash, true, err
	}
	if _, hadBase := base[id]; hadBase {
		record := purgedRecord(id)
		hash, err := recordHash(record)
		return record, hash, true, err
	}
	return Record{}, "", false, nil
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

func classify(baseHash, localHash, remoteHash string, localExists bool) string {
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

func (e *Engine) buildPlan(ctx context.Context, remote *DirRemote, manifest Manifest) (Plan, map[string]Record, map[string]Record, map[string]string, error) {
	locals, err := e.localFiles(ctx)
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
		action := classify(base[id], localHash, remoteHash, localExists)
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

func validateRemoteStructure(manifest Manifest, remote *DirRemote, cache map[string]Record) error {
	records := map[string]Record{}
	for id, hash := range manifest.Items {
		record, ok := cache[id]
		if !ok {
			var err error
			record, err = remote.LoadRecord(hash)
			if err != nil { return err }
		}
		if record.ID != id { return fmt.Errorf("远端对象 ID 与清单不一致") }
		records[id]=record
	}
	activeNames := map[string]string{}
	for id, record := range records {
		if record.State != "present" || record.File == nil { continue }
		f := record.File
		if f.ParentID == id { return fmt.Errorf("远端文件层级包含自引用: %s", id) }
		if f.ParentID != "" {
			parent, ok := records[f.ParentID]
			if !ok || parent.State!="present" || parent.File==nil || !parent.File.IsFolder {
				return fmt.Errorf("远端文件层级缺少有效父目录: %s", id)
			}
		}
		if !f.IsDeleted {
			key := f.ParentID+"\x00"+strings.ToLocaleLower(f.Title)
			if previous, ok := activeNames[key]; ok && previous != id {
				return fmt.Errorf("远端同一目录存在重复标题: %s", f.Title)
			}
			activeNames[key]=id
		}
	}
	for id, record := range records {
		if record.State!="present" || record.File==nil || !record.File.IsFolder { continue }
		seen:=map[string]bool{id:true}
		parent:=record.File.ParentID
		for parent!="" {
			if seen[parent] { return fmt.Errorf("远端文件夹层级存在循环: %s", id) }
			seen[parent]=true
			p:=records[parent]
			if p.File==nil { break }
			parent=p.File.ParentID
		}
	}
	return nil
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

func (e *Engine) storeConflict(ctx context.Context, item PlanItem, local Record, localOK bool, remote Record, remoteOK bool) error {
	id := conflictID(item)
	now := e.now().Unix()
	_, err := e.DB.ExecContext(ctx, `UPDATE sync_conflicts SET status='superseded', resolved_at=? WHERE item_id=? AND status='open' AND id<>?`, now,item.ID,id)
	if err != nil { return err }
	_, err = e.DB.ExecContext(ctx, `INSERT OR IGNORE INTO sync_conflicts
		(id,item_id,base_hash,local_hash,remote_hash,local_record,remote_record,created_at,status,resolution,resolved_at)
		VALUES(?,?,?,?,?,?,?,?, 'open','',0)`,
		id,item.ID,item.BaseHash,item.LocalHash,item.RemoteHash,nullableRecord(local,localOK),nullableRecord(remote,remoteOK),now)
	return err
}

func (e *Engine) setBase(ctx context.Context, id, hash string) error {
	_, err := e.DB.ExecContext(ctx, `INSERT INTO sync_base(item_id,object_hash,synced_at) VALUES(?,?,?)
		ON CONFLICT(item_id) DO UPDATE SET object_hash=excluded.object_hash,synced_at=excluded.synced_at`, id,hash,e.now().Unix())
	return err
}

func parseWikiLinks(content string) []string {
	seen:=map[string]bool{}
	out:=[]string{}
	add:=func(id string){ id=strings.TrimSpace(id); if id!=""&&!seen[id]{seen[id]=true;out=append(out,id)} }
	var state interface{}
	if json.Unmarshal([]byte(content),&state)==nil {
		var walk func(interface{})
		walk=func(value interface{}){
			switch node:=value.(type){
			case map[string]interface{}:
				if t,_:=node["type"].(string); t=="wiki-link" { if id,_:=node["id"].(string); id!="" { add(id) } }
				for _,child:=range node { walk(child) }
			case []interface{}: for _,child:=range node { walk(child) }
			}
		}
		walk(state)
	}
	re:=regexp.MustCompile(`\\[\\[([^\\]]+)\\]\\]`)
	for _,match:=range re.FindAllStringSubmatch(content,-1){ add(match[1]) }
	return out
}

func (e *Engine) applyRemote(ctx context.Context, record Record) error {
	record, err := normalizeRecord(record)
	if err != nil { return err }
	tx, err := e.DB.BeginTx(ctx,nil)
	if err != nil { return err }
	defer tx.Rollback()
	if record.State=="purged" {
		for _,query:=range []string{
			`DELETE FROM file_tags WHERE file_id=?`,
			`DELETE FROM file_versions WHERE file_id=?`,
			`DELETE FROM links WHERE source_id=? OR target_id=?`,
			`DELETE FROM files WHERE id=?`,
		}{
			args:=[]interface{}{record.ID}
			if strings.Contains(query," OR ") { args=[]interface{}{record.ID,record.ID} }
			if _,err=tx.ExecContext(ctx,query,args...);err!=nil{return err}
		}
		return tx.Commit()
	}
	f:=record.File
	var oldTitle,oldContent string
	err=tx.QueryRowContext(ctx,`SELECT title,content FROM files WHERE id=?`,f.ID).Scan(&oldTitle,&oldContent)
	if err==nil && (oldTitle!=f.Title || oldContent!=f.Content) {
		_,_ = tx.ExecContext(ctx,`INSERT INTO file_versions(file_id,content,title,created_at) VALUES(?,?,?,?)`,f.ID,oldContent,oldTitle,e.now().Unix())
	} else if err!=nil && !errors.Is(err,sql.ErrNoRows) { return err }
	_,err=tx.ExecContext(ctx,`INSERT INTO files(id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned)
		VALUES(?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,created_at=excluded.created_at,updated_at=excluded.updated_at,
		is_folder=excluded.is_folder,parent_id=excluded.parent_id,sort_order=excluded.sort_order,is_deleted=excluded.is_deleted,deleted_at=excluded.deleted_at,is_pinned=excluded.is_pinned`,
		f.ID,f.Title,f.Content,f.CreatedAt,f.UpdatedAt,f.IsFolder,f.ParentID,f.SortOrder,f.IsDeleted,f.DeletedAt,f.IsPinned)
	if err!=nil{return err}
	if _,err=tx.ExecContext(ctx,`DELETE FROM links WHERE source_id=?`,f.ID);err!=nil{return err}
	now:=e.now().Unix()
	for _,target:=range parseWikiLinks(f.Content) {
		if _,err=tx.ExecContext(ctx,`INSERT OR IGNORE INTO links(source_id,target_id,created_at) VALUES(?,?,?)`,f.ID,target,now);err!=nil{return err}
	}
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

func (e *Engine) Run(ctx context.Context) (RunResult,error) {
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

	nextItems:=copyItems(manifest.Items)
	uploads:=0
	for _,item:=range plan.Items {
		if item.Action!="upload"{continue}
		record:=locals[item.ID]
		data,hash,err:=encodeRecord(record)
		if err!=nil{return RunResult{},err}
		if hash!=item.LocalHash{return RunResult{},fmt.Errorf("本机对象在同步计划后发生变化: %s",item.ID)}
		if err=remote.SaveObject(hash,data);err!=nil{return RunResult{},err}
		nextItems[item.ID]=hash
		uploads++
	}
	manifestChanged:=uploads>0 || manifest.Generation==0
	if manifestChanged {
		manifest.Items=nextItems
		manifest.Generation++
		manifest.UpdatedAt=e.now().UTC().Format(time.RFC3339Nano)
		state,_:=e.state(ctx)
		manifest.DeviceID=state.DeviceID
		manifest,err=remote.SaveManifest(manifest)
		if err!=nil{return RunResult{},err}
	}
	downloads:=0
	for _,item:=range plan.Items {
		switch item.Action {
		case "download":
			if err=e.applyRemote(ctx,remotes[item.ID]);err!=nil{_ = e.updateState(ctx,manifest,"error",err.Error());return RunResult{},err}
			if err=e.setBase(ctx,item.ID,item.RemoteHash);err!=nil{return RunResult{},err}
			downloads++
		case "upload":
			if err=e.setBase(ctx,item.ID,item.LocalHash);err!=nil{return RunResult{},err}
		case "noop":
			hash:=item.LocalHash
			if hash==""{hash=item.RemoteHash}
			if hash!=""{if err=e.setBase(ctx,item.ID,hash);err!=nil{return RunResult{},err}}
		case "conflict":
			local,localOK:=locals[item.ID]
			remoteRecord,remoteOK:=remotes[item.ID]
			if err=e.storeConflict(ctx,item,local,localOK,remoteRecord,remoteOK);err!=nil{return RunResult{},err}
		}
	}
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
	locals,err:=e.localFiles(ctx);if err!=nil{return err}
	localRecord,localHash,localExists,err:=localRecordFor(c.ItemID,locals,base);if err!=nil{return err}
	if localHash!=c.LocalHash{return fmt.Errorf("本机内容在冲突产生后已变化，请重新同步")}
	manifest,err:=remote.LoadManifest();if err!=nil{return err}
	if manifest.Items[c.ItemID]!=c.RemoteHash{return fmt.Errorf("远端内容在冲突产生后已变化，请重新同步")}
	if choice=="local"{
		if !localExists{return fmt.Errorf("本机冲突对象不可用")}
		data,hash,err:=encodeRecord(localRecord);if err!=nil{return err}
		if err=remote.SaveObject(hash,data);err!=nil{return err}
		manifest.Items=copyItems(manifest.Items);manifest.Items[c.ItemID]=hash;manifest.Generation++
		manifest.UpdatedAt=e.now().UTC().Format(time.RFC3339Nano)
		state,_:=e.state(ctx);manifest.DeviceID=state.DeviceID
		manifest,err=remote.SaveManifest(manifest);if err!=nil{return err}
		if err=e.setBase(ctx,c.ItemID,hash);err!=nil{return err}
	}else{
		record,err:=remote.LoadRecord(c.RemoteHash);if err!=nil{return err}
		if err=e.applyRemote(ctx,record);err!=nil{return err}
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

type RemoteLock struct { path string; file *os.File }

func NewDirRemote(root string) (*DirRemote,error) {
	if strings.TrimSpace(root)=="" { return nil,fmt.Errorf("同步远端目录为空") }
	return &DirRemote{Root:root},nil
}

func (r *DirRemote) ensure() error {
	for _,dir:=range []string{r.Root,filepath.Join(r.Root,"objects"),filepath.Join(r.Root,"manifests"),filepath.Join(r.Root,"locks")} {
		if err:=os.MkdirAll(dir,0700);err!=nil{return err}
		info,err:=os.Lstat(dir);if err!=nil{return err}
		if !info.IsDir()||info.Mode()&os.ModeSymlink!=0{return fmt.Errorf("同步远端目录不安全: %s",dir)}
	}
	return nil
}

func (r *DirRemote) AcquireLock() (*RemoteLock,error) {
	if err:=r.ensure();err!=nil{return nil,err}
	filename:=filepath.Join(r.Root,"locks","sync.lock")
	file,err:=os.OpenFile(filename,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
	if err!=nil {
		if os.IsExist(err){return nil,fmt.Errorf("同步远端正被其他设备使用，请稍后重试")}
		return nil,err
	}
	payload,_:=json.Marshal(map[string]interface{}{"pid":os.Getpid(),"at":time.Now().UTC().Format(time.RFC3339Nano)})
	if _,err=file.Write(payload);err!=nil{file.Close();os.Remove(filename);return nil,err}
	if err=file.Sync();err!=nil{file.Close();os.Remove(filename);return nil,err}
	return &RemoteLock{path:filename,file:file},nil
}

func (l *RemoteLock) Release() {
	if l==nil{return}
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
	if err:=r.ensure();err!=nil{return record,err}
	filename:=filepath.Join(r.Root,"objects",hash+".json")
	info,err:=os.Lstat(filename);if err!=nil{return record,err}
	if !info.Mode().IsRegular()||info.Mode()&os.ModeSymlink!=0{return record,fmt.Errorf("远端对象不是普通文件")}
	data,err:=os.ReadFile(filename);if err!=nil{return record,err}
	if hashBytes(data)!=hash{return record,fmt.Errorf("远端对象 SHA-256 校验失败")}
	if err=json.Unmarshal(data,&record);err!=nil{return record,fmt.Errorf("远端对象 JSON 无效: %w",err)}
	return normalizeRecord(record)
}

func (r *DirRemote) LoadManifest() (Manifest,error) {
	empty:=Manifest{Format:ManifestFormat,Version:ManifestVersion,Items:map[string]string{}}
	if err:=r.ensure();err!=nil{return empty,err}
	entries,err:=os.ReadDir(filepath.Join(r.Root,"manifests"));if err!=nil{return empty,err}
	type candidate struct{name string;generation int64;hash string}
	list:=[]candidate{}
	for _,entry:=range entries{
		if entry.IsDir(){continue}
		match:=manifestNamePattern.FindStringSubmatch(entry.Name());if match==nil{continue}
		gen,err:=strconv.ParseInt(match[1],10,64);if err!=nil{continue}
		list=append(list,candidate{entry.Name(),gen,match[2]})
	}
	if len(list)==0{return empty,nil}
	sort.Slice(list,func(i,j int)bool{return list[i].generation>list[j].generation})
	item:=list[0]
	filename:=filepath.Join(r.Root,"manifests",item.name)
	info,err:=os.Lstat(filename);if err!=nil{return empty,err}
	if !info.Mode().IsRegular()||info.Mode()&os.ModeSymlink!=0{return empty,fmt.Errorf("远端清单不是普通文件")}
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
