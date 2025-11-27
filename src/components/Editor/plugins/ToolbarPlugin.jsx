import React, { useCallback, useState, useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { INSERT_TABLE_COMMAND, $createTableNode, $createTableRowNode, $createTableCellNode } from '@lexical/table';
import { $createImageNode } from '../nodes/ImageNode';
import { $createImageGridNode } from '../nodes/ImageGridNode';
import { $createVideoNode } from '../nodes/VideoNode';
import { 
  $insertNodes, 
  $createParagraphNode, 
  $createTextNode, 
  FORMAT_TEXT_COMMAND, 
  FORMAT_ELEMENT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  CAN_UNDO_COMMAND,
  CAN_REDO_COMMAND,
} from 'lexical';
import { $patchStyleText } from '@lexical/selection';
import { $getSelection, $isRangeSelection } from 'lexical';
import { mergeRegister } from '@lexical/utils';
import { compressImage, generateVideoMetadata, loadXLSX, uploadFile } from '../utils/fileUpload';
import { TableNode, TableRowNode } from '@lexical/table'

const FontOptions = [
  { label: 'Arial', value: 'Arial' },
  { label: '宋体', value: 'SimSun' },
  { label: '黑体', value: 'SimHei' },
  { label: '微软雅黑', value: 'Microsoft YaHei' },
  { label: 'Times New Roman', value: 'Times New Roman' },
];

const FontSizeOptions = ['10px', '12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px'];

export default function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [fontSize, setFontSize] = useState('14px');
  const [fontFamily, setFontFamily] = useState('Arial');
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(CAN_UNDO_COMMAND, (payload) => {
        setCanUndo(payload);
        return false;
      }, 1),
      editor.registerCommand(CAN_REDO_COMMAND, (payload) => {
        setCanRedo(payload);
        return false;
      }, 1)
    );
  }, [editor]);

  const applyStyle = (style, value) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { [style]: value });
      }
    });
  };

  const insertTable = () => {
    editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: '3', rows: '3' });
  };

  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const sizes = Array.from({ length: 10 }, (_, r) => Array.from({ length: 10 }, (_, c) => ({ r: r + 1, c: c + 1 })))

  const toggleSelectionMode = () => {
    const next = !selectionMode
    setSelectionMode(next)
    window.dispatchEvent(new CustomEvent('tableSelection:mode', { detail: next }))
    if (!next) window.dispatchEvent(new CustomEvent('tableSelection:clear', {}))
  }

  const addRow = (dir = 'after') => {
    editor.update(() => {
      const sel = $getSelection()
      if (!$isRangeSelection(sel)) return
      const node = sel.getNodes()[0]
      let table = node
      while (table && !(table instanceof TableNode)) { table = table.getParent() }
      if (!table) return
      const rows = table.getChildren()
      const sample = rows[0]
      const cols = sample ? sample.getChildren().length : 1
      const row = $createTableRowNode()
      for (let i = 0; i < cols; i++) {
        const cell = $createTableCellNode()
        const p = $createParagraphNode()
        cell.append(p)
        row.append(cell)
      }
      table.append(row)
    })
  }

  const delRow = () => {
    editor.update(() => {
      const sel = $getSelection()
      if (!$isRangeSelection(sel)) return
      const node = sel.getNodes()[0]
      let row = node
      while (row && !(row instanceof TableRowNode)) { row = row.getParent() }
      if (!row) return
      row.remove()
    })
  }

  const addCol = () => {
    editor.update(() => {
      const sel = $getSelection()
      if (!$isRangeSelection(sel)) return
      const node = sel.getNodes()[0]
      let table = node
      while (table && !(table instanceof TableNode)) { table = table.getParent() }
      if (!table) return
      const rows = table.getChildren()
      const sampleHeader = (() => {
        const firstCell = rows[0]?.getChildren()?.[0]
        try { return typeof firstCell?.getHeaderState === 'function' ? firstCell.getHeaderState() : 0 } catch { return 0 }
      })()
      rows.forEach((row, ri) => {
        const cell = $createTableCellNode()
        const p = $createParagraphNode()
        cell.append(p)
        try { if (ri === 0 && typeof cell.setHeaderState === 'function') cell.setHeaderState(sampleHeader) } catch {}
        row.append(cell)
      })
    })
  }

  const delCol = () => {
    editor.update(() => {
      const sel = $getSelection()
      if (!$isRangeSelection(sel)) return
      const node = sel.getNodes()[0]
      let row = node
      while (row && !(row instanceof TableRowNode)) { row = row.getParent() }
      if (!row) return
      const cells = row.getChildren()
      const idx = Math.max(0, cells.length - 1)
      let table = row.getParent()
      const rows = table.getChildren()
      for (const r of rows) {
        const cs = r.getChildren()
        const target = cs[idx]
        if (target) target.remove()
      }
    })
  }

  const uploadFileSafe = async (file) => {
    try {
      return await uploadFile(file);
    } catch (e) {
      alert('上传失败: ' + e.message);
      return null;
    }
  };

  const handleImage = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    for (const f of files) { if (f.size > 10 * 1024 * 1024) { alert('图片最大10MB'); e.target.value=''; return; } }
    setIsUploading(true);
    const uploads = await Promise.all(files.map(async (file) => {
      const type = file.type || '';
      const skipCompress = type.includes('gif') || type.includes('png');
      if (!skipCompress && file.size > 2 * 1024 * 1024) {
        try {
          const compressedFile = await compressImage(file);
          const [resCompressed, resOriginal] = await Promise.all([
            uploadFileSafe(compressedFile),
            uploadFileSafe(file)
          ]);
          if (resCompressed && resOriginal) {
            return { src: resCompressed.url, originalSrc: resOriginal.url, alt: file.name };
          }
        } catch {
          const res = await uploadFileSafe(file);
          if (res) return { src: res.url, originalSrc: res.url, alt: file.name };
          return null;
        }
      } else {
        const res = await uploadFileSafe(file);
        if (res) return { src: res.url, originalSrc: res.url, alt: file.name };
        return null;
      }
    }));
    setIsUploading(false);
    const items = uploads.filter(Boolean);
    if (items.length === 0) { e.target.value=''; return; }
    editor.update(() => {
      if (items.length === 1) {
        const i = items[0];
        const node = $createImageNode({ src: i.src, originalSrc: i.originalSrc, alt: i.alt, caption: i.alt, width: 500 });
        $insertNodes([node]);
      } else {
        const grid = $createImageGridNode({ items, columns: 3, gap: 8 });
        $insertNodes([grid]);
      }
    });
    e.target.value = '';
  };

  const handleVideo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { alert('视频最大100MB'); return; }
    
    setIsUploading(true);
    
    try {
        const metadata = await generateVideoMetadata(file);
        const resVideo = await uploadFileSafe(file);
        
        let coverUrl = null;
        if (metadata.coverFile) {
            const resCover = await uploadFileSafe(metadata.coverFile);
            if (resCover) coverUrl = resCover.url;
        }
        
        if (resVideo) {
            editor.update(() => {
                const node = $createVideoNode({ 
                    src: resVideo.url, 
                    width: 600,
                    poster: coverUrl,
                    duration: metadata.duration
                });
                $insertNodes([node]);
            });
        }
    } catch (e) {
        console.error('Video upload failed', e);
        alert('视频上传失败: ' + e.message);
    }
    
    setIsUploading(false);
    e.target.value = '';
  };

  const handleExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('Excel最大5MB'); return; }
    
    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            loadXLSX().then((XLSX) => {
              const workbook = XLSX.read(data, { type: 'array' });
              const sheetName = workbook.SheetNames[0];
              const sheet = workbook.Sheets[sheetName];
              const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            
              editor.update(() => {
                  const table = $createTableNode();
                  for (const rowData of rows) {
                      const tableRow = $createTableRowNode();
                      for (const cellData of rowData) {
                          const tableCell = $createTableCellNode();
                          const paragraph = $createParagraphNode();
                          paragraph.append($createTextNode(String(cellData)));
                          tableCell.append(paragraph);
                          tableRow.append(tableCell);
                      }
                      table.append(tableRow);
                  }
                  $insertNodes([table]);
              });
              setIsUploading(false);
            }).catch(() => {
              alert('XLSX加载失败');
              setIsUploading(false);
            });
        } catch (err) {
            alert('解析失败');
            setIsUploading(false);
        }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  return (
    <div className="editor-toolbar">
      <div className="toolbar-group">
        <span className="group-label">历史</span>
        <button disabled={!canUndo} onClick={() => editor.dispatchCommand(UNDO_COMMAND)} className="btn">Undo</button>
        <button disabled={!canRedo} onClick={() => editor.dispatchCommand(REDO_COMMAND)} className="btn">Redo</button>
      </div>
      <span className="divider" />
      <div className="toolbar-group">
        <span className="group-label">文本</span>
        <select value={fontFamily} onChange={e => { setFontFamily(e.target.value); applyStyle('font-family', e.target.value); }} className="select">
          {FontOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={fontSize} onChange={e => { setFontSize(e.target.value); applyStyle('font-size', e.target.value); }} className="select">
          {FontSizeOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <button onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} className="btn fw-bold">B</button>
        <button onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} className="btn fst-italic">I</button>
        <button onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')} className="btn text-decoration-underline">U</button>
      </div>
      <span className="divider" />
      <div className="toolbar-group">
        <span className="group-label">对齐</span>
        <button onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'left')} className="btn">Left</button>
        <button onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'center')} className="btn">Center</button>
        <button onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'right')} className="btn">Right</button>
      </div>
      <span className="divider" />
      <div className="toolbar-group" style={{ position: 'relative' }}>
        <span className="group-label">表格</span>
        <button onClick={insertTable} className="btn">插入表格</button>
        <button onClick={() => setPickerOpen(v => !v)} className="btn">尺寸选择</button>
        {pickerOpen && (
          <TableSizePicker onPick={(r,c)=>{ editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: String(c), rows: String(r) }); setPickerOpen(false) }} />
        )}
        <button onClick={toggleSelectionMode} className="btn" style={{ background: selectionMode ? 'rgba(126,91,239,0.2)' : undefined }}>选择模式</button>
        <button onClick={() => addRow('after')} className="btn">添加行</button>
        <button onClick={delRow} className="btn">删除行</button>
        <button onClick={addCol} className="btn">添加列</button>
        <button onClick={delCol} className="btn">删除列</button>
      </div>
      <span className="divider" />
      <div className="toolbar-group">
        <span className="group-label">插入</span>
        <label className="btn">图片<input type="file" accept="image/*" multiple style={{display:'none'}} onChange={handleImage} /></label>
        <label className="btn">视频<input type="file" accept="video/*" style={{display:'none'}} onChange={handleVideo} /></label>
        <label className="btn">Excel<input type="file" accept=".xlsx, .xls" style={{display:'none'}} onChange={handleExcel} /></label>
        {isUploading && <span style={{marginLeft: 10, fontSize: 12}}>上传/处理中...</span>}
      </div>
    </div>
  );
}

function TableSizePicker({ onPick }) {
  const [dragging, setDragging] = useState(false)
  const [start, setStart] = useState(null)
  const [end, setEnd] = useState(null)
  const ref = React.useRef(null)
  const dim = { rows: 10, cols: 10 }
  const rect = React.useMemo(() => {
    if (!start || !end) return null
    const r1 = Math.min(start.r, end.r), r2 = Math.max(start.r, end.r)
    const c1 = Math.min(start.c, end.c), c2 = Math.max(start.c, end.c)
    return { r1, c1, r2, c2 }
  }, [start, end])

  const setByEvent = (e) => {
    const box = ref.current
    if (!box) return null
    const rect = box.getBoundingClientRect()
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top
    const cellW = rect.width / dim.cols
    const cellH = rect.height / dim.rows
    const c = Math.min(dim.cols, Math.max(1, Math.ceil(x / cellW)))
    const r = Math.min(dim.rows, Math.max(1, Math.ceil(y / cellH)))
    return { r, c }
  }

  const onDown = (e) => { const p = setByEvent(e); if (!p) return; setStart(p); setEnd(p); setDragging(true) }
  const onMove = (e) => { if (!dragging) return; const p = setByEvent(e); if (!p) return; setEnd(p) }
  const onUp = () => { if (rect) onPick(rect.r2 - rect.r1 + 1, rect.c2 - rect.c1 + 1); setDragging(false); setStart(null); setEnd(null) }
  const onClickCell = (r,c) => { onPick(r,c) }

  const overlayStyle = (() => {
    if (!rect || !ref.current) return { display:'none' }
    const host = ref.current.getBoundingClientRect()
    const cellW = host.width / dim.cols
    const cellH = host.height / dim.rows
    const x = (rect.c1 - 1) * cellW
    const y = (rect.r1 - 1) * cellH
    const w = (rect.c2 - rect.c1 + 1) * cellW
    const h = (rect.r2 - rect.r1 + 1) * cellH
    return { left: x, top: y, width: w, height: h }
  })()

  return (
    <div className="size-picker" ref={ref}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onTouchStart={onDown}
      onTouchMove={onMove}
      onTouchEnd={onUp}
    >
      <div className="size-overlay" style={overlayStyle} />
      {Array.from({length: dim.rows}).map((_, ri) => (
        <div key={ri} className="size-row">
          {Array.from({length: dim.cols}).map((_, ci) => {
            const r = ri+1, c = ci+1
            const active = rect && r>=rect.r1 && r<=rect.r2 && c>=rect.c1 && c<=rect.c2
            return <span key={ci} className={active? 'size-cell active':'size-cell'} onClick={()=>onClickCell(r,c)} />
          })}
        </div>
      ))}
      <div className="size-label">{rect? `${rect.r2-rect.r1+1}×${rect.c2-rect.c1+1}`: '选择尺寸'}</div>
    </div>
  )
}
