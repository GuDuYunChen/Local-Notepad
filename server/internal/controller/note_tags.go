package controller

import (
 "context"
 "notepad-server/internal/dao"
 "github.com/gogf/gf/v2/net/ghttp"
 "time"
)
func(c *TagController) RegisterNoteTags(group *ghttp.RouterGroup){
 group.GET("/note-tags/{file_id}",c.NoteTags)
 group.PUT("/note-tags/{file_id}",c.ChangeNoteTag)
 group.POST("/note-tags/{file_id}",c.CreateAndAttachNoteTag)
}
func(c *TagController) NoteTags(r *ghttp.Request){
 ctx,cancel:=context.WithTimeout(r.GetCtx(),5*time.Second);defer cancel()
 out,err:=c.TagLogic.TagDAO.NoteTags(ctx,r.Get("file_id").String())
 if err!=nil{writeErrWithDetail(r,2012,"读取笔记标签失败",err);return};writeOK(r,out)
}
func(c *TagController) ChangeNoteTag(r *ghttp.Request){
 var in dao.NoteTagChange
 if err:=r.Parse(&in);err!=nil{writeErr(r,2013,"标签操作参数无效",err);return}
 ctx,cancel:=context.WithTimeout(r.GetCtx(),5*time.Second);defer cancel()
 out,err:=c.TagLogic.TagDAO.ChangeNoteTag(ctx,r.Get("file_id").String(),in)
 if err!=nil{writeErrWithDetail(r,2014,"标签修改未确认",err);return};writeOK(r,out)
}
func(c *TagController) CreateAndAttachNoteTag(r *ghttp.Request){
 var in struct{Name string `json:"name"`}
 if err:=r.Parse(&in);err!=nil{writeErr(r,2013,"标签名称无效",err);return}
 ctx,cancel:=context.WithTimeout(r.GetCtx(),5*time.Second);defer cancel()
 out,err:=c.TagLogic.TagDAO.CreateAndAttachNoteTag(ctx,r.Get("file_id").String(),in.Name)
 if err!=nil{writeErrWithDetail(r,2014,"创建和分配标签未确认",err);return};writeOK(r,out)
}
