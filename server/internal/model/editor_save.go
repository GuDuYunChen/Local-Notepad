package model

// An editor save has an immutable request identity. Retrying a timed-out write
// must never turn into a different write or replay an older body over a new one.
type EditorSaveInput struct {
	RequestID string `json:"save_request_id"`
	Expected  string `json:"expected_content"`
	Content   string `json:"content"`
	Mappings  string `json:"section_mappings"`
}
type EditorSaveReceipt struct {
	RequestID        string `json:"request_id"`
	ReferencePending bool   `json:"reference_pending"`
}
type EditorSaveResult struct {
	*File
	SaveReceipt EditorSaveReceipt `json:"save_receipt"`
}
type EditorReferenceJob struct {
	RequestID string `json:"request_id"`
	FileID    string `json:"file_id"`
	Title     string `json:"title"`
	Before    string `json:"before_content"`
	After     string `json:"after_content"`
	Mappings  string `json:"section_mappings"`
	State     string `json:"state"`
}
type ReferenceUpdate struct {
	ID       string   `json:"id"`
	Expected string   `json:"expected_content"`
	Content  string   `json:"content"`
	Links    []string `json:"-"`
}
type ReferenceCompletion struct {
	State         string            `json:"state"`
	TargetContent string            `json:"target_content"`
	Updates       []ReferenceUpdate `json:"updates"`
}
