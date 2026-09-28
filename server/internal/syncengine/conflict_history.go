package syncengine

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

// History is a local-workspace read. It does not create a remote, acquire a
// sync lock, clear records or infer that a previously chosen version is current.
const ConflictHistoryPageSize = 25
const maxHistoryTime int64 = 253402300799

type ConflictHistoryItem struct {
	ID           string `json:"id"`
	ItemID       string `json:"item_id"`
	Kind         string `json:"kind"`
	CurrentTitle string `json:"current_title"`
	CreatedAt    int64  `json:"created_at"`
	ResolvedAt   int64  `json:"resolved_at"`
	Status       string `json:"status"`
	Resolution   string `json:"resolution"`
}
type ConflictHistoryPage struct {
	Version    int                   `json:"version"`
	Scope      string                `json:"scope"`
	Filter     string                `json:"filter"`
	Items      []ConflictHistoryItem `json:"items"`
	NextCursor string                `json:"next_cursor"`
	HasMore    bool                  `json:"has_more"`
}
type historyCursor struct {
	Version int    `json:"v"`
	Filter  string `json:"f"`
	At      int64  `json:"at"`
	ID      string `json:"id"`
}

func historyFilter(value string) bool {
	return value == "all" || value == "resolved" || value == "superseded"
}
func historyID(value string) bool {
	return len(value) > 0 && len(value) <= 128 && !strings.ContainsAny(value, "\x00\r\n")
}
func parseHistoryCursor(value, filter string) (historyCursor, error) {
	var result historyCursor
	if !historyFilter(filter) {
		return result, errors.New("invalid history filter")
	}
	if value == "" {
		return result, nil
	}
	if len(value) > 1024 {
		return result, errors.New("invalid history cursor")
	}
	bytes, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || base64.RawURLEncoding.EncodeToString(bytes) != value {
		return result, errors.New("invalid history cursor")
	}
	decoder := json.NewDecoder(strings.NewReader(string(bytes)))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&result); err != nil {
		return historyCursor{}, errors.New("invalid history cursor")
	}
	var extra interface{}
	if decoder.Decode(&extra) != io.EOF || result.Version != 1 || result.Filter != filter ||
		result.At < 0 || result.At > maxHistoryTime || !historyID(result.ID) {
		return historyCursor{}, errors.New("invalid history cursor")
	}
	return result, nil
}
func nextHistoryCursor(row ConflictHistoryItem, filter string) string {
	bytes, _ := json.Marshal(historyCursor{Version: 1, Filter: filter, At: row.ResolvedAt, ID: row.ID})
	return base64.RawURLEncoding.EncodeToString(bytes)
}
func historyKind(id string) string {
	if strings.HasPrefix(id, "tag:") {
		return "tag"
	}
	if strings.HasPrefix(id, "filetag:") {
		return "file-tag"
	}
	if strings.HasPrefix(id, "attachment:") {
		return "attachment"
	}
	return "file"
}

// Keyset pagination orders by completion time then conflict ID. No OFFSET or
// overall total is claimed; new history above the cursor is seen on refresh.
func (e *Engine) ConflictHistory(ctx context.Context, filter, before string, limit int) (ConflictHistoryPage, error) {
	empty := ConflictHistoryPage{}
	cursor, err := parseHistoryCursor(before, filter)
	if err != nil {
		return empty, err
	}
	if limit < 1 || limit > 50 {
		return empty, errors.New("invalid history page size")
	}
	if e == nil || e.DB == nil {
		return empty, errors.New("history database unavailable")
	}
	query := `SELECT c.id,c.item_id,COALESCE(substr(f.title,1,255),''),c.created_at,c.resolved_at,c.status,c.resolution
        FROM sync_conflicts c LEFT JOIN files f ON f.id=c.item_id
        WHERE c.status IN ('resolved','superseded')`
	args := []interface{}{}
	if filter != "all" {
		query += ` AND c.status=?`
		args = append(args, filter)
	}
	if before != "" {
		query += ` AND (c.resolved_at<? OR (c.resolved_at=? AND c.id<?))`
		args = append(args, cursor.At, cursor.At, cursor.ID)
	}
	query += ` ORDER BY c.resolved_at DESC,c.id DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := e.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return empty, err
	}
	defer rows.Close()
	result := ConflictHistoryPage{Version: 1, Scope: "local-workspace", Filter: filter, Items: []ConflictHistoryItem{}}
	for rows.Next() {
		var row ConflictHistoryItem
		if err = rows.Scan(&row.ID, &row.ItemID, &row.CurrentTitle, &row.CreatedAt, &row.ResolvedAt, &row.Status, &row.Resolution); err != nil {
			return empty, err
		}
		if !historyID(row.ID) || row.ItemID == "" || len(row.ItemID) > 2048 ||
			row.CreatedAt < 0 || row.CreatedAt > maxHistoryTime || row.ResolvedAt < 0 || row.ResolvedAt > maxHistoryTime {
			return empty, errors.New("invalid history record")
		}
		row.Kind = historyKind(row.ItemID)
		if row.Kind != "file" {
			row.CurrentTitle = ""
		}
		switch row.Resolution {
		case "local", "remote", "remote-rebind":
		default:
			row.Resolution = "unknown"
		}
		result.Items = append(result.Items, row)
	}
	if err = rows.Err(); err != nil {
		return empty, err
	}
	if len(result.Items) > limit {
		result.Items = result.Items[:limit]
		result.HasMore = true
		result.NextCursor = nextHistoryCursor(result.Items[len(result.Items)-1], filter)
	}
	return result, nil
}
