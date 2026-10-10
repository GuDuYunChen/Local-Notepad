package logic

import (
	"context"
	"database/sql"
	"testing"

	"notepad-server/internal/model"
)

// A legacy row (including the application's id/theme-only bootstrap row) can
// contain NULL sync_enabled. Reading it must be conservative and read-only.
func TestSettingsNullableSyncFlagIsReadOnlyAndPreservesExplicitValues(t *testing.T) {
	for _, tc := range []struct {
		name string
		flag interface{}
		want bool
	}{
		{"legacy-null-disabled", nil, false},
		{"explicit-disabled", 0, false},
		{"explicit-enabled", 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logic, db, _ := newSettingsLogicTest(t)
			if _, err := db.Exec(`UPDATE settings SET sync_enabled=? WHERE id=1`, tc.flag); err != nil {
				t.Fatal(err)
			}
			got, err := logic.Get(context.Background())
			if err != nil {
				t.Fatalf("read nullable settings: %v", err)
			}
			if got.SyncEnabled != tc.want || got.SyncAutoEnabled {
				t.Fatalf("unsafe sync defaults: enabled=%v auto=%v", got.SyncEnabled, got.SyncAutoEnabled)
			}
			if got.Theme != "light" || got.SyncProvider != "local-lab" || got.SyncEndpoint != "http://sync.local" || got.EditorOpts["fontSize"] != float64(15) {
				t.Fatal("reading a nullable flag changed unrelated preferences")
			}
			var stored sql.NullInt64
			if err := db.QueryRow(`SELECT sync_enabled FROM settings WHERE id=1`).Scan(&stored); err != nil {
				t.Fatal(err)
			}
			if tc.flag == nil {
				if stored.Valid {
					t.Fatal("GET unexpectedly rewrote the legacy NULL")
				}
			} else if !stored.Valid || stored.Int64 != int64(tc.flag.(int)) {
				t.Fatal("GET changed the stored explicit flag")
			}
		})
	}
}

func TestSettingsBootstrapRowCanReadAndSaveThemeWithoutEnablingSync(t *testing.T) {
	logic, db, _ := newSettingsLogicTest(t)
	if _, err := db.Exec(`DELETE FROM settings`); err != nil {
		t.Fatal(err)
	}
	// Match startup rather than filling nullable values to make the test pass.
	if _, err := db.Exec(`INSERT INTO settings(id,theme) VALUES(1,'light')`); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	got, err := logic.Get(ctx)
	if err != nil {
		t.Fatalf("read bootstrap settings: %v", err)
	}
	if got.Theme != "light" || got.SyncEnabled || got.SyncAutoEnabled || got.SyncIntervalMinutes != 5 || len(got.EditorOpts) != 0 {
		t.Fatal("bootstrap settings did not use disabled, empty defaults")
	}
	dark := "dark"
	if _, err := logic.Update(ctx, &model.SettingsPatch{Theme: &dark}); err != nil {
		t.Fatalf("first partial settings save: %v", err)
	}
	persisted, err := logic.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Theme != dark || persisted.SyncEnabled || persisted.SyncAutoEnabled || persisted.SyncProvider != "" || persisted.SyncEndpoint != "" {
		t.Fatal("first theme save did not persist or enabled unconfigured sync")
	}
}

func TestSettingsNullablePartialUpdatePreservesUnrelatedPreferences(t *testing.T) {
	logic, db, _ := newSettingsLogicTest(t)
	if _, err := db.Exec(`UPDATE settings SET sync_enabled=NULL WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	dark := "dark"
	if _, err := logic.Update(context.Background(), &model.SettingsPatch{Theme: &dark}); err != nil {
		t.Fatalf("partial update with legacy NULL: %v", err)
	}
	got, err := logic.Get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.Theme != dark || got.SyncEnabled || got.SyncAutoEnabled || got.SyncProvider != "local-lab" || got.SyncEndpoint != "http://sync.local" || got.EditorOpts["fontSize"] != float64(15) || got.EditorOpts["lineHeight"] != 1.8 {
		t.Fatal("nullable-flag repair lost existing settings or enabled sync")
	}
}

func TestSettingsNullableFlagDoesNotBypassAutomaticSyncVerification(t *testing.T) {
	logic, db, _ := newSettingsLogicTest(t)
	if _, err := db.Exec(`UPDATE settings SET sync_enabled=NULL WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	enable := true
	if _, err := logic.Update(ctx, &model.SettingsPatch{SyncAutoEnabled: &enable}); err == nil {
		t.Fatal("NULL compatibility bypassed verified automatic-sync activation")
	}
	var enabled sql.NullInt64
	if err := db.QueryRow(`SELECT sync_enabled FROM settings WHERE id=1`).Scan(&enabled); err != nil {
		t.Fatal(err)
	}
	if enabled.Valid {
		t.Fatal("rejected update modified the original row")
	}
}

func TestSettingsNullableFlagDoesNotHideMalformedEditorPreferences(t *testing.T) {
	logic, db, _ := newSettingsLogicTest(t)
	if _, err := db.Exec(`UPDATE settings SET sync_enabled=NULL, editor_opts='{' WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := logic.Get(ctx); err == nil {
		t.Fatal("malformed editor settings were silently accepted")
	}
	dark := "dark"
	if _, err := logic.Update(ctx, &model.SettingsPatch{Theme: &dark}); err == nil {
		t.Fatal("partial update overwrote unreadable editor preferences")
	}
	var theme, editor string
	var enabled sql.NullInt64
	if err := db.QueryRow(`SELECT theme, editor_opts, sync_enabled FROM settings WHERE id=1`).Scan(&theme, &editor, &enabled); err != nil {
		t.Fatal(err)
	}
	if theme != "light" || editor != "{" || enabled.Valid {
		t.Fatal("failed settings read/write changed the original data")
	}
}
