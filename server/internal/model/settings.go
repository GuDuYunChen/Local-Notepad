package model

// Settings stores user preferences persisted in SQLite.
type Settings struct {
	Theme        string                 `json:"theme"`
	EditorOpts   map[string]interface{} `json:"editor_opts"`
	SyncEnabled  bool                   `json:"sync_enabled"`
	SyncEndpoint string                 `json:"sync_endpoint"`
}

type SettingsPatch struct {
	Theme        *string                  `json:"theme"`
	EditorOpts   *map[string]interface{}  `json:"editor_opts"`
	SyncEnabled  *bool                    `json:"sync_enabled"`
	SyncEndpoint *string                  `json:"sync_endpoint"`
}
