package model

// 设置实体
// 字段：theme(主题)、editor_opts(JSON选项)、sync_enabled(是否开启同步)、sync_endpoint(同步地址)
type Settings struct {
    Theme        string                 `json:"theme"`
    EditorOpts   map[string]interface{} `json:"editor_opts"`
    SyncEnabled  bool                   `json:"sync_enabled"`
    SyncEndpoint string                 `json:"sync_endpoint"`
}

