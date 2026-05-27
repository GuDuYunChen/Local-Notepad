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

	"notepad-server/internal/controller"
	"notepad-server/internal/dao"
	"notepad-server/internal/logic"
	"notepad-server/internal/middleware"

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

	// 启动定时任务
	go func() {
		backupTicker := time.NewTicker(8 * time.Hour)
		defer backupTicker.Stop()
		
		cleanupTicker := time.NewTicker(24 * time.Hour)
		defer cleanupTicker.Stop()
		
		fileLogic := &logic.FileLogic{FileDAO: &dao.FileDAO{DB: db}}
		
		for {
			select {
			case <-backupTicker.C:
				g.Log().Info(ctx, "开始执行定时备份...")
				performBackup(ctx, db, dbPath)
			case <-cleanupTicker.C:
				if err := fileLogic.CleanupOldDeleted(ctx); err != nil {
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
	
	fileDAO := &dao.FileDAO{DB: db}
	linkDAO := &dao.LinkDAO{DB: db}
	versionDAO := &dao.VersionDAO{DB: db}
	fileLogic := &logic.FileLogic{FileDAO: fileDAO, LinkDAO: linkDAO, VersionDAO: versionDAO}
	fileController := &controller.FileController{FileLogic: fileLogic, LinkDAO: linkDAO}
	
	settingsDAO := &dao.SettingsDAO{DB: db}
	settingsLogic := &logic.SettingsLogic{SettingsDAO: settingsDAO}
	settingsController := &controller.SettingsController{SettingsLogic: settingsLogic}
	
	tagDAO := &dao.TagDAO{DB: db}
	tagLogic := &logic.TagLogic{TagDAO: tagDAO}
	tagController := &controller.TagController{TagLogic: tagLogic}
	
	uploadController := &controller.UploadController{}
	
	fileController.Register(group)
	settingsController.Register(group)
	uploadController.Register(group)
	tagController.Register(group)

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
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("创建迁移表失败: %w", err)
	}

	migrations := []struct {
		version int
		stmts   []string
	}{
		{
			version: 1,
			stmts: []string{
				`CREATE TABLE IF NOT EXISTS files (
					id TEXT PRIMARY KEY,
					title TEXT NOT NULL,
					content TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL,
					tags TEXT
				)`,
				`CREATE TABLE IF NOT EXISTS settings (
					id INTEGER PRIMARY KEY,
					theme TEXT NOT NULL,
					editor_opts TEXT,
					sync_enabled INTEGER,
					sync_endpoint TEXT
				)`,
				`CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at DESC)`,
				`INSERT OR IGNORE INTO settings (id, theme) VALUES (1, 'light')`,
			},
		},
		{
			version: 2,
			stmts: []string{
				"ALTER TABLE files ADD COLUMN is_folder INTEGER DEFAULT 0",
				"ALTER TABLE files ADD COLUMN parent_id TEXT DEFAULT ''",
				"ALTER TABLE files ADD COLUMN sort_order INTEGER DEFAULT 0",
			},
		},
		{
			version: 3,
			stmts: []string{
				"ALTER TABLE files ADD COLUMN is_deleted INTEGER DEFAULT 0",
				"ALTER TABLE files ADD COLUMN deleted_at INTEGER DEFAULT 0",
				"ALTER TABLE files ADD COLUMN is_pinned INTEGER DEFAULT 0",
			},
		},
		{
			version: 4,
			stmts: []string{
				`CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT DEFAULT '#7e5bef')`,
				`CREATE TABLE IF NOT EXISTS file_tags (file_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (file_id, tag_id), FOREIGN KEY (file_id) REFERENCES files(id), FOREIGN KEY (tag_id) REFERENCES tags(id))`,
			},
		},
		{
			version: 5,
			stmts: []string{
				`CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(title, content, content='files', content_rowid='rowid')`,
				`CREATE TRIGGER IF NOT EXISTS files_fts_insert AFTER INSERT ON files BEGIN INSERT INTO files_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content); END`,
				`CREATE TRIGGER IF NOT EXISTS files_fts_update AFTER UPDATE ON files BEGIN UPDATE files_fts SET title=new.title, content=new.content WHERE rowid=new.rowid; END`,
				`CREATE TRIGGER IF NOT EXISTS files_fts_delete AFTER DELETE ON files BEGIN DELETE FROM files_fts WHERE rowid=old.rowid; END`,
			},
		},
		{
			version: 6,
			stmts: []string{
				`CREATE TABLE IF NOT EXISTS links (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					source_id TEXT NOT NULL,
					target_id TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					UNIQUE(source_id, target_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)`,
				`CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)`,
			},
		},
		{
			version: 7,
			stmts: []string{
				`CREATE TABLE IF NOT EXISTS file_versions (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					file_id TEXT NOT NULL,
					content TEXT NOT NULL,
					title TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					FOREIGN KEY (file_id) REFERENCES files(id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON file_versions(file_id)`,
				`CREATE INDEX IF NOT EXISTS idx_file_versions_created_at ON file_versions(created_at DESC)`,
			},
		},
	}

	var currentVersion int
	err := db.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&currentVersion)
	if err != nil {
		return fmt.Errorf("查询当前版本失败: %w", err)
	}

	for _, m := range migrations {
		if m.version <= currentVersion {
			continue
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("开始迁移 %d 失败: %w", m.version, err)
		}

		allSuccess := true
		for _, stmt := range m.stmts {
			if _, err := tx.ExecContext(ctx, stmt); err != nil {
				allSuccess = false
				if strings.Contains(err.Error(), "duplicate column name") || strings.Contains(err.Error(), "table already exists") {
					g.Log().Debug(ctx, fmt.Sprintf("迁移 %d 跳过(已存在): %s", m.version, stmt))
				} else {
					g.Log().Warning(ctx, fmt.Sprintf("迁移 %d 语句失败: %s, 错误: %v", m.version, stmt, err))
				}
			}
		}

		if allSuccess {
			if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, m.version, time.Now().Unix()); err != nil {
				tx.Rollback()
				return fmt.Errorf("记录迁移版本 %d 失败: %w", m.version, err)
			}
			if err := tx.Commit(); err != nil {
				return fmt.Errorf("提交迁移 %d 失败: %w", m.version, err)
			}
			g.Log().Info(ctx, fmt.Sprintf("数据库迁移已应用: 版本 %d", m.version))
		} else {
			tx.Rollback()
			g.Log().Info(ctx, fmt.Sprintf("迁移 %d 部分语句已存在，跳过版本记录", m.version))
		}
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
			// 如果距离上次备份不足 8 小时，则跳过
			if time.Since(lastTime) < 8*time.Hour {
				shouldBackup = false
				g.Log().Debug(ctx, "距离上次备份不足8小时，跳过本次备份")
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

	// 保留最近 100 个备份
	if len(backups) > 100 {
		toDelete := len(backups) - 100
		g.Log().Info(ctx, fmt.Sprintf("当前备份数量: %d，需要删除 %d 个旧备份", len(backups), toDelete))
		
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
