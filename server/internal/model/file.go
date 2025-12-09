package model

// 文件实体
// 字段类型与用途：id(string, 主键), title(string, 标题), content(string, 内容JSON或Markdown)
// created_at/updated_at(int64, 时间戳秒)
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
}
