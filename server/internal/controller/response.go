package controller

import (
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
)

func writeOK(r *ghttp.Request, data interface{}) {
	r.Response.WriteJson(g.Map{"code": 0, "message": "OK", "data": data})
}

func writeErr(r *ghttp.Request, code int, msg string, err error) {
	r.Response.WriteJson(g.Map{"code": code, "message": msg, "data": nil})
}
