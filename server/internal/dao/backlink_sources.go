package dao

import (
 "context"
 "database/sql"
 "errors"
 "fmt"
 "strings"
)
const BacklinkSourceLimit = 200
const BacklinkBodyLimit = 2 * 1024 * 1024
const BacklinkTotalLimit = 8 * 1024 * 1024

type BacklinkFile struct {
 ID string `json:"id"`
 Title string `json:"title"`
 Content string `json:"content"`
 UpdatedAt int64 `json:"updated_at"`
 IsFolder bool `json:"is_folder"`
 IsDeleted bool `json:"is_deleted"`
}
type BacklinkSource struct {
 LinkID int64 `json:"link_id"`
 SourceID string `json:"source_id"`
 IndexedAt int64 `json:"indexed_at"`
 Available bool `json:"available"`
 File *BacklinkFile `json:"file"`
}
type BacklinkSnapshot struct {
 FileID string `json:"file_id"`
 Complete bool `json:"complete"`
 IndexedCount int `json:"indexed_count"`
 Sources []*BacklinkSource `json:"sources"`
}
// Read one consistent snapshot of the existing index and saved source bodies.
// Unavailable sources remain counted but their deleted/template bodies are never returned.
// This does not rebuild links or write to files, references, receipts or timestamps.
func(d *LinkDAO) BacklinkSources(ctx context.Context,id string)(*BacklinkSnapshot,error){
 if id=="" || len(id)>128 || strings.TrimSpace(id)!=id || strings.ContainsAny(id,"\x00\r\n\t") {return nil,fmt.Errorf("笔记身份无效")}
 tx,err:=d.DB.BeginTx(ctx,&sql.TxOptions{ReadOnly:true});if err!=nil{return nil,err};defer tx.Rollback()
 var title string;var folder,deleted bool
 if err=tx.QueryRowContext(ctx,`SELECT title,is_folder,is_deleted FROM files WHERE id=?`,id).Scan(&title,&folder,&deleted);err!=nil{return nil,fmt.Errorf("目标笔记不存在")}
 if folder||deleted||strings.HasPrefix(title,TemplatePrefix){return nil,fmt.Errorf("只能查看现有普通笔记的反向链接")}
 const active=`f.id IS NOT NULL AND f.is_folder=0 AND f.is_deleted=0 AND substr(f.title,1,7)!='__tpl__'`
 const join=` FROM links l LEFT JOIN files f ON f.id=l.source_id WHERE l.target_id=?`
 var count int;var total,largest int64
 q:=`SELECT count(*),COALESCE(sum(CASE WHEN `+active+` THEN length(CAST(f.content AS BLOB)) ELSE 0 END),0),COALESCE(max(CASE WHEN `+active+` THEN length(CAST(f.content AS BLOB)) ELSE 0 END),0)`+join
 if err=tx.QueryRowContext(ctx,q,id).Scan(&count,&total,&largest);err!=nil{return nil,err}
 if count>BacklinkSourceLimit||total>BacklinkTotalLimit||largest>BacklinkBodyLimit{return nil,fmt.Errorf("反向来源超过完整读取上限（200个来源、单篇2MiB、合计8MiB），未采用截断结果")}
 q=`SELECT l.id,l.source_id,l.created_at,CASE WHEN `+active+` THEN f.title ELSE NULL END,CASE WHEN `+active+` THEN f.content ELSE NULL END,CASE WHEN `+active+` THEN f.updated_at ELSE NULL END`+join+` ORDER BY l.created_at DESC,l.id DESC`
 rows,err:=tx.QueryContext(ctx,q,id);if err!=nil{return nil,err}
 out:=&BacklinkSnapshot{FileID:id,Complete:true,IndexedCount:count,Sources:make([]*BacklinkSource,0,count)}
 for rows.Next(){
  item:=&BacklinkSource{};var title,body sql.NullString;var updated sql.NullInt64
  if err=rows.Scan(&item.LinkID,&item.SourceID,&item.IndexedAt,&title,&body,&updated);err!=nil{rows.Close();return nil,err}
  if title.Valid&&body.Valid&&updated.Valid{item.Available=true;item.File=&BacklinkFile{ID:item.SourceID,Title:title.String,Content:body.String,UpdatedAt:updated.Int64}}
  out.Sources=append(out.Sources,item)
 }
 if err=errors.Join(rows.Err(),rows.Close());err!=nil{return nil,err}
 if len(out.Sources)!=count{return nil,fmt.Errorf("反向来源读取不完整")}
 if err=ctx.Err();err!=nil{return nil,err};if err=tx.Commit();err!=nil{return nil,err};return out,nil
}
