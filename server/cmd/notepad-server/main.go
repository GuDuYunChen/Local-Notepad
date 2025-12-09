package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"notepad-server/internal/api"
	"notepad-server/internal/middleware"
	"notepad-server/internal/service"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	_ "modernc.org/sqlite"
)

// 程序入口：启动 HTTP 服务并初始化数据库
func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dbPath := resolveDBPath()
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		g.Log().Fatal(ctx, fmt.Errorf("初始化数据目录失败: %w", err))
		return
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		g.Log().Fatal(ctx, fmt.Errorf("打开数据库失败: %w", err))
		return
	}
	defer db.Close()
	if _, err := db.Exec("PRAGMA journal_mode=WAL;"); err != nil {
		g.Log().Warning(ctx, fmt.Errorf("设置 WAL 失败: %w", err))
	}
	// 优化：设置同步模式为 NORMAL，平衡安全性与性能
	if _, err := db.Exec("PRAGMA synchronous=NORMAL;"); err != nil {
		g.Log().Warning(ctx, fmt.Errorf("设置 synchronous 失败: %w", err))
	}
	// 优化：增加缓存大小 (默认 2000 页 -> -64000 即 64MB)
	if _, err := db.Exec("PRAGMA cache_size=-64000;"); err != nil {
		g.Log().Warning(ctx, fmt.Errorf("设置 cache_size 失败: %w", err))
	}
	// 优化：存储临时表在内存中
	if _, err := db.Exec("PRAGMA temp_store=MEMORY;"); err != nil {
		g.Log().Warning(ctx, fmt.Errorf("设置 temp_store 失败: %w", err))
	}
	// 优化：启用 mmap，减少 I/O (256MB)
	if _, err := db.Exec("PRAGMA mmap_size=268435456;"); err != nil {
		g.Log().Warning(ctx, fmt.Errorf("设置 mmap_size 失败: %w", err))
	}

	if err := migrate(ctx, db); err != nil {
		g.Log().Fatal(ctx, fmt.Errorf("数据库迁移失败: %w", err))
		return
	}

	// 执行自动备份
	performBackup(ctx, db, dbPath)

	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := (&service.FileService{DB: db}).CleanupOldDeleted(ctx); err != nil {
					g.Log().Error(ctx, "自动清理失败:", err)
				} else {
					g.Log().Info(ctx, "自动清理完成")
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	s := g.Server()
	s.SetClientMaxBodySize(100 * 1024 * 1024) // 100MB for video uploads
	s.SetGraceful(true)

	uploadPath := "uploads"
	if info, err := os.Stat("server"); err == nil && info.IsDir() {
		uploadPath = filepath.Join("server", "uploads")
	}
	if err := os.MkdirAll(uploadPath, 0755); err != nil {
		g.Log().Warning(ctx, fmt.Errorf("创建上传目录失败: %w", err))
	}
	func() {
		entries, err := os.ReadDir(uploadPath)
		if err != nil {
			return
		}
		for _, e := range entries {
			if e.IsDir() {
				name := e.Name()
				srcDir := filepath.Join(uploadPath, name)
				files, err := os.ReadDir(srcDir)
				if err != nil || len(files) != 1 {
					continue
				}
				f := files[0]
				if f.IsDir() {
					continue
				}
				src := filepath.Join(srcDir, f.Name())
				dst := filepath.Join(uploadPath, name)
				tmp := filepath.Join(uploadPath, name+".tmp")
				if err := os.Rename(src, tmp); err != nil {
					continue
				}
				_ = os.RemoveAll(srcDir)
				_ = os.Rename(tmp, dst)
			}
		}
	}()

	s.AddStaticPath("/uploads", uploadPath)
	s.SetReadTimeout(10 * time.Second)
	s.SetWriteTimeout(10 * time.Second)
	s.Use(middleware.CORS, middleware.RecoverJSON, middleware.RequestLog)

	port := os.Getenv("PORT")
	if port == "" {
		port = "27121"
	}
	// 绑定端口（简化：绑定所有地址），端口来自环境变量或默认值
	// 仅用于本机应用通信，建议防火墙限制访问
	p, _ := strconv.Atoi(port)
	s.SetPort(p)

	// 健康检查
	s.BindHandler("GET:/api/health", func(r *ghttp.Request) {
		r.Response.WriteJson(g.Map{"code": 0, "message": "OK", "data": g.Map{"ts": time.Now().Unix()}})
	})

	// 注册业务路由
	group := s.Group("/api")
	fileAPI := &api.FileAPI{Svc: &service.FileService{DB: db}}
	settingsAPI := &api.SettingsAPI{Svc: &service.SettingsService{DB: db}}
	uploadAPI := &api.UploadAPI{}
	fileAPI.Register(group)
	settingsAPI.Register(group)
	uploadAPI.Register(group)

	// 优雅退出：监听系统信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		g.Log().Info(ctx, "收到退出信号，正在停止服务…")
		s.Shutdown()
		cancel()
	}()

	s.Run()
}

// 解析数据库文件路径（跨平台）
func resolveDBPath() string {
	base := os.Getenv("NOTEPAD_DATA")
	if base == "" {
		// Windows 使用 AppData，macOS 使用 Library，Linux 使用 ~/.notepad
		if home, err := os.UserHomeDir(); err == nil {
			switch os := runtimeOS(); os {
			case "windows":
				base = filepath.Join(home, "AppData", "Roaming", "Notepad")
			case "darwin":
				base = filepath.Join(home, "Library", "Application Support", "Notepad")
			default:
				base = filepath.Join(home, ".notepad")
			}
		} else {
			base = "."
		}
	}
	return filepath.Join(base, "data.db")
}

// 获取运行时系统名称
func runtimeOS() string {
	return runtime.GOOS
}

// 迁移初始化表结构
func migrate(ctx context.Context, db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            tags TEXT
        );`,
		`CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY,
            theme TEXT NOT NULL,
            editor_opts TEXT,
            sync_enabled INTEGER,
            sync_endpoint TEXT
        );`,
		`CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at DESC);`,
		`INSERT OR IGNORE INTO settings (id, theme) VALUES (1, 'light');`,
	}
	for _, s := range stmts {
		if _, err := db.ExecContext(ctx, s); err != nil {
			return fmt.Errorf("执行迁移失败: %w", err)
		}
	}

	// 增量迁移：添加 is_folder 和 parent_id 字段
	// 由于 SQLite 不支持 IF NOT EXISTS 的 ADD COLUMN，这里直接执行并忽略错误（主要是重复列错误）
	alterStmts := []string{
		"ALTER TABLE files ADD COLUMN is_folder INTEGER DEFAULT 0", // SQLite boolean is integer 0/1
		"ALTER TABLE files ADD COLUMN parent_id TEXT DEFAULT ''",
		"ALTER TABLE files ADD COLUMN sort_order INTEGER DEFAULT 0",
		"ALTER TABLE files ADD COLUMN is_deleted INTEGER DEFAULT 0",
		"ALTER TABLE files ADD COLUMN deleted_at INTEGER DEFAULT 0",
	}
	for _, s := range alterStmts {
		_, _ = db.ExecContext(ctx, s)
	}

	return nil
}

// 自动备份逻辑
func performBackup(ctx context.Context, db *sql.DB, dbPath string) {
	backupDir := filepath.Join(filepath.Dir(dbPath), "backups")
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		g.Log().Error(ctx, "创建备份目录失败:", err)
		return
	}

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		g.Log().Error(ctx, "读取备份目录失败:", err)
		return
	}

	var backups []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "backup-") && strings.HasSuffix(e.Name(), ".db") {
			backups = append(backups, e.Name())
		}
	}
	// 按文件名排序（时间戳格式保证顺序）
	sort.Strings(backups)

	shouldBackup := true
	if len(backups) > 0 {
		lastBackup := backups[len(backups)-1]
		// 解析文件名中的时间戳 backup-20060102-150405.db
		tsStr := strings.TrimSuffix(strings.TrimPrefix(lastBackup, "backup-"), ".db")
		if lastTime, err := time.Parse("20060102-150405", tsStr); err == nil {
			// 如果距离上次备份不足 3 天，则跳过
			if time.Since(lastTime) < 1*24*time.Hour {
				shouldBackup = false
			}
		}
	}

	if shouldBackup {
		newBackupName := fmt.Sprintf("backup-%s.db", time.Now().Format("20060102-150405"))
		newBackupPath := filepath.Join(backupDir, newBackupName)

		// 使用 VACUUM INTO 进行热备份
		// 注意：VACUUM INTO 需要 SQLite 3.27.0+
		// 这里使用参数化查询可能不被支持，直接拼接路径（路径由代码生成，相对安全）
		// 为了防止路径中的反斜杠问题（Windows），最好替换为正斜杠或转义
		// 但 sql.Exec 在处理字符串字面量时通常需要单引号

		// 简单处理：将路径中的 \ 替换为 /
		safePath := filepath.ToSlash(newBackupPath)

		_, err = db.ExecContext(ctx, fmt.Sprintf("VACUUM INTO '%s'", safePath))
		if err != nil {
			g.Log().Error(ctx, "执行备份失败:", err)
		} else {
			g.Log().Info(ctx, "备份成功:", newBackupName)
			backups = append(backups, newBackupName)
		}
	}

	// 保留最近 3 个备份
	if len(backups) > 3 {
		toDelete := len(backups) - 3
		for i := 0; i < toDelete; i++ {
			path := filepath.Join(backupDir, backups[i])
			if err := os.Remove(path); err != nil {
				g.Log().Warning(ctx, "删除旧备份失败:", path, err)
			} else {
				g.Log().Info(ctx, "删除旧备份:", backups[i])
			}
		}
	}
}

// 删除占位路由函数
