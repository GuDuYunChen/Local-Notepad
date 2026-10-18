package dao

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"notepad-server/internal/model"
	"testing"
)

func TestLocalImportKnownPrecommitTypesPreserveResearchMessages(t *testing.T) {
	for _, scenario := range []string{"missing-parent", "deleted-parent", "cycle", "duplicate", "payload-mismatch"} {
		t.Run(scenario, func(t *testing.T) {
			d := newSearchTestDAO(t)
			if _, err := d.DB.Exec(ResearchRequestsSchema); err != nil {
				t.Fatal(err)
			}
			file := &model.File{ID: "new-file", Title: "new.md", Content: "content"}
			wantReason, wantMessage := "folder-unavailable", ""
			switch scenario {
			case "missing-parent":
				file.ParentID = "missing"
				wantMessage = "目标目录不存在或不可读取，未改存根目录: sql: no rows in result set"
			case "deleted-parent", "cycle":
				deleted, parent := 1, ""
				wantMessage = "目标目录或上级目录不可用，未创建"
				if scenario == "cycle" {
					deleted, parent = 0, "parent"
					wantMessage = "目标目录结构存在循环，未创建"
				}
				if _, err := d.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at,is_folder,is_deleted,parent_id) VALUES('parent','parent','',1,1,1,?,?)`, deleted, parent); err != nil {
					t.Fatal(err)
				}
				file.ParentID = "parent"
			case "duplicate":
				if _, err := d.DB.Exec(`INSERT INTO files(id,title,content,created_at,updated_at) VALUES('old','NEW.MD','original',1,1)`); err != nil {
					t.Fatal(err)
				}
				wantReason = "name-conflict"
				wantMessage = "已存在同名文件或文件夹，未覆盖；请另存一份新标题的研究草稿"
			case "payload-mismatch":
				if _, err := d.DB.Exec(`INSERT INTO research_note_requests(request_id,payload_sha256,file_id,title,parent_id,created_at) VALUES('task','original-hash','original-file','original.md','',1)`); err != nil {
					t.Fatal(err)
				}
				wantReason = "payload-mismatch"
				wantMessage = "此研究任务已绑定不同内容，未覆盖原笔记或重新创建"
			}
			_, err := d.CreateResearch(context.Background(), "task", "new-hash", file, nil)
			var refusal *ResearchPrecommitError
			if !errors.As(err, &refusal) || refusal.Reason != wantReason || err.Error() != wantMessage {
				t.Fatalf("type or original text changed: %+v %v", refusal, err)
			}
			if scenario == "missing-parent" && !errors.Is(err, sql.ErrNoRows) {
				t.Fatal("original wrapped SQL cause was lost")
			}
			var count int
			if err := d.DB.QueryRow(`SELECT COUNT(*) FROM research_note_requests WHERE request_id='task'`).Scan(&count); err != nil {
				t.Fatal(err)
			}
			want := 0
			if scenario == "payload-mismatch" {
				want = 1
			}
			if count != want {
				t.Fatalf("rollback or original receipt changed: %d", count)
			}
		})
	}
}

func TestLocalImportUnconfirmedRollbackAndCancellationAreNotTyped(t *testing.T) {
	for _, scenario := range []string{"rollback-failed", "context-cancelled"} {
		t.Run(scenario, func(t *testing.T) {
			d := newSearchTestDAO(t)
			tx, err := d.DB.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			ctx := context.Background()
			if scenario == "rollback-failed" {
				if err := tx.Rollback(); err != nil {
					t.Fatal(err)
				}
			} else {
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			err = rejectResearchPrecommit(ctx, tx, "folder-unavailable", fmt.Errorf("known refusal text"))
			var refusal *ResearchPrecommitError
			if err == nil || errors.As(err, &refusal) {
				t.Fatal("unconfirmed rollback was labelled safe", err)
			}
		})
	}
}
