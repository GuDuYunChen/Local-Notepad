package middleware

import (
    "github.com/gogf/gf/v2/net/ghttp"
)

func CORS(r *ghttp.Request) {
    h := r.Response.Header()
    origin := r.Header.Get("Origin")
    if origin == "" {
        origin = "*"
    }
    h.Set("Access-Control-Allow-Origin", origin)
    h.Set("Vary", "Origin")
    h.Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
    h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
    h.Set("Access-Control-Max-Age", "600")
    if r.Method == "OPTIONS" {
        r.Response.WriteStatus(204)
        return
    }
    r.Middleware.Next()
}
