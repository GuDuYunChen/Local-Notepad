package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	_ "modernc.org/sqlite"
)

func main() {
	dbPath := resolveDBPath()
	fmt.Printf("Database path: %s\n", dbPath)

	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		fmt.Printf("Database not found at %s\n", dbPath)
		return
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		panic(err)
	}
	defer db.Close()

	// 1. 清理孤儿节点 (parent_id 不存在)
	for {
		res, err := db.Exec(`DELETE FROM files WHERE parent_id != '' AND parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM files)`)
		if err != nil {
			panic(err)
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			break
		}
		fmt.Printf("Deleted %d orphan items (parent missing)\n", affected)
	}

	// 2. 清理结构错误节点 (parent_id 指向非文件夹)
	// 查找 parent_id 指向的文件，其 is_folder = 0
	rows, err := db.Query(`
        SELECT f.id, f.title, p.title as parent_title 
        FROM files f 
        JOIN files p ON f.parent_id = p.id 
        WHERE f.parent_id != '' AND p.is_folder = 0 AND f.is_deleted = 0
    `)
	if err != nil {
		panic(err)
	}
	defer rows.Close()

	var badIds []string
	for rows.Next() {
		var id, title, pTitle string
		if err := rows.Scan(&id, &title, &pTitle); err == nil {
			fmt.Printf("Found item under non-folder parent: %s (Parent: %s)\n", title, pTitle)
			badIds = append(badIds, id)
		}
	}
	rows.Close()

	if len(badIds) > 0 {
		// 将这些文件移动到根目录，或者删除？用户说“垃圾数据就给我删了”
		// 这里我们选择删除，符合用户意愿
		for _, id := range badIds {
			_, err := db.Exec(`UPDATE files SET is_deleted = 1 WHERE id = ?`, id)
			if err != nil {
				fmt.Printf("Failed to delete %s: %v\n", id, err)
			} else {
				fmt.Printf("Deleted item %s\n", id)
			}
		}
	}

	// 3. 检查直接循环引用 (id = parent_id)
	res, err := db.Exec(`UPDATE files SET parent_id = '' WHERE id = parent_id`)
	if err != nil {
		panic(err)
	}
	affected, _ := res.RowsAffected()
	if affected > 0 {
		fmt.Printf("Fixed %d items with self-referencing parent_id\n", affected)
	}

	// 4. 检查两级循环 (A->B->A)
	// 这是一个简化检查，不做深度图遍历
	rows2, err := db.Query(`
        SELECT a.id, a.title, b.id, b.title 
        FROM files a 
        JOIN files b ON a.parent_id = b.id 
        WHERE b.parent_id = a.id AND a.is_deleted = 0
    `)
	if err != nil {
		panic(err)
	}
	defer rows2.Close()

	var loopIds []string
	for rows2.Next() {
		var id1, t1, id2, t2 string
		if err := rows2.Scan(&id1, &t1, &id2, &t2); err == nil {
			fmt.Printf("Found loop: %s <-> %s\n", t1, t2)
			loopIds = append(loopIds, id1) // Break loop by clearing parent of one
		}
	}
	rows2.Close()

	for _, id := range loopIds {
		_, err := db.Exec(`UPDATE files SET parent_id = '' WHERE id = ?`, id)
		if err != nil {
			fmt.Printf("Failed to break loop for %s\n", id)
		} else {
			fmt.Printf("Broke loop for item %s\n", id)
		}
	}

	fmt.Println("Cleanup finished successfully.")
}

// 复用 server/cmd/notepad-server/main.go 中的逻辑
func resolveDBPath() string {
	base := os.Getenv("NOTEPAD_DATA")
	if base == "" {
		if home, err := os.UserHomeDir(); err == nil {
			switch runtime.GOOS {
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
