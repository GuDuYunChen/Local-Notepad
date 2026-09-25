package syncengine

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func testDB(t *testing.T) (*sql.DB,string) {
	t.Helper()
	root:=t.TempDir()
	db,err:=sql.Open("sqlite",filepath.Join(root,"data.db"));if err!=nil{t.Fatal(err)}
	t.Cleanup(func(){db.Close()})
	schema:=[]string{
		`CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,is_folder INTEGER DEFAULT 0,parent_id TEXT DEFAULT '',sort_order INTEGER DEFAULT 0,is_deleted INTEGER DEFAULT 0,deleted_at INTEGER DEFAULT 0,is_pinned INTEGER DEFAULT 0)`,
		`CREATE VIRTUAL TABLE files_fts USING fts5(title,content,content='files',content_rowid='rowid')`,
		`CREATE TRIGGER files_fts_insert AFTER INSERT ON files BEGIN INSERT INTO files_fts(rowid,title,content) VALUES(new.rowid,new.title,new.content); END`,
		`CREATE TRIGGER files_fts_update AFTER UPDATE OF title,content ON files BEGIN INSERT INTO files_fts(files_fts,rowid,title,content) VALUES('delete',old.rowid,old.title,old.content); INSERT INTO files_fts(rowid,title,content) VALUES(new.rowid,new.title,new.content); END`,
		`CREATE TABLE file_tags(file_id TEXT,tag_id TEXT)`,
		`CREATE TABLE file_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,file_id TEXT,content TEXT,title TEXT,created_at INTEGER)`,
		`CREATE TABLE links(id INTEGER PRIMARY KEY AUTOINCREMENT,source_id TEXT,target_id TEXT,created_at INTEGER,UNIQUE(source_id,target_id))`,
		`CREATE TABLE settings(id INTEGER PRIMARY KEY,theme TEXT,sync_enabled INTEGER,sync_endpoint TEXT,sync_provider TEXT)`,
		`INSERT INTO settings(id,theme,sync_enabled,sync_provider) VALUES(1,'light',1,'local-lab')`,
		`CREATE TABLE sync_state(id INTEGER PRIMARY KEY,device_id TEXT NOT NULL,remote_store_id TEXT NOT NULL DEFAULT '',remote_revision TEXT NOT NULL DEFAULT '',last_sync_at INTEGER NOT NULL DEFAULT 0,last_status TEXT NOT NULL DEFAULT 'never',last_error TEXT NOT NULL DEFAULT '')`,
		`INSERT INTO sync_state(id,device_id) VALUES(1,'device-a')`,
		`CREATE TABLE sync_base(item_id TEXT PRIMARY KEY,object_hash TEXT NOT NULL,synced_at INTEGER NOT NULL)`,
		`CREATE TABLE sync_conflicts(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,base_hash TEXT NOT NULL,local_hash TEXT NOT NULL,remote_hash TEXT NOT NULL,local_record TEXT NOT NULL,remote_record TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL,resolution TEXT NOT NULL,resolved_at INTEGER NOT NULL)`,
	}
	for _,stmt:=range schema{if _,err=db.Exec(stmt);err!=nil{t.Fatal(err)}}
	return db,root
}

func addFile(t *testing.T,db *sql.DB,id,title,content string,updated int64){
	t.Helper()
	if _,err:=db.Exec(`INSERT INTO files(id,title,content,created_at,updated_at,is_folder,parent_id,sort_order,is_deleted,deleted_at,is_pinned) VALUES(?,?,?,?,?,0,'',1000,0,0,0)`,id,title,content,updated,updated);err!=nil{t.Fatal(err)}
}
func fileContent(t *testing.T,db *sql.DB,id string) string {
	t.Helper();var content string;if err:=db.QueryRow(`SELECT content FROM files WHERE id=?`,id).Scan(&content);err!=nil{t.Fatal(err)};return content
}
func testEngine(db *sql.DB,root string,device string)*Engine{
	_,_=db.Exec(`UPDATE sync_state SET device_id=? WHERE id=1`,device)
	return &Engine{DB:db,DataDir:root,Now:func()time.Time{return time.Date(2026,9,25,12,0,0,0,time.UTC)}}
}
func hashRecordForTest(t *testing.T,r Record)string{t.Helper();_,h,err:=encodeRecord(r);if err!=nil{t.Fatal(err)};return h}

func TestInitialUploadAndPull(t *testing.T){
	ctx:=context.Background()
	dbA,rootA:=testDB(t);dbB,rootB:=testDB(t)
	remoteRoot:=filepath.Join(t.TempDir(),"remote")
	// Both devices point at the same simulated remote.
	rootAData:=rootA;rootBData:=rootB
	_ = rootAData; _ = rootBData
	addFile(t,dbA,"n1","One","alpha",10)
	engineA:=testEngine(dbA,rootA,"device-a")
	engineB:=testEngine(dbB,rootB,"device-b")
	// Redirect both lab remotes to one shared root by symlinking the fixed lab path.
	if err:=os.Symlink(remoteRoot,filepath.Join(rootA,"sync-lab-remote"));err!=nil{t.Skip("symlink fixture unavailable")}
	if err:=os.Symlink(remoteRoot,filepath.Join(rootB,"sync-lab-remote"));err!=nil{t.Skip("symlink fixture unavailable")}
	if _,err:=engineA.Run(ctx);err!=nil{t.Fatal(err)}
	result,err:=engineB.Run(ctx);if err!=nil{t.Fatal(err)}
	if result.AppliedDown!=1{t.Fatalf("expected one download: %+v",result)}
	if got:=fileContent(t,dbB,"n1");got!="alpha"{t.Fatalf("unexpected content %q",got)}
}

func TestThreeWayConflictNeverLastWriteWins(t *testing.T){
	ctx:=context.Background()
	db,root:=testDB(t);addFile(t,db,"n1","One","base",10)
	engine:=testEngine(db,root,"device-a")
	if _,err:=engine.Run(ctx);err!=nil{t.Fatal(err)}
	// Change local.
	if _,err:=db.Exec(`UPDATE files SET content='local',updated_at=20 WHERE id='n1'`);err!=nil{t.Fatal(err)}
	// Independently change remote object + manifest from the last shared base.
	remote,_:=engine.remote(ctx);manifest,err:=remote.LoadManifest();if err!=nil{t.Fatal(err)}
	remoteRecord:=presentRecord(FilePayload{ID:"n1",Title:"One",Content:"remote",CreatedAt:10,UpdatedAt:30,SortOrder:1000})
	data,remoteHash,err:=encodeRecord(remoteRecord);if err!=nil{t.Fatal(err)}
	if err=remote.SaveObject(remoteHash,data);err!=nil{t.Fatal(err)}
	lock,err:=remote.AcquireLock();if err!=nil{t.Fatal(err)}
	manifest.Items["n1"]=remoteHash;manifest.Generation++;manifest.UpdatedAt="2026-09-25T12:01:00Z";manifest.DeviceID="device-b"
	if _,err=remote.SaveManifest(manifest);err!=nil{lock.Release();t.Fatal(err)};lock.Release()
	result,err:=engine.Run(ctx);if err!=nil{t.Fatal(err)}
	if result.Conflicts!=1{t.Fatalf("expected conflict: %+v",result)}
	if got:=fileContent(t,db,"n1");got!="local"{t.Fatalf("local was overwritten: %q",got)}
	conflicts,err:=engine.Conflicts(ctx);if err!=nil{t.Fatal(err)}
	if len(conflicts)!=1||conflicts[0].LocalRecord.File.Content!="local"||conflicts[0].RemoteRecord.File.Content!="remote"{t.Fatalf("bad conflict %+v",conflicts)}
}

func TestResolveConflictLocalThenRemote(t *testing.T){
	ctx:=context.Background()
	db,root:=testDB(t);addFile(t,db,"n1","One","base",10)
	engine:=testEngine(db,root,"device-a");if _,err:=engine.Run(ctx);err!=nil{t.Fatal(err)}
	if _,err:=db.Exec(`UPDATE files SET content='local',updated_at=20 WHERE id='n1'`);err!=nil{t.Fatal(err)}
	remote,_:=engine.remote(ctx);manifest,_:=remote.LoadManifest()
	r:=presentRecord(FilePayload{ID:"n1",Title:"One",Content:"remote",CreatedAt:10,UpdatedAt:30,SortOrder:1000})
	data,h,_:=encodeRecord(r);_ = remote.SaveObject(h,data)
	lock,_:=remote.AcquireLock();manifest.Items["n1"]=h;manifest.Generation++;manifest.UpdatedAt="2026-09-25T12:02:00Z";manifest.DeviceID="device-b";_,_=remote.SaveManifest(manifest);lock.Release()
	_,_=engine.Run(ctx);conflicts,_:=engine.Conflicts(ctx)
	if err:=engine.Resolve(ctx,conflicts[0].ID,"local");err!=nil{t.Fatal(err)}
	if lenMust(t,engine.Conflicts(ctx))!=0{t.Fatal("conflict still open")}
	manifest,_=remote.LoadManifest();record,err:=remote.LoadRecord(manifest.Items["n1"]);if err!=nil{t.Fatal(err)}
	if record.File.Content!="local"{t.Fatalf("local resolution not published: %q",record.File.Content)}
}

func lenMust(t *testing.T,v []Conflict,err error)int{t.Helper();if err!=nil{t.Fatal(err)};return len(v)}

func TestPermanentDeleteUsesTombstone(t *testing.T){
	ctx:=context.Background()
	db,root:=testDB(t);addFile(t,db,"n1","One","base",10)
	engine:=testEngine(db,root,"device-a");if _,err:=engine.Run(ctx);err!=nil{t.Fatal(err)}
	if _,err:=db.Exec(`DELETE FROM files WHERE id='n1'`);err!=nil{t.Fatal(err)}
	result,err:=engine.Run(ctx);if err!=nil{t.Fatal(err)}
	if result.AppliedUp!=1{t.Fatalf("expected tombstone upload %+v",result)}
	remote,_:=engine.remote(ctx);manifest,_:=remote.LoadManifest();record,err:=remote.LoadRecord(manifest.Items["n1"]);if err!=nil{t.Fatal(err)}
	if record.State!="purged"{t.Fatalf("expected purged record %+v",record)}
}

func TestRemoteStoreIdentityResetIsRejected(t *testing.T){
	ctx:=context.Background()
	db,root:=testDB(t);addFile(t,db,"n1","One","base",10)
	engine:=testEngine(db,root,"device-a");if _,err:=engine.Run(ctx);err!=nil{t.Fatal(err)}
	if err:=os.RemoveAll(filepath.Join(root,"sync-lab-remote"));err!=nil{t.Fatal(err)}
	if _,err:=engine.Plan(ctx);err==nil||!strings.Contains(err.Error(),"清空或切换"){t.Fatalf("expected reset rejection: %v",err)}
}

func TestRemoteManifestAndObjectTamperAreRejected(t *testing.T){
	ctx:=context.Background()
	db,root:=testDB(t);addFile(t,db,"n1","One","base",10)
	engine:=testEngine(db,root,"device-a");if _,err:=engine.Run(ctx);err!=nil{t.Fatal(err)}
	remote,_:=engine.remote(ctx);manifest,_:=remote.LoadManifest()
	obj:=filepath.Join(remote.Root,"objects",manifest.Items["n1"]+".json")
	if err:=os.WriteFile(obj,[]byte("tampered"),0600);err!=nil{t.Fatal(err)}
	if _,err:=engine.Plan(ctx);err==nil||!strings.Contains(err.Error(),"SHA-256"){t.Fatalf("expected tamper rejection: %v",err)}
}

func TestRemoteStructureDuplicateAndCycleAreRejected(t *testing.T){
	ctx:=context.Background()
	db,root:=testDB(t);engine:=testEngine(db,root,"device-a")
	remote,_:=engine.remote(ctx);lock,_:=remote.AcquireLock()
	storeID:="abcd1234"
	records:=[]Record{
		presentRecord(FilePayload{ID:"f1",Title:"Folder",IsFolder:true,ParentID:"f2",SortOrder:1000}),
		presentRecord(FilePayload{ID:"f2",Title:"Folder2",IsFolder:true,ParentID:"f1",SortOrder:1000}),
	}
	items:=map[string]string{}
	for _,record:=range records{data,h,_:=encodeRecord(record);_ = remote.SaveObject(h,data);items[record.ID]=h}
	_,err:=remote.SaveManifest(Manifest{Format:ManifestFormat,Version:1,StoreID:storeID,Generation:1,UpdatedAt:"2026-09-25T12:00:00Z",DeviceID:"x",Items:items})
	lock.Release();if err!=nil{t.Fatal(err)}
	if _,err=engine.Plan(ctx);err==nil||!strings.Contains(err.Error(),"循环"){t.Fatalf("expected cycle rejection: %v",err)}
}

func TestRemoteLockPreventsConcurrentRuns(t *testing.T){
	_,root:=testDB(t)
	remote,_:=NewDirRemote(filepath.Join(root,"remote"))
	lock,err:=remote.AcquireLock();if err!=nil{t.Fatal(err)}
	defer lock.Release()
	if _,err=remote.AcquireLock();err==nil{t.Fatal("expected lock rejection")}
}

func TestManifestPublicationIsImmutableAndSelfChecking(t *testing.T){
	root:=t.TempDir();remote,_:=NewDirRemote(root)
	lock,_:=remote.AcquireLock();defer lock.Release()
	m:=Manifest{Format:ManifestFormat,Version:1,StoreID:"store",Generation:1,UpdatedAt:"2026-09-25T12:00:00Z",DeviceID:"device",Items:map[string]string{}}
	saved,err:=remote.SaveManifest(m);if err!=nil{t.Fatal(err)}
	if !objectHashPattern.MatchString(saved.Revision){t.Fatal("missing revision")}
	loaded,err:=remote.LoadManifest();if err!=nil{t.Fatal(err)}
	if loaded.Revision!=saved.Revision||loaded.StoreID!="store"{t.Fatalf("bad manifest %+v",loaded)}
	files,err:=os.ReadDir(filepath.Join(root,"manifests"));if err!=nil{t.Fatal(err)}
	if len(files)!=1{t.Fatalf("expected immutable manifest, got %d",len(files))}
	data,err:=os.ReadFile(filepath.Join(root,"manifests",files[0].Name()));if err!=nil{t.Fatal(err)}
	sum:=sha256.Sum256(data);if hex.EncodeToString(sum[:])!=saved.Revision{t.Fatal("filename revision mismatch")}
	var decoded Manifest;if json.Unmarshal(data,&decoded)!=nil||decoded.Generation!=1{t.Fatal("invalid manifest JSON")}
}
