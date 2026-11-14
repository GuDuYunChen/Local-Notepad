package logic

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"testing"

	"notepad-server/internal/model"
)

// SQL quote retains NULL, text whitespace/key order and storage types instead
// of comparing the normalized Settings API view with itself.
func partialSettingsStoredRow(t *testing.T, db *sql.DB) [10]string {
	t.Helper()
	var row [10]string
	err := db.QueryRow(`SELECT quote(id), quote(theme), quote(editor_opts), quote(sync_enabled),
		quote(sync_endpoint), quote(sync_provider), quote(sync_username), quote(sync_password),
		quote(sync_auto_enabled), quote(sync_interval_minutes) FROM settings WHERE id=1`).Scan(
		&row[0], &row[1], &row[2], &row[3], &row[4], &row[5], &row[6], &row[7], &row[8], &row[9])
	if err != nil {
		t.Fatal(err)
	}
	return row
}

func TestThemeRoundTripPreservesEveryUnspecifiedStoredSettingsColumn(t *testing.T) {
	for _, tc := range []struct {
		name   string
		editor interface{}
	}{
		{"sql-null", nil},
		{"empty-text", ""},
		{"empty-object", "{}"},
		{"json-whitespace-and-key-order", " { \"z\": 1, \"a\": 2 } \n"},
		{"nested-unknown-editor-preference", "{\"future\":{\"z\":[1,true,null],\"a\":\"保留原始值\"},\"fontSize\":15}"},
		{"json-null-text", "null"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logic, db, _ := newSettingsLogicTest(t)
			if _, err := db.Exec(`UPDATE settings SET editor_opts=?, sync_enabled=NULL, sync_endpoint=NULL,
				sync_provider=NULL, sync_username=NULL, sync_password=NULL,
				sync_auto_enabled=NULL, sync_interval_minutes=NULL WHERE id=1`, tc.editor); err != nil {
				t.Fatal(err)
			}
			before := partialSettingsStoredRow(t, db)
			ctx := context.Background()
			for _, theme := range []string{"dark", "light"} {
				got, err := logic.Update(ctx, &model.SettingsPatch{Theme: &theme})
				if err != nil {
					t.Fatal(err)
				}
				if got.Theme != theme || got.SyncEnabled || got.SyncAutoEnabled {
					t.Fatal("theme update changed the normalized disabled-sync semantics")
				}
				want := before
				want[1] = "'" + theme + "'"
				if after := partialSettingsStoredRow(t, db); after != want {
					t.Fatalf("theme-only update rewrote an unspecified stored value:\n got %#v\nwant %#v", after, want)
				}
			}
			if _, err := logic.Update(ctx, &model.SettingsPatch{}); err != nil {
				t.Fatal(err)
			}
			if got := partialSettingsStoredRow(t, db); got != before {
				t.Fatal("empty patch normalized or rewrote an unmentioned column")
			}
		})
	}
}

func TestExplicitEditorOptionsStillPersistWithoutRewritingOtherColumns(t *testing.T) {
	logic, db, _ := newSettingsLogicTest(t)
	if _, err := db.Exec(`UPDATE settings SET editor_opts=NULL, sync_password=NULL WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	before := partialSettingsStoredRow(t, db)
	for _, opts := range []map[string]interface{}{
		{"fontSize": float64(18), "future": map[string]interface{}{"enabled": true, "label": "保留"}},
		{},
	} {
		if _, err := logic.Update(context.Background(), &model.SettingsPatch{EditorOpts: &opts}); err != nil {
			t.Fatal(err)
		}
		var raw sql.NullString
		if err := db.QueryRow(`SELECT editor_opts FROM settings WHERE id=1`).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		if !raw.Valid {
			t.Fatal("explicit editor preferences were not persisted")
		}
		var decoded map[string]interface{}
		if err := json.Unmarshal([]byte(raw.String), &decoded); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(decoded, opts) {
			t.Fatalf("explicit preferences changed: got %#v, want %#v", decoded, opts)
		}
		after := partialSettingsStoredRow(t, db)
		want := before
		want[2] = after[2]
		if after != want {
			t.Fatalf("explicit editor update rewrote another column: got %#v, want %#v", after, want)
		}
	}
}

func TestPartialSettingsPersistsRequiredAutomaticSyncPausesOnly(t *testing.T) {
	disabled := false
	endpoint := "https://dav.example.test/changed"
	provider := "local-lab"
	for _, tc := range []struct {
		name    string
		patch   model.SettingsPatch
		changes map[int]string
	}{
		{"disable-sync", model.SettingsPatch{SyncEnabled: &disabled}, map[int]string{3: "0", 8: "0"}},
		{"change-endpoint", model.SettingsPatch{SyncEndpoint: &endpoint}, map[int]string{4: "'https://dav.example.test/changed'", 8: "0"}},
		{"change-provider", model.SettingsPatch{SyncProvider: &provider}, map[int]string{5: "'local-lab'", 8: "0"}},
		{"explicit-pause", model.SettingsPatch{SyncAutoEnabled: &disabled}, map[int]string{8: "0"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logic, db, _ := newSettingsLogicTest(t)
			if _, err := db.Exec(`UPDATE settings SET editor_opts=NULL, sync_provider='webdav',
				sync_endpoint='https://dav.example.test/saved', sync_enabled=1,
				sync_password=NULL, sync_auto_enabled=1, sync_interval_minutes=NULL WHERE id=1`); err != nil {
				t.Fatal(err)
			}
			before := partialSettingsStoredRow(t, db)
			if _, err := logic.Update(context.Background(), &tc.patch); err != nil {
				t.Fatal(err)
			}
			want := before
			for index, value := range tc.changes {
				want[index] = value
			}
			if after := partialSettingsStoredRow(t, db); after != want {
				t.Fatalf("required pause or preservation failed: got %#v, want %#v", after, want)
			}
		})
	}
}

func TestUnrelatedThemePatchKeepsVerifiedAutomaticSyncAndOriginalPatch(t *testing.T) {
	logic, db, _ := newSettingsLogicTest(t)
	if _, err := db.Exec(`UPDATE settings SET editor_opts=NULL, sync_provider='webdav',
		sync_endpoint='https://dav.example.test/saved', sync_enabled=1,
		sync_auto_enabled=1 WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	before := partialSettingsStoredRow(t, db)
	dark := "dark"
	patch := model.SettingsPatch{Theme: &dark}
	if _, err := logic.Update(context.Background(), &patch); err != nil {
		t.Fatal(err)
	}
	if patch.SyncAutoEnabled != nil {
		t.Fatal("updating settings mutated the caller's field presence")
	}
	want := before
	want[1] = "'dark'"
	if after := partialSettingsStoredRow(t, db); after != want {
		t.Fatalf("unrelated theme update changed automatic sync or editor preferences: got %#v, want %#v", after, want)
	}
	newEndpoint := "https://dav.example.test/another"
	patch = model.SettingsPatch{SyncEndpoint: &newEndpoint}
	if _, err := logic.Update(context.Background(), &patch); err != nil {
		t.Fatal(err)
	}
	if patch.SyncAutoEnabled != nil {
		t.Fatal("derived pause mutated the caller's field presence")
	}
}
