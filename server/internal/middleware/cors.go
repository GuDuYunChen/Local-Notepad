package middleware

import (
    "strings"

    "github.com/gogf/gf/v2/net/ghttp"
)

var allowedOrigins = []string{
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}

func isAllowedOrigin(origin string) bool {
    for _, allowed := range allowedOrigins {
        if origin == allowed {
            return true
        }
    }
    if strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:") {
        return true
    }
    return false
}

func CORS(r *ghttp.Request) {
    h := r.Response.Header()
    origin := r.Header.Get("Origin")
    if origin == "" || !isAllowedOrigin(origin) {
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
