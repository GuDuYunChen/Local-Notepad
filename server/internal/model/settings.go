package model

// Settings stores user preferences persisted in SQLite.
type Settings struct {
	Theme        string                 `json:"theme"`
	EditorOpts   map[string]interface{} `json:"editor_opts"`
	SyncEnabled  bool                   `json:"sync_enabled"`
	SyncEndpoint    string                 `json:"sync_endpoint"`
	SyncProvider    string                 `json:"sync_provider"`
	SyncUsername    string                 `json:"sync_username"`
	SyncPassword        string                 `json:"-"`
	SyncPasswordSet     bool                   `json:"sync_password_set"`
	SyncAutoEnabled     bool                   `json:"sync_auto_enabled"`
	SyncIntervalMinutes int                    `json:"sync_interval_minutes"`
}

type SettingsPatch struct {
	Theme        *string                  `json:"theme"`
	EditorOpts   *map[string]interface{}  `json:"editor_opts"`
	SyncEnabled  *bool                    `json:"sync_enabled"`
	SyncEndpoint *string                  `json:"sync_endpoint"`
	SyncProvider *string                  `json:"sync_provider"`
	SyncUsername        *string                  `json:"sync_username"`
	SyncPassword        *string                  `json:"sync_password"`
	SyncAutoEnabled     *bool                    `json:"sync_auto_enabled"`
	SyncIntervalMinutes *int                     `json:"sync_interval_minutes"`
}
