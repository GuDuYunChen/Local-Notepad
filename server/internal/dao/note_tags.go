package dao

import (
 "context"
 "database/sql"
 "errors"
 "fmt"
 "strings"
 "unicode"
 "unicode/utf8"
 "notepad-server/internal/model"
 "github.com/google/uuid"
)

const NoteTagCatalogLimit = 500
const NoteTagMembershipLimit = 50

type NoteTagSnapshot struct {
 FileID string `json:"file_id"`
 Complete bool `json:"complete"`
 Tags []*model.Tag `json:"tags"`
 Available []*model.Tag `json:"available"`
}
type NoteTagChange struct {
 TagID string `json:"tag_id"`
 Name string `json:"name"`
 Expected *bool `json:"expected_attached"`
 Attached *bool `json:"attached"`
}
func ValidateNoteTagName(name string) error {
 if !utf8.ValidString(name) || name != strings.TrimSpace(name) || utf8.RuneCountInString(name)<1 || utf8.RuneCountInString(name)>40 {
  return fmt.Errorf("标签名称须为1–40个字符，不能包含首尾空格")
 }
 for _, r := range name { if unicode.IsControl(r) { return fmt.Errorf("标签名称不能包含控制字符") } }
 return nil
}
func validateNoteTagID(id string) error {
 if id=="" || len(id)>128 || strings.TrimSpace(id)!=id || strings.ContainsAny(id,"\x00\r\n\t") { return fmt.Errorf("笔记或标签身份无效") }; return nil
}
func noteTagTarget(ctx context.Context, tx *sql.Tx, fileID string) error {
 if err:=validateNoteTagID(fileID);err!=nil{return err}
 var title string;var folder,deleted bool
 if err:=tx.QueryRowContext(ctx,`SELECT title,is_folder,is_deleted FROM files WHERE id=?`,fileID).Scan(&title,&folder,&deleted);err!=nil{return fmt.Errorf("笔记不存在或已移除")}
 if folder || deleted || strings.HasPrefix(title,TemplatePrefix) {return fmt.Errorf("只能整理现有普通笔记的标签")};return nil
}
func noteTagsInTx(ctx context.Context,tx *sql.Tx,fileID string)(*NoteTagSnapshot,error){
 if err:=noteTagTarget(ctx,tx,fileID);err!=nil{return nil,err}
 out:=&NoteTagSnapshot{FileID:fileID,Complete:true,Tags:make([]*model.Tag,0),Available:make([]*model.Tag,0)}
 rows,err:=tx.QueryContext(ctx,`SELECT t.id,t.name,COALESCE(t.color,''),EXISTS(SELECT 1 FROM file_tags ft WHERE ft.file_id=? AND ft.tag_id=t.id) FROM tags t ORDER BY t.name COLLATE NOCASE,t.id LIMIT 501`,fileID)
 if err!=nil{return nil,err}
 for rows.Next(){
  t:=&model.Tag{};var attached bool
  if err=rows.Scan(&t.ID,&t.Name,&t.Color,&attached);err!=nil{rows.Close();return nil,err}
  out.Available=append(out.Available,t);if attached{out.Tags=append(out.Tags,t)}
 }
 err=errors.Join(rows.Err(),rows.Close());if err!=nil{return nil,err}
 if len(out.Available)>NoteTagCatalogLimit{return nil,fmt.Errorf("标签库超过500项完整读取上限，未采用不完整列表")}
 var count int
 if err=tx.QueryRowContext(ctx,`SELECT count(*) FROM file_tags WHERE file_id=?`,fileID).Scan(&count);err!=nil{return nil,err}
 if count!=len(out.Tags){return nil,fmt.Errorf("标签关联不完整，未采用这份列表")}
 return out,nil
}
func(d *TagDAO) NoteTags(ctx context.Context,fileID string)(*NoteTagSnapshot,error){
 tx,err:=d.DB.BeginTx(ctx,&sql.TxOptions{ReadOnly:true});if err!=nil{return nil,err};defer tx.Rollback()
 out,err:=noteTagsInTx(ctx,tx,fileID);if err!=nil{return nil,err};if err=tx.Commit();err!=nil{return nil,err};return out,nil
}
// One atomic membership decision. This changes neither note content nor its save
// baseline. A retry is never automatic: the UI explicitly reads CURRENT tags.
func(d *TagDAO) ChangeNoteTag(ctx context.Context,fileID string,in NoteTagChange)(*NoteTagSnapshot,error){
 if err:=validateNoteTagID(in.TagID);err!=nil{return nil,err}
 if in.Expected==nil || in.Attached==nil{return nil,fmt.Errorf("必须提供确认时和目标标签状态")}
 tx,err:=d.DB.BeginTx(ctx,nil);if err!=nil{return nil,err};defer tx.Rollback()
 // Obtain the SQLite write reservation before reading the mutable membership.
 if _,err=tx.ExecContext(ctx,`DELETE FROM file_tags WHERE 0`);err!=nil{return nil,err}
 if err=noteTagTarget(ctx,tx,fileID);err!=nil{return nil,err}
 var name string
 if err=tx.QueryRowContext(ctx,`SELECT name FROM tags WHERE id=?`,in.TagID).Scan(&name);err!=nil{return nil,fmt.Errorf("标签已删除，请重新读取")}
 if name!=in.Name{return nil,fmt.Errorf("标签名称已变化，请重新读取")}
 var current bool
 if err=tx.QueryRowContext(ctx,`SELECT EXISTS(SELECT 1 FROM file_tags WHERE file_id=? AND tag_id=?)`,fileID,in.TagID).Scan(&current);err!=nil{return nil,err}
 if current!=*in.Expected{return nil,fmt.Errorf("标签状态已变化，未覆盖；请核对当前标签")}
 if *in.Attached && !current {
  var count int;if err=tx.QueryRowContext(ctx,`SELECT count(*) FROM file_tags WHERE file_id=?`,fileID).Scan(&count);err!=nil{return nil,err}
  if count>=NoteTagMembershipLimit{return nil,fmt.Errorf("单篇笔记最多分配50个标签")}
  _,err=tx.ExecContext(ctx,`INSERT INTO file_tags(file_id,tag_id) VALUES(?,?)`,fileID,in.TagID)
 } else if !*in.Attached && current { _,err=tx.ExecContext(ctx,`DELETE FROM file_tags WHERE file_id=? AND tag_id=?`,fileID,in.TagID) }
 if err!=nil{return nil,err};out,err:=noteTagsInTx(ctx,tx,fileID);if err!=nil{return nil,err}
 if err=ctx.Err();err!=nil{return nil,err};if err=tx.Commit();err!=nil{return nil,err};return out,nil
}
// Name uniqueness plus the same transaction means create-and-attach never leaves
// a newly created unused tag if attachment fails. Existing names are reused.
func(d *TagDAO) CreateAndAttachNoteTag(ctx context.Context,fileID,name string)(*NoteTagSnapshot,error){
 if err:=ValidateNoteTagName(name);err!=nil{return nil,err}
 tx,err:=d.DB.BeginTx(ctx,nil);if err!=nil{return nil,err};defer tx.Rollback()
 if _,err=tx.ExecContext(ctx,`DELETE FROM file_tags WHERE 0`);err!=nil{return nil,err}
 if err=noteTagTarget(ctx,tx,fileID);err!=nil{return nil,err}
 id:="";err=tx.QueryRowContext(ctx,`SELECT id FROM tags WHERE name=?`,name).Scan(&id)
 if err!=nil && err!=sql.ErrNoRows{return nil,err}
 if err==sql.ErrNoRows {
  var count int;if err=tx.QueryRowContext(ctx,`SELECT count(*) FROM tags`).Scan(&count);err!=nil{return nil,err}
  if count>=NoteTagCatalogLimit{return nil,fmt.Errorf("标签库已达500项上限")}
  id=uuid.NewString();if _,err=tx.ExecContext(ctx,`INSERT INTO tags(id,name,color) VALUES(?,?,'#7e5bef')`,id,name);err!=nil{return nil,err}
 }
 var attached bool;if err=tx.QueryRowContext(ctx,`SELECT EXISTS(SELECT 1 FROM file_tags WHERE file_id=? AND tag_id=?)`,fileID,id).Scan(&attached);err!=nil{return nil,err}
 if !attached{
  var count int;if err=tx.QueryRowContext(ctx,`SELECT count(*) FROM file_tags WHERE file_id=?`,fileID).Scan(&count);err!=nil{return nil,err}
  if count>=NoteTagMembershipLimit{return nil,fmt.Errorf("单篇笔记最多分配50个标签")}
  if _,err=tx.ExecContext(ctx,`INSERT INTO file_tags(file_id,tag_id) VALUES(?,?)`,fileID,id);err!=nil{return nil,err}
 }
 out,err:=noteTagsInTx(ctx,tx,fileID);if err!=nil{return nil,err};if err=ctx.Err();err!=nil{return nil,err}
 if err=tx.Commit();err!=nil{return nil,err};return out,nil
}
