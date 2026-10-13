package dao

import (
 "context"
 "database/sql"
 "path/filepath"
 "sync"
 "testing"
 "notepad-server/internal/model"
)

func TestDailyDateValidation(t *testing.T) {
 for _, date := range []string{"2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"} { if !ValidDailyDate(date) { t.Fatalf("valid date refused: %s", date) } }
 for _, date := range []string{"2025-02-29", "1900-02-29", "2026-04-31", "0000-01-01", "2026-2-01", "", "../note"} {
  if ValidDailyDate(date) { t.Fatalf("invalid date admitted: %s", date) }
  if _, _, err := (&FileDAO{}).OpenDaily(context.Background(), date, false); err == nil { t.Fatal("invalid date must fail before DB access") }
 }
}
func TestDailyReadOnlyCreateAndPreserve(t *testing.T) {
 d := newSearchTestDAO(t); d.DB.SetMaxOpenConns(1); ctx := context.Background()
 f, created, err := d.OpenDaily(ctx, "2026-10-13", true)
 if err != nil || f != nil || created { t.Fatalf("read-only missing: %v %v %v", f, created, err) }
 first, created, err := d.OpenDaily(ctx, "2026-10-13", false)
 if err != nil || !created || first.Content != "" || first.ParentID != "" { t.Fatalf("create: %v %v %v", first, created, err) }
 first.Content = "unchanged existing body"; if err := d.Update(ctx, first); err != nil { t.Fatal(err) }
 second, created, err := d.OpenDaily(ctx, "2026-10-13", false)
 if err != nil || created || second.ID != first.ID || second.Content != first.Content || second.UpdatedAt != first.UpdatedAt { t.Fatalf("existing mutated: %v %v %v", second, created, err) }
 var count int; if err := d.DB.QueryRow("SELECT COUNT(*) FROM files_fts").Scan(&count); err != nil || count != 1 { t.Fatalf("FTS trigger count %d: %v", count, err) }
}
func TestDailyRootScopeTrashAndConflicts(t *testing.T) {
 ctx := context.Background()
 t.Run("child untouched", func(t *testing.T) {
  d := newSearchTestDAO(t); d.DB.SetMaxOpenConns(1)
  if err := d.Create(ctx, &model.File{ID:"child",Title:"2026-10-13",ParentID:"folder",Content:"child body"}); err != nil { t.Fatal(err) }
  f, created, err := d.OpenDaily(ctx,"2026-10-13",false)
  if err != nil || !created || f.ID == "child" { t.Fatalf("wrong scope: %v %v", f, err) }
  child, err := d.GetByID(ctx,"child"); if err != nil || child.Content != "child body" { t.Fatal("child overwritten") }
 })
 for _, kind := range []string{"folder","duplicate"} { t.Run(kind,func(t *testing.T) {
  d := newSearchTestDAO(t); d.DB.SetMaxOpenConns(1)
  if err := d.Create(ctx, &model.File{ID:"first",Title:"2026-10-13",Content:"preserve",IsFolder:kind=="folder"}); err != nil { t.Fatal(err) }
  if kind=="duplicate" { if err := d.Create(ctx,&model.File{ID:"second",Title:"2026-10-13",Content:"also preserve"}); err != nil {t.Fatal(err)} }
  for _, ro := range []bool{true,false} { if _,_,err := d.OpenDaily(ctx,"2026-10-13",ro); err==nil { t.Fatal("ambiguous identity admitted") } }
  first,err := d.GetByID(ctx,"first");if err!=nil||first.Content!="preserve"{t.Fatal("conflict overwrote data")}
 }) }
 t.Run("trash is never implicitly restored",func(t *testing.T){
  d:=newSearchTestDAO(t);d.DB.SetMaxOpenConns(1)
  old,_,err:=d.OpenDaily(ctx,"2026-10-13",false);if err!=nil{t.Fatal(err)}
  if err=d.DeleteRecursive(ctx,old.ID);err!=nil{t.Fatal(err)}
  current,created,err:=d.OpenDaily(ctx,"2026-10-13",false);if err!=nil||!created||current.ID==old.ID{t.Fatalf("recreated: %v %v",current,err)}
  previous,err:=d.GetByIDIncludingDeleted(ctx,old.ID);if err!=nil||!previous.IsDeleted{t.Fatal("trash resurrected")}
 })
}
func TestDailyConcurrentDiskConnectionsHaveOneIdentity(t *testing.T) {
 db,err:=sql.Open("sqlite",filepath.Join(t.TempDir(),"daily.db")+"?_pragma=busy_timeout(5000)")
 if err!=nil{t.Fatal(err)};defer db.Close();db.SetMaxOpenConns(8)
 _,err=db.Exec(`CREATE TABLE files(id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,is_folder INTEGER DEFAULT 0,parent_id TEXT DEFAULT '',sort_order INTEGER DEFAULT 0,is_deleted INTEGER DEFAULT 0,deleted_at INTEGER DEFAULT 0,is_pinned INTEGER DEFAULT 0)`)
 if err!=nil{t.Fatal(err)}
 d:=&FileDAO{DB:db};var wg sync.WaitGroup;var mu sync.Mutex;ids:=map[string]bool{};createdCount:=0
 for n:=0;n<24;n++{wg.Add(1);go func(){defer wg.Done();f,created,err:=d.OpenDaily(context.Background(),"2026-10-13",false);mu.Lock();defer mu.Unlock();if err!=nil{t.Errorf("concurrent request: %v",err);return};ids[f.ID]=true;if created{createdCount++}}()}
 wg.Wait();if len(ids)!=1||createdCount!=1{t.Fatalf("identities=%d creates=%d",len(ids),createdCount)}
 var count int;if err=db.QueryRow("SELECT COUNT(*) FROM files").Scan(&count);err!=nil||count!=1{t.Fatalf("rows=%d err=%v",count,err)}
 ctx,cancel:=context.WithCancel(context.Background());cancel();if _,_,err=d.OpenDaily(ctx,"2026-10-14",false);err==nil{t.Fatal("cancelled creation succeeded")}
 f,_,err:=d.OpenDaily(context.Background(),"2026-10-14",true);if err!=nil||f!=nil{t.Fatal("cancelled date was created")}
}
