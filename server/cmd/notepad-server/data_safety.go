package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"notepad-server/internal/backup"
	"os"
	"time"
)

// Deliberately a narrow local CLI, not a new HTTP write/restore endpoint.
func runDataSafety(args []string) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	result := map[string]interface{}{"success": false}
	info, err := dataSafety(ctx, args, resolveDBPath())
	if err != nil {
		result["message"] = err.Error()
	} else {
		result["success"] = true
		result["backup"] = info
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
}
func dataSafety(ctx context.Context, args []string, dbPath string) (backup.Info, error) {
	var zero backup.Info
	if len(args) == 1 && args[0] == "create" {
		if err := backup.CheckPending(dbPath); err != nil {
			return zero, err
		}
		if stat, err := os.Lstat(dbPath); err != nil || !stat.Mode().IsRegular() {
			return zero, fmt.Errorf("当前数据库不存在或不是普通文件，未创建空数据库")
		}
		uri, err := backup.SQLiteURI(dbPath, "rw", false)
		if err != nil {
			return zero, err
		}
		db, err := sql.Open("sqlite", uri)
		if err != nil {
			return zero, err
		}
		defer db.Close()
		configureDatabasePool(db)
		if _, err = db.ExecContext(ctx, "PRAGMA busy_timeout=5000"); err != nil {
			return zero, err
		}
		if _, err = db.ExecContext(ctx, "PRAGMA synchronous=FULL"); err != nil {
			return zero, err
		}
		return backup.Create(ctx, db, dbPath, true)
	}
	if len(args) == 2 && args[0] == "inspect" {
		filename, err := backup.ResolveName(dbPath, args[1])
		if err != nil {
			return zero, err
		}
		return backup.Inspect(ctx, filename)
	}
	return zero, fmt.Errorf("仅支持 --data-safety create 或 --data-safety inspect <备份名称>")
}
