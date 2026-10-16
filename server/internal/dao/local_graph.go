package dao

import (
 "context"
 "database/sql"
 "encoding/json"
 "errors"
 "unicode/utf8"
)

const LocalGraphNodeLimit = 800
const LocalGraphEdgeLimit = 4000
const localGraphMetadataLimit = 2 * 1024 * 1024
var ErrLocalGraphLimit = errors.New("图谱超过完整读取上限（800篇笔记、4000条关联或2MiB元数据），未返回部分图谱")

type LocalGraphNode struct {
 ID string `json:"id"`
 Label string `json:"label"`
 UpdatedAt int64 `json:"updated_at"`
 Incoming int `json:"incoming"`
 Outgoing int `json:"outgoing"`
}
type LocalGraphEdge struct { Source string `json:"source"`; Target string `json:"target"` }
type LocalGraphSnapshot struct {
 Scope string `json:"scope"`
 Complete bool `json:"complete"`
 Nodes []LocalGraphNode `json:"nodes"`
 Edges []LocalGraphEdge `json:"edges"`
}
func localGraphIdentity(id string) bool {
 if id=="" || len(id)>512 || !utf8.ValidString(id) { return false }
 for _,r:=range id { if r<32 || r==127 { return false } }
 return true
}

// Read only the active ordinary-note subgraph. Metadata and link index are read
// in ONE SQLite snapshot. No body reads, reference rebuilds or database writes.
func(d *LinkDAO) ReadLocalGraph(ctx context.Context)(*LocalGraphSnapshot,error) {
 if d==nil || d.DB==nil { return nil,errors.New("本地图谱服务不可用") }
 tx,err:=d.DB.BeginTx(ctx,&sql.TxOptions{ReadOnly:true});if err!=nil{return nil,err};defer tx.Rollback()
 out:=&LocalGraphSnapshot{Scope:"active-note-index-v1",Nodes:make([]LocalGraphNode,0),Edges:make([]LocalGraphEdge,0)}
 rows,err:=tx.QueryContext(ctx,`SELECT id,title,updated_at FROM files WHERE is_folder=0 AND is_deleted=0 AND substr(title,1,7)<>? ORDER BY id LIMIT ?`,TemplatePrefix,LocalGraphNodeLimit+1)
 if err!=nil{return nil,err}
 byID:=make(map[string]int);size:=0
 for rows.Next() {
  var n LocalGraphNode
  if err=rows.Scan(&n.ID,&n.Label,&n.UpdatedAt);err!=nil{rows.Close();return nil,err}
  if !localGraphIdentity(n.ID)||!utf8.ValidString(n.Label)||n.UpdatedAt<0 {rows.Close();return nil,errors.New("图谱笔记元数据无效")}
  size+=len(n.ID)+len(n.Label)+64
  if len(out.Nodes)>=LocalGraphNodeLimit||len(n.Label)>16384||size>localGraphMetadataLimit {rows.Close();return nil,ErrLocalGraphLimit}
  if _,ok:=byID[n.ID];ok{rows.Close();return nil,errors.New("图谱笔记身份重复")}
  byID[n.ID]=len(out.Nodes);out.Nodes=append(out.Nodes,n)
 }
 err=errors.Join(rows.Err(),rows.Close());if err!=nil{return nil,err}
 // Missing, deleted, folder and template endpoints are outside this graph's
 // stated scope, not user-openable ghost nodes. Repeated index pairs collapse.
 rows,err=tx.QueryContext(ctx,`SELECT DISTINCT l.source_id,l.target_id FROM links l
 JOIN files s ON s.id=l.source_id JOIN files t ON t.id=l.target_id
 WHERE s.is_folder=0 AND s.is_deleted=0 AND substr(s.title,1,7)<>?
 AND t.is_folder=0 AND t.is_deleted=0 AND substr(t.title,1,7)<>?
 ORDER BY l.source_id,l.target_id LIMIT ?`,TemplatePrefix,TemplatePrefix,LocalGraphEdgeLimit+1)
 if err!=nil{return nil,err}
 for rows.Next() {
  var e LocalGraphEdge
  if err=rows.Scan(&e.Source,&e.Target);err!=nil{rows.Close();return nil,err}
  from,ok1:=byID[e.Source];to,ok2:=byID[e.Target]
  if !ok1||!ok2{rows.Close();return nil,errors.New("图谱关联与笔记快照不一致")}
  size+=len(e.Source)+len(e.Target)+32
  if len(out.Edges)>=LocalGraphEdgeLimit||size>localGraphMetadataLimit{rows.Close();return nil,ErrLocalGraphLimit}
  out.Nodes[from].Outgoing++;out.Nodes[to].Incoming++;out.Edges=append(out.Edges,e)
 }
 err=errors.Join(rows.Err(),rows.Close());if err!=nil{return nil,err}
 out.Complete=true
 encoded,encodeErr:=json.Marshal(out);if encodeErr!=nil{return nil,encodeErr};if len(encoded)>localGraphMetadataLimit{return nil,ErrLocalGraphLimit}
 if err=ctx.Err();err!=nil{return nil,err};if err=tx.Commit();err!=nil{return nil,err}
 out.Complete=true;return out,nil
}
