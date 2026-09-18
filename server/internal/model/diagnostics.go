package model

type Diagnostics struct {
	Status         string `json:"status"`
	Integrity      string `json:"integrity"`
	DatabasePath   string `json:"database_path"`
	DatabaseSize   int64  `json:"database_size"`
	DataDir        string `json:"data_dir"`
	BackupDir      string `json:"backup_dir"`
	UploadDir      string `json:"upload_dir"`
	BackupCount    int    `json:"backup_count"`
	LatestBackupAt int64  `json:"latest_backup_at"`
	JournalMode    string `json:"journal_mode"`
	ForeignKeys    bool   `json:"foreign_keys"`
	BusyTimeout    int    `json:"busy_timeout"`
	ActiveNotes    int    `json:"active_notes"`
	ActiveFolders  int    `json:"active_folders"`
	TrashItems     int    `json:"trash_items"`
}
