package model

type Tag struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type FileTag struct {
	FileID string `json:"file_id"`
	TagID  string `json:"tag_id"`
}

type Link struct {
	ID        int64  `json:"id"`
	SourceID  string `json:"source_id"`
	TargetID  string `json:"target_id"`
	CreatedAt int64  `json:"created_at"`
}

type FileVersion struct {
	ID        int64  `json:"id"`
	FileID    string `json:"file_id"`
	Content   string `json:"content"`
	Title     string `json:"title"`
	CreatedAt int64  `json:"created_at"`
}
