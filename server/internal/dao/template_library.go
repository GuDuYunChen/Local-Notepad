package dao

import (
 "context"
 "fmt"
 "strings"
 "time"
 "unicode/utf8"
)

const TemplatePrefix = "__tpl__"
const TemplateBodyLimit = 256 * 1024

type LibraryTemplate struct {
 ID string `json:"id"`
 Title string `json:"title"`
 Content string `json:"content"`
 Archived bool `json:"archived"`
 UpdatedAt int64 `json:"updated_at"`
}

func ValidateTemplateName(title string) error {
 if title == "" || !utf8.ValidString(title) || title != strings.TrimSpace(title) || utf8.RuneCountInString(title)>120 || strings.ContainsAny(title,"<>:\"/\\|?*\x00\r\n\t") || strings.HasPrefix(title,TemplatePrefix) {
  return fmt.Errorf("模板名称须为1–120个有效字符，不能包含路径符号或首尾空格")
 }
 return nil
}
func ValidateTemplateBody(body string) error {
 if !utf8.ValidString(body) || len(body)>TemplateBodyLimit { return fmt.Errorf("模板正文编码无效或超过256 KiB，未截断或保存") }
 return nil
}
func readLibraryTemplate(ctx context.Context, q researchQuerier, id string) (*LibraryTemplate,error) {
 var t LibraryTemplate
 err:=q.QueryRowContext(ctx,`SELECT id,substr(title,8),content,is_deleted,updated_at FROM files
 WHERE id=? AND is_folder=0 AND parent_id='' AND substr(title,1,7)='__tpl__'`,id).Scan(&t.ID,&t.Title,&t.Content,&t.Archived,&t.UpdatedAt)
 return &t,err
}
func(d *FileDAO) LibraryTemplate(ctx context.Context,id string)(*LibraryTemplate,error){return readLibraryTemplate(ctx,d.DB,id)}
func(d *FileDAO) LibraryTemplates(ctx context.Context)([]*LibraryTemplate,error){
 rows,err:=d.DB.QueryContext(ctx,`SELECT id,substr(title,8),content,is_deleted,updated_at FROM files
 WHERE is_folder=0 AND parent_id='' AND substr(title,1,7)='__tpl__' ORDER BY updated_at DESC,id LIMIT 501`)
 if err!=nil{return nil,err};defer rows.Close()
 out:=make([]*LibraryTemplate,0);total:=0
 for rows.Next(){var t LibraryTemplate;if err=rows.Scan(&t.ID,&t.Title,&t.Content,&t.Archived,&t.UpdatedAt);err!=nil{return nil,err};total+=len(t.Content)
  if len(out)>=500||total>8*1024*1024{return nil,fmt.Errorf("模板库超过本次完整读取上限，未显示不完整列表")};out=append(out,&t)}
 if err=rows.Err();err!=nil{return nil,err};return out,nil
}
// The first SQL obtains the write lock. Exact old values and the template-only
// predicate are tested INSIDE the update, so a renamed/moved ordinary note can
// never be archived by a stale template dialog. No recursive deletion is used.
func(d *FileDAO) ChangeLibraryTemplate(ctx context.Context,id string,expected,next LibraryTemplate)(*LibraryTemplate,error){
 if id==""||id!=expected.ID||id!=next.ID{return nil,fmt.Errorf("模板身份不一致")}
 if err:=ValidateTemplateName(next.Title);err!=nil{return nil,err};if err:=ValidateTemplateBody(next.Content);err!=nil{return nil,err}
 if expected.Archived!=next.Archived&&(expected.Title!=next.Title||expected.Content!=next.Content){return nil,fmt.Errorf("移除或恢复模板不能混合修改正文")}
 tx,err:=d.DB.BeginTx(ctx,nil);if err!=nil{return nil,err};defer tx.Rollback()
 now:=time.Now().Unix();deletedAt:=int64(0);if next.Archived{deletedAt=now}
 r,err:=tx.ExecContext(ctx,`UPDATE files SET title=?,content=?,is_deleted=?,deleted_at=?,updated_at=?
 WHERE id=? AND is_folder=0 AND parent_id='' AND title=? AND content=? AND is_deleted=?
 AND substr(title,1,7)='__tpl__'
 AND (? OR NOT EXISTS(SELECT 1 FROM files other WHERE other.id<>? AND other.parent_id='' AND other.title=? COLLATE NOCASE AND other.is_deleted=0))`,
 TemplatePrefix+next.Title,next.Content,next.Archived,deletedAt,now,id,TemplatePrefix+expected.Title,expected.Content,expected.Archived,
 next.Archived,id,TemplatePrefix+next.Title)
 if err!=nil{return nil,err};n,err:=r.RowsAffected();if err!=nil{return nil,err}
 current,err:=readLibraryTemplate(ctx,tx,id);if err!=nil{return nil,err}
 if n==0&&(current.Title!=next.Title||current.Content!=next.Content||current.Archived!=next.Archived){return nil,fmt.Errorf("模板已变化或名称冲突，未覆盖；请刷新后重新确认")}
 if err=tx.Commit();err!=nil{return nil,err};return current,nil
}
func(d *FileDAO) ArchiveLibraryTemplate(ctx context.Context,id string)error{
 current,err:=d.LibraryTemplate(ctx,id);if err!=nil{return err};if current.Archived{return nil}
 next:=*current;next.Archived=true;_,err=d.ChangeLibraryTemplate(ctx,id,*current,next);return err
}
