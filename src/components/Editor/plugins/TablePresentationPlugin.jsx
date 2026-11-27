import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import { $isTableNode, TableNode, TableRowNode, TableCellNode } from '@lexical/table'
import { $getTableColumnWidths, $getTableModel, getTableSpanWidth } from '../utils/tableModel'
import { contrastRatio } from '~/services/localAppearance'

export function tableBackgroundTextColor(background) {
  let hex = String(background || '').trim()
  if (/^#[0-9a-f]{3}$/i.test(hex)) hex = '#' + [...hex.slice(1)].map(value => value + value).join('')
  const rgb = hex.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(1(?:\.0+)?))?\s*\)$/)
  if (rgb && rgb.slice(1, 4).every(value => Number(value) <= 255)) hex = '#' + rgb.slice(1, 4).map(value => Number(value).toString(16).padStart(2, '0')).join('')
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null
  return contrastRatio('#000000', hex) >= contrastRatio('#ffffff', hex) ? '#000000' : '#ffffff'
}

// A row's first DOM child is not necessarily its first logical column when a
// preceding row spans into it. Derive presentation from the same grid as edits,
// in reading mode too; this metadata never becomes a second persisted state.
export default function TablePresentationPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    const update = () => editor.getEditorState().read(() => {
      const visit = node => {
        if ($isTableNode(node)) {
          const model = $getTableModel(node)
          if (model) {
            const element = editor.getElementByKey(node.getKey())
            const table = element?.tagName === 'TABLE' ? element : element?.querySelector('table')
            // The pinned TableNode only paints these flags on its optional
            // scroll wrapper. Our document stylesheet scrolls the table itself.
            if (node.getFrozenRows()) table?.setAttribute('data-lexical-frozen-row', 'true')
            else table?.removeAttribute('data-lexical-frozen-row')
            if (node.getFrozenColumns()) table?.setAttribute('data-lexical-frozen-column', 'true')
            else table?.removeAttribute('data-lexical-frozen-column')
            const widths = $getTableColumnWidths(model)
            for (const { cell, columnIndex, colSpan } of model.locations.values()) {
              const dom = editor.getElementByKey(cell.getKey())
              if (!dom) continue
              dom.setAttribute('data-table-column', String(columnIndex))
              // An auto-layout table can shrink a cell's preferred width. Keep
              // known column constraints inside the scroll viewport, including
              // table-only and legacy widths, without changing document data.
              const width = getTableSpanWidth(widths, columnIndex, colSpan)
              if (width !== undefined) dom.style.setProperty('--table-cell-width', `${Math.max(70, width)}px`)
              else dom.style.removeProperty('--table-cell-width')
              const background = cell.getBackgroundColor()
              const foreground = background && (tableBackgroundTextColor(background) || tableBackgroundTextColor(dom.style.backgroundColor))
              if (foreground) {
                dom.setAttribute('data-table-custom-background', 'true')
                dom.style.setProperty('--table-cell-ink', foreground)
              } else {
                dom.removeAttribute('data-table-custom-background')
                dom.style.removeProperty('--table-cell-ink')
              }
            }
          }
        } else if (node.getChildren) node.getChildren().forEach(visit)
      }
      visit($getRoot())
    })
    const unregister = [TableNode, TableRowNode, TableCellNode].map(type => editor.registerMutationListener(type, update))
    const unregisterRoot = editor.registerRootListener(update)
    return () => { unregister.forEach(stop => stop()); unregisterRoot() }
  }, [editor])
  return null
}
