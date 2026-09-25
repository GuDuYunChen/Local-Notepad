package main

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"notepad-server/internal/backup"
	"notepad-server/internal/controller"
	"notepad-server/internal/dao"
	"notepad-server/internal/logic"
	"notepad-server/internal/middleware"
	"notepad-server/internal/syncengine"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	_ "modernc.org/sqlite"
)

func configureDatabasePool(db *sql.DB) {
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
}

func applySQLitePragmas(ctx context.Context, db *sql.DB) {
	pragmas := []struct {
		name string
		sql  string
	}{
		{name: "WAL", sql: "PRAGMA journal_mode=WAL;"},
		{name: "synchronous", sql: "PRAGMA synchronous=NORMAL;"},
		{name: "busy_timeout", sql: "PRAGMA busy_timeout=5000;"},
		{name: "foreign_keys", sql: "PRAGMA foreign_keys=ON;"},
		{name: "cache_size", sql: "PRAGMA cache_size=-64000;"},
		{name: "temp_store", sql: "PRAGMA temp_store=MEMORY;"},
		{name: "mmap_size", sql: "PRAGMA mmap_size=268435456;"},
	}
	for _, pragma := range pragmas {
		if _, err := db.Exec(pragma.sql); err != nil {
			g.Log().Warning(ctx, fmt.Errorf("设置 %s 失败: %w", pragma.name, err))
		}
	}
}

// 程序入口：启动 HTTP 服务并初始化数据库
func main() {
	if len(os.Args) > 1 && os.Args[1] == "--data-safety" {
		runDataSafety(os.Args[2:])
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dbPath := resolveDBPath()
	if err := backup.CheckPending(dbPath); err != nil {
		g.Log().Fatal(ctx, err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		g.Log().Fatal(ctx, fmt.Errorf("初始化数据目录失败: %w", err))
		return
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		g.Log().Fatal(ctx, fmt.Errorf("打开数据库失败: %w", err))
		return
	}
	configureDatabasePool(db)
	defer func() {
		if db != nil {
			_ = db.Close()
		}
	}()

	// 检测数据库是否损坏
	if err := checkDatabaseIntegrity(db); err != nil {
		g.Log().Warning(ctx, fmt.Errorf("数据库完整性检查失败: %w", err))
		if closeErr := db.Close(); closeErr != nil {
			g.Log().Warning(ctx, fmt.Errorf("恢复前关闭数据库失败: %w", closeErr))
		}
		db = nil
		if recovered := tryRecoverDatabase(dbPath); recovered {
			g.Log().Info(ctx, "数据库已从备份恢复")
			db, err = sql.Open("sqlite", dbPath)
			if err != nil {
				g.Log().Fatal(ctx, fmt.Errorf("恢复后打开数据库失败: %w", err))
				return
			}
			configureDatabasePool(db)
			if err := checkDatabaseIntegrity(db); err != nil {
				g.Log().Fatal(ctx, fmt.Errorf("恢复后的数据库仍然损坏: %w", err))
				return
			}
		} else {
			g.Log().Fatal(ctx, "数据库损坏且无法恢复，请手动从备份恢复")
			return
		}
	}

	applySQLitePragmas(ctx, db)

	if err := migrate(ctx, db); err != nil {
		g.Log().Fatal(ctx, fmt.Errorf("数据库迁移失败: %w", err))
		return
	}
	if err := ensureCompatibleSchema(ctx, db); err != nil {
		g.Log().Fatal(ctx, fmt.Errorf("数据库兼容修复失败: %w", err))
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

	uploadPath := resolveUploadPath(dbPath)
	if err := os.MkdirAll(uploadPath, 0755); err != nil {
		g.Log().Warning(ctx, fmt.Errorf("创建上传目录失败: %w", err))
	}
	for _, legacyPath := range []string{"uploads", filepath.Join("server", "uploads")} {
		if copied, err := migrateLegacyUploads(legacyPath, uploadPath); err != nil {
			g.Log().Warning(ctx, fmt.Errorf("迁移旧上传目录失败 (%s): %w", legacyPath, err))
		} else if copied > 0 {
			g.Log().Info(ctx, fmt.Sprintf("已迁移 %d 个旧上传资源: %s", copied, legacyPath))
		}
	}
	flattenUploadEntries(uploadPath)

	s.AddStaticPath("/uploads", uploadPath)
	s.SetReadTimeout(10 * time.Second)
	s.SetWriteTimeout(10 * time.Second)
	s.Use(middleware.CORS, middleware.RecoverJSON, middleware.RequestLog)

	port := os.Getenv("PORT")
	if port == "" {
		port = "27121"
	}
	// 桌面应用仅通过本机回环地址访问后端，避免将笔记 API 暴露到局域网。
	p, _ := strconv.Atoi(port)
	s.SetAddr("127.0.0.1")
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

	uploadController := &controller.UploadController{UploadDir: uploadPath}
	syncEngine := &syncengine.Engine{DB: db, DataDir: filepath.Dir(dbPath), WebDAVPassword: os.Getenv("NOTEPAD_WEBDAV_PASSWORD")}
	syncController := &controller.SyncController{Engine: syncEngine}

	fileController.Register(group)
	settingsController.Register(group)
	uploadController.Register(group)
	tagController.Register(group)
	syncController.Register(group)

	// Background sync starts after the local API has had time to settle. The
	// engine itself enforces due-time, conflict and single-run guards.
	go syncengine.RunAutoScheduler(ctx, syncEngine, 15*time.Second, 30*time.Second)

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

func resolveUploadPath(dbPath string) string {
	return filepath.Join(filepath.Dir(dbPath), "uploads")
}

func copyFileIfMissing(src string, dst string) (bool, error) {
	if _, err := os.Stat(dst); err == nil {
		return false, nil
	} else if !os.IsNotExist(err) {
		return false, err
	}

	in, err := os.Open(src)
	if err != nil {
		return false, err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0644)
	if err != nil {
		if os.IsExist(err) {
			return false, nil
		}
		return false, err
	}

	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(dst)
		return false, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(dst)
		return false, closeErr
	}
	return true, nil
}

func migrateLegacyUploads(legacyPath string, targetPath string) (int, error) {
	legacyAbs, err := filepath.Abs(legacyPath)
	if err != nil {
		return 0, err
	}
	targetAbs, err := filepath.Abs(targetPath)
	if err != nil {
		return 0, err
	}
	if legacyAbs == targetAbs {
		return 0, nil
	}

	entries, err := os.ReadDir(legacyAbs)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	if err := os.MkdirAll(targetAbs, 0755); err != nil {
		return 0, err
	}

	copied := 0
	for _, entry := range entries {
		if entry.IsDir() {
			files, err := os.ReadDir(filepath.Join(legacyAbs, entry.Name()))
			if err != nil || len(files) != 1 || files[0].IsDir() {
				continue
			}
			src := filepath.Join(legacyAbs, entry.Name(), files[0].Name())
			dst := filepath.Join(targetAbs, entry.Name())
			ok, err := copyFileIfMissing(src, dst)
			if err != nil {
				return copied, err
			}
			if ok {
				copied++
			}
			continue
		}

		src := filepath.Join(legacyAbs, entry.Name())
		dst := filepath.Join(targetAbs, entry.Name())
		ok, err := copyFileIfMissing(src, dst)
		if err != nil {
			return copied, err
		}
		if ok {
			copied++
		}
	}
	return copied, nil
}

func flattenUploadEntries(uploadPath string) {
	entries, err := os.ReadDir(uploadPath)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		srcDir := filepath.Join(uploadPath, name)
		files, err := os.ReadDir(srcDir)
		if err != nil || len(files) != 1 || files[0].IsDir() {
			continue
		}
		src := filepath.Join(srcDir, files[0].Name())
		dst := filepath.Join(uploadPath, name)
		tmp := filepath.Join(uploadPath, name+".tmp")
		if err := os.Rename(src, tmp); err != nil {
			continue
		}
		_ = os.RemoveAll(srcDir)
		_ = os.Rename(tmp, dst)
	}
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
				`CREATE TRIGGER IF NOT EXISTS files_fts_insert AFTER INSERT ON files BEGIN INSERT INTO files_fts(rowid, title, content) VALUES (new.rowid, COALESCE(new.title, ''), COALESCE(new.content, '')); END`,
				`CREATE TRIGGER IF NOT EXISTS files_fts_update AFTER UPDATE ON files BEGIN UPDATE files_fts SET title=COALESCE(new.title, ''), content=COALESCE(new.content, '') WHERE rowid=new.rowid; END`,
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
		{
			version: 8,
			stmts: []string{
				`DROP TRIGGER IF EXISTS files_fts_insert`,
				`DROP TRIGGER IF EXISTS files_fts_update`,
				`DROP TRIGGER IF EXISTS files_fts_delete`,
				`CREATE TRIGGER files_fts_insert AFTER INSERT ON files BEGIN
					INSERT INTO files_fts(rowid, title, content)
					VALUES (new.rowid, COALESCE(new.title, ''), COALESCE(new.content, ''));
				END`,
				`CREATE TRIGGER files_fts_update AFTER UPDATE OF title, content ON files BEGIN
					INSERT INTO files_fts(files_fts, rowid, title, content)
					VALUES ('delete', old.rowid, COALESCE(old.title, ''), COALESCE(old.content, ''));
					INSERT INTO files_fts(rowid, title, content)
					VALUES (new.rowid, COALESCE(new.title, ''), COALESCE(new.content, ''));
				END`,
				`CREATE TRIGGER files_fts_delete AFTER DELETE ON files BEGIN
					INSERT INTO files_fts(files_fts, rowid, title, content)
					VALUES ('delete', old.rowid, COALESCE(old.title, ''), COALESCE(old.content, ''));
				END`,
				`INSERT INTO files_fts(files_fts) VALUES('rebuild')`,
			},
		},
		{
			version: 9,
			stmts: []string{
				`DELETE FROM file_tags
				 WHERE NOT EXISTS (SELECT 1 FROM files WHERE files.id = file_tags.file_id)
				    OR NOT EXISTS (SELECT 1 FROM tags WHERE tags.id = file_tags.tag_id)`,
				`DELETE FROM file_versions
				 WHERE NOT EXISTS (SELECT 1 FROM files WHERE files.id = file_versions.file_id)`,
				`DELETE FROM links
				 WHERE NOT EXISTS (SELECT 1 FROM files WHERE files.id = links.source_id)`,
			},
		},
		{version: 10, stmts: []string{dao.ResearchRequestsSchema}},
		{
			version: 11,
			stmts: []string{
				"ALTER TABLE settings ADD COLUMN sync_provider TEXT DEFAULT ''",
				`CREATE TABLE IF NOT EXISTS sync_state (
					id INTEGER PRIMARY KEY CHECK(id = 1),
					device_id TEXT NOT NULL,
					remote_store_id TEXT NOT NULL DEFAULT '',
					remote_revision TEXT NOT NULL DEFAULT '',
					last_sync_at INTEGER NOT NULL DEFAULT 0,
					last_status TEXT NOT NULL DEFAULT 'never',
					last_error TEXT NOT NULL DEFAULT ''
				)`,
				`INSERT OR IGNORE INTO sync_state(id, device_id)
				 VALUES(1, lower(hex(randomblob(16))))`,
				`CREATE TABLE IF NOT EXISTS sync_base (
					item_id TEXT PRIMARY KEY,
					object_hash TEXT NOT NULL,
					synced_at INTEGER NOT NULL
				)`,
				`CREATE TABLE IF NOT EXISTS sync_conflicts (
					id TEXT PRIMARY KEY,
					item_id TEXT NOT NULL,
					base_hash TEXT NOT NULL,
					local_hash TEXT NOT NULL,
					remote_hash TEXT NOT NULL,
					local_record TEXT NOT NULL,
					remote_record TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					status TEXT NOT NULL DEFAULT 'open',
					resolution TEXT NOT NULL DEFAULT '',
					resolved_at INTEGER NOT NULL DEFAULT 0
				)`,
				`CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status_created ON sync_conflicts(status, created_at DESC)`,
				`CREATE INDEX IF NOT EXISTS idx_sync_conflicts_item ON sync_conflicts(item_id, status)`,
			},
		},
		{
			version: 12,
			stmts: []string{
				"ALTER TABLE settings ADD COLUMN sync_username TEXT DEFAULT ''",
				"ALTER TABLE settings ADD COLUMN sync_password TEXT DEFAULT ''",
			},
		},
		{
			version: 13,
			stmts: []string{
				"ALTER TABLE settings ADD COLUMN sync_auto_enabled INTEGER DEFAULT 0",
				"ALTER TABLE settings ADD COLUMN sync_interval_minutes INTEGER DEFAULT 5",
			},
		},
	}

	var currentVersion int
	err := db.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&currentVersion)
	if err != nil {
		return fmt.Errorf("查询当前版本失败: %w", err)
	}

	if currentVersion > backup.SupportedSchemaVersion {
		return fmt.Errorf("数据库版本 %d 高于当前应用支持的版本，请勿降级打开", currentVersion)
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
				if strings.Contains(err.Error(), "duplicate column name") || strings.Contains(err.Error(), "table already exists") {
					// A partially upgraded legacy database may already contain an additive
					// schema element. Treat that as idempotent success so the remaining
					// statements can commit and the migration version can be recorded.
					g.Log().Debug(ctx, fmt.Sprintf("迁移 %d 跳过(已存在): %s", m.version, stmt))
					continue
				}
				allSuccess = false
				g.Log().Warning(ctx, fmt.Sprintf("迁移 %d 语句失败: %s, 错误: %v", m.version, stmt, err))
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

func ensureCompatibleSchema(ctx context.Context, db *sql.DB) error {
	requiredColumns := []struct {
		table      string
		column     string
		definition string
	}{
		{table: "files", column: "is_folder", definition: "INTEGER DEFAULT 0"},
		{table: "files", column: "parent_id", definition: "TEXT DEFAULT ''"},
		{table: "files", column: "sort_order", definition: "INTEGER DEFAULT 0"},
		{table: "files", column: "is_deleted", definition: "INTEGER DEFAULT 0"},
		{table: "files", column: "deleted_at", definition: "INTEGER DEFAULT 0"},
		{table: "files", column: "is_pinned", definition: "INTEGER DEFAULT 0"},
		{table: "settings", column: "sync_provider", definition: "TEXT DEFAULT ''"},
		{table: "settings", column: "sync_username", definition: "TEXT DEFAULT ''"},
		{table: "settings", column: "sync_password", definition: "TEXT DEFAULT ''"},
		{table: "settings", column: "sync_auto_enabled", definition: "INTEGER DEFAULT 0"},
		{table: "settings", column: "sync_interval_minutes", definition: "INTEGER DEFAULT 5"},
	}

	for _, item := range requiredColumns {
		exists, err := sqliteColumnExists(ctx, db, item.table, item.column)
		if err != nil {
			return fmt.Errorf("检查字段 %s.%s 失败: %w", item.table, item.column, err)
		}
		if exists {
			continue
		}
		stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", item.table, item.column, item.definition)
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("补齐字段 %s.%s 失败: %w", item.table, item.column, err)
		}
		g.Log().Info(ctx, fmt.Sprintf("已补齐数据库字段: %s.%s", item.table, item.column))
	}

	return nil
}

func sqliteColumnExists(ctx context.Context, db *sql.DB, tableName string, columnName string) (bool, error) {
	rows, err := db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info(%s)", tableName))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var dataType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if name == columnName {
			return true, nil
		}
	}

	if err := rows.Err(); err != nil {
		return false, err
	}

	return false, nil
}

// Automatic snapshots share the verified backup engine; manual copies are retained.
func performBackup(ctx context.Context, db *sql.DB, dbPath string) {
	if err := backup.Automatic(ctx, db, dbPath); err != nil {
		g.Log().Error(ctx, "自动备份失败，旧备份未因失败被清理:", err)
	}
}

// 检查数据库完整性
func checkDatabaseIntegrity(db *sql.DB) error {
	var result string
	err := db.QueryRow("PRAGMA integrity_check").Scan(&result)
	if err != nil {
		return fmt.Errorf("完整性检查执行失败: %w", err)
	}
	if result != "ok" {
		return fmt.Errorf("数据库损坏: %s", result)
	}
	return nil
}

// The DB is closed by the caller. Every original is preserved before replacement.
func tryRecoverDatabase(dbPath string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	result, err := backup.Recover(ctx, dbPath)
	if err != nil {
		g.Log().Error(ctx, "自动恢复停止，原数据保留:", err)
		return false
	}
	g.Log().Warning(ctx, "数据库已恢复；原数据库与伴随文件保留于:", result.PreservedDir)
	return true
}
