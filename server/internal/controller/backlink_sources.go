package controller
import (
 "context"
 "time"
 "github.com/gogf/gf/v2/net/ghttp"
)
func(c *FileController) BacklinkSources(r *ghttp.Request){
 if c.LinkDAO==nil {writeErr(r,2015,"反向链接服务未就绪",nil);return}
 ctx,cancel:=context.WithTimeout(r.GetCtx(),5*time.Second);defer cancel()
 out,err:=c.LinkDAO.BacklinkSources(ctx,r.Get("id").String())
 if err!=nil{writeErrWithDetail(r,2015,"反向来源读取失败",err);return};writeOK(r,out)
}
