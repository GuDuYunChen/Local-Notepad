package model

type File struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
	IsFolder  bool   `json:"is_folder"`
	ParentID  string `json:"parent_id"`
	SortOrder int64  `json:"sort_order"`
	IsDeleted bool   `json:"is_deleted"`
	DeletedAt int64  `json:"deleted_at"`
	IsPinned  bool   `json:"is_pinned"`
}
