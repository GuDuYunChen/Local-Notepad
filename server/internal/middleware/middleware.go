package middleware

import (
    "time"
    "github.com/gogf/gf/v2/net/ghttp"
    "github.com/gogf/gf/v2/frame/g"
)

// 恢复中间件：捕获 panic 并返回结构化错误
func RecoverJSON(r *ghttp.Request) {
    defer func() {
        if e := recover(); e != nil {
            g.Log().Error(r.GetCtx(), e)
            r.Response.WriteJson(g.Map{"code": 5000, "message": "服务内部错误", "data": nil})
        }
    }()
    r.Middleware.Next()
}

// 请求日志：记录方法、路径与耗时
func RequestLog(r *ghttp.Request) {
    start := time.Now()
    r.Middleware.Next()
    elapsed := time.Since(start)
    g.Log().Info(r.GetCtx(), r.Method, r.URL.Path, "耗时", elapsed.String())
}
