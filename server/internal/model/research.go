package model

// ResearchReceipt is deliberately independent of the mutable note body. Receipts
// survive trash/permanent deletion so replay cannot recreate a removed note.
type ResearchReceipt struct {
	Found         bool   `json:"found"`
	RequestID     string `json:"request_id"`
	PayloadSHA256 string `json:"payload_sha256"`
	FileID        string `json:"file_id"`
	Title         string `json:"title"`
	ParentID      string `json:"parent_id"`
	CreatedAt     int64  `json:"created_at"`
	State         string `json:"state"`
}
