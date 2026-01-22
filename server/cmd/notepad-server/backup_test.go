package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestPerformBackup(t *testing.T) {
	// 创建临时目录用于测试
	tempDir, err := os.MkdirTemp("", "backup_test")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// 创建测试数据库
	dbPath := filepath.Join(tempDir, "test.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer db.Close()

	// 创建测试表和数据
	_, err = db.Exec(`CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)`)
	if err != nil {
		t.Fatalf("创建测试表失败: %v", err)
	}

	_, err = db.Exec(`INSERT INTO test (name) VALUES ('test_data')`)
	if err != nil {
		t.Fatalf("插入测试数据失败: %v", err)
	}

	ctx := context.Background()

	// 执行备份
	performBackup(ctx, db, dbPath)

	// 检查备份目录是否存在
	backupDir := filepath.Join(tempDir, "backups")
	if _, err := os.Stat(backupDir); os.IsNotExist(err) {
		t.Fatalf("备份目录不存在: %s", backupDir)
	}

	// 检查备份文件是否创建
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatalf("读取备份目录失败: %v", err)
	}

	if len(entries) == 0 {
		t.Fatal("没有创建备份文件")
	}

	// 验证备份文件可以正常打开
	backupPath := filepath.Join(backupDir, entries[0].Name())
	backupDB, err := sql.Open("sqlite", backupPath)
	if err != nil {
		t.Fatalf("打开备份数据库失败: %v", err)
	}
	defer backupDB.Close()

	// 验证备份数据完整性
	var count int
	err = backupDB.QueryRow("SELECT COUNT(*) FROM test").Scan(&count)
	if err != nil {
		t.Fatalf("查询备份数据失败: %v", err)
	}

	if count != 1 {
		t.Fatalf("备份数据不完整，期望1条记录，实际%d条", count)
	}

	t.Logf("备份测试成功，备份文件: %s", entries[0].Name())
}

func TestBackupRetentionPolicy(t *testing.T) {
	// 创建临时目录用于测试
	tempDir, err := os.MkdirTemp("", "retention_test")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// 创建测试数据库
	dbPath := filepath.Join(tempDir, "test.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer db.Close()

	// 创建测试表
	_, err = db.Exec(`CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)`)
	if err != nil {
		t.Fatalf("创建测试表失败: %v", err)
	}

	ctx := context.Background()
	backupDir := filepath.Join(tempDir, "backups")
	
	// 创建备份目录
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		t.Fatalf("创建备份目录失败: %v", err)
	}

	// 模拟创建105个旧备份文件（超过100个限制）
	for i := 0; i < 105; i++ {
		// 创建不同时间戳的备份文件名
		timestamp := time.Now().Add(-time.Duration(105-i) * time.Hour).Format("20060102-150405")
		backupName := filepath.Join(backupDir, "backup-"+timestamp+".db")
		
		// 创建空的备份文件
		file, err := os.Create(backupName)
		if err != nil {
			t.Fatalf("创建模拟备份文件失败: %v", err)
		}
		file.Close()
	}

	// 执行备份（这会触发清理逻辑）
	performBackup(ctx, db, dbPath)

	// 检查备份文件数量
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatalf("读取备份目录失败: %v", err)
	}

	// 应该只保留100个备份文件（加上新创建的1个，总共101个，但会被清理到100个）
	if len(entries) > 100 {
		t.Fatalf("备份保留策略失效，期望最多100个文件，实际%d个", len(entries))
	}

	t.Logf("保留策略测试成功，当前备份文件数量: %d", len(entries))
}