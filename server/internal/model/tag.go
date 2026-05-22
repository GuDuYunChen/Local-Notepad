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
