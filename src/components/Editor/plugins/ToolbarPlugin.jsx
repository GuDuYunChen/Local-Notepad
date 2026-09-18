import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { INSERT_TABLE_COMMAND, $createTableNode, $createTableRowNode, $createTableCellNode } from '@lexical/table';
import { INSERT_CODE_BLOCK_COMMAND } from './CodeBlockPlugin';
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
import { mergeRegister, $getNearestBlockElementAncestorOrThrow } from '@lexical/utils';
import { compressImage, generateVideoMetadata, loadXLSX, uploadFile } from '../utils/fileUpload';
import { TableNode, TableRowNode } from '@lexical/table'
import TableMenu from './TableMenu'
import './TextColorPlugin.css'

const FontOptions = [
  { label: 'Arial', value: 'Arial' },
  { label: '阿里妈妈灵动体', value: 'AlimamaAgileVF' },
  { label: '阿里妈妈刀隶体', value: 'AlimamaDaoLiTi' },
  { label: '阿里妈妈东方大楷', value: 'AlimamaDongFangDaKai' },
  { label: '阿里妈妈方圆体', value: 'AlimamaFangYuanTiVF' },
  { label: '阿里妈妈数黑体', value: 'AlimamaShuHeiTi' },
  { label: '钉钉进步体', value: 'DingTalkJinBuTi' },
  { label: '淘宝买菜体', value: 'TaoBaoMaiCaiTi' },
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
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('editor-font-family') || 'Arial');
  const [isUploading, setIsUploading] = useState(false);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [elementFormat, setElementFormat] = useState('left');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const fontSelectRef = useRef(null);
  const colorPickerRef = useRef(null);
  const moreMenuRef = useRef(null);

  const TEXT_COLORS = [
    { label: '默认', value: '' },
    { label: '红色', value: '#ef4444' },
    { label: '橙色', value: '#f97316' },
    { label: '黄色', value: '#eab308' },
    { label: '绿色', value: '#22c55e' },
    { label: '蓝色', value: '#3b82f6' },
    { label: '紫色', value: '#8b5cf6' },
    { label: '粉色', value: '#ec4899' },
  ];

  const HIGHLIGHT_COLORS = [
    { label: '无', value: '' },
    { label: '红色', value: '#fee2e2' },
    { label: '橙色', value: '#ffedd5' },
    { label: '黄色', value: '#fef9c3' },
    { label: '绿色', value: '#dcfce7' },
    { label: '蓝色', value: '#dbeafe' },
    { label: '紫色', value: '#f3e8ff' },
    { label: '粉色', value: '#fce7f3' },
  ];

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        fontSelectRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target)) {
        setShowColorPicker(false);
        setShowHighlightPicker(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const applyTextColor = (color) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $patchStyleText(selection, { color });
    });
    setShowColorPicker(false);
    editor.focus();
  };

  const applyHighlight = (color) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $patchStyleText(selection, { 'background-color': color });
    });
    setShowHighlightPicker(false);
    editor.focus();
  };

  const handleFontChange = (e) => {
    const value = e.target.value;
    setFontFamily(value);
    localStorage.setItem('editor-font-family', value);
    applyStyle('font-family', value);
  };

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      setIsBold(selection.hasFormat('bold'));
      setIsItalic(selection.hasFormat('italic'));
      setIsUnderline(selection.hasFormat('underline'));
      const anchorNode = selection.anchor.getNode();
      const element = anchorNode.getKey() === 'root'
        ? anchorNode
        : $getNearestBlockElementAncestorOrThrow(anchorNode);
      setElementFormat(element.getFormatType() || 'left');
    }
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar();
        });
      }),
      editor.registerCommand(CAN_UNDO_COMMAND, (payload) => {
        setCanUndo(payload);
        return false;
      }, 1),
      editor.registerCommand(CAN_REDO_COMMAND, (payload) => {
        setCanRedo(payload);
        return false;
      }, 1)
    );
  }, [editor, updateToolbar]);

  const applyStyle = (style, value) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { [style]: value });
      }
    });
  };

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
    <div className="editor-toolbar compact-toolbar">
      <div className="toolbar-group compact-history">
        <button
          disabled={!canUndo}
          onClick={() => editor.dispatchCommand(UNDO_COMMAND)}
          className="btn icon-only"
          aria-label="撤销"
          title="撤销 (Ctrl+Z)"
        >↶</button>
        <button
          disabled={!canRedo}
          onClick={() => editor.dispatchCommand(REDO_COMMAND)}
          className="btn icon-only"
          aria-label="重做"
          title="重做 (Ctrl+Y)"
        >↷</button>
      </div>

      <span className="divider" />

      <div className="toolbar-group compact-format">
        <button
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
          className={`btn fw-bold${isBold ? ' active' : ''}`}
          aria-label="加粗"
          title="加粗"
        >B</button>
        <button
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
          className={`btn fst-italic${isItalic ? ' active' : ''}`}
          aria-label="斜体"
          title="斜体"
        >I</button>
        <button
          onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
          className={`btn text-decoration-underline${isUnderline ? ' active' : ''}`}
          aria-label="下划线"
          title="下划线"
        >U</button>
      </div>

      <div className="toolbar-spacer" />

      {isUploading && <span className="toolbar-progress">处理中…</span>}

      <div className="toolbar-more-wrap" ref={moreMenuRef}>
        <button
          className={`btn toolbar-more-trigger${moreOpen ? ' active' : ''}`}
          onClick={() => setMoreOpen(prev => !prev)}
          aria-label="更多插入与格式"
          title="更多插入与格式"
        >
          <span className="toolbar-plus">＋</span>
          <span>更多</span>
        </button>

        {moreOpen && (
          <div className="toolbar-more-menu">
            <div className="toolbar-menu-section">
              <div className="toolbar-menu-label">文字</div>
              <div className="toolbar-menu-row">
                <select
                  ref={fontSelectRef}
                  value={fontFamily}
                  onChange={handleFontChange}
                  className="select toolbar-wide-select"
                  aria-label="字体"
                >
                  {FontOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={fontSize}
                  onChange={e => { setFontSize(e.target.value); applyStyle('font-size', e.target.value); }}
                  className="select"
                  aria-label="字号"
                >
                  {FontSizeOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              <div className="toolbar-menu-row">
                <div className="text-color-group" ref={colorPickerRef}>
                  <button
                    className="btn"
                    onClick={() => {
                      setShowColorPicker(!showColorPicker);
                      setShowHighlightPicker(false);
                    }}
                  >
                    文字颜色
                  </button>
                  {showColorPicker && (
                    <div className="color-picker-dropdown" role="listbox" aria-label="文本颜色选择">
                      {TEXT_COLORS.map((color) => (
                        <button
                          key={color.value || 'default'}
                          className="color-option"
                          onClick={() => applyTextColor(color.value)}
                          title={color.label}
                          aria-label={color.label}
                        >
                          <span
                            className="color-swatch"
                            style={{ backgroundColor: color.value || 'transparent', border: !color.value ? '1px dashed var(--muted)' : 'none' }}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="text-color-group">
                  <button
                    className="btn"
                    onClick={() => {
                      setShowHighlightPicker(!showHighlightPicker);
                      setShowColorPicker(false);
                    }}
                  >
                    高亮
                  </button>
                  {showHighlightPicker && (
                    <div className="color-picker-dropdown" role="listbox" aria-label="高亮颜色选择">
                      {HIGHLIGHT_COLORS.map((color) => (
                        <button
                          key={color.value || 'default'}
                          className="color-option"
                          onClick={() => applyHighlight(color.value)}
                          title={color.label}
                          aria-label={color.label}
                        >
                          <span
                            className="color-swatch"
                            style={{ backgroundColor: color.value || 'transparent', border: !color.value ? '1px dashed var(--muted)' : 'none' }}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="toolbar-menu-section">
              <div className="toolbar-menu-label">对齐</div>
              <div className="toolbar-menu-row">
                <button onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'left')} className={`btn${elementFormat === 'left' ? ' active' : ''}`}>左对齐</button>
                <button onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'center')} className={`btn${elementFormat === 'center' ? ' active' : ''}`}>居中</button>
                <button onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'right')} className={`btn${elementFormat === 'right' ? ' active' : ''}`}>右对齐</button>
              </div>
            </div>

            <div className="toolbar-menu-section">
              <div className="toolbar-menu-label">插入</div>
              <div className="toolbar-menu-grid">
                <label className="btn toolbar-menu-action">
                  图片
                  <input type="file" accept="image/*" multiple style={{display:'none'}} onChange={handleImage} />
                </label>
                <label className="btn toolbar-menu-action">
                  视频
                  <input type="file" accept="video/*" style={{display:'none'}} onChange={handleVideo} />
                </label>
                <label className="btn toolbar-menu-action">
                  Excel
                  <input type="file" accept=".xlsx, .xls" style={{display:'none'}} onChange={handleExcel} />
                </label>
                <button
                  className="btn toolbar-menu-action"
                  onClick={() => {
                    editor.dispatchCommand(INSERT_CODE_BLOCK_COMMAND)
                    setMoreOpen(false)
                  }}
                >
                  代码块
                </button>
              </div>
              <div className="toolbar-table-section">
                <TableMenu />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 尺寸选择已整合到 TableMenu 中
