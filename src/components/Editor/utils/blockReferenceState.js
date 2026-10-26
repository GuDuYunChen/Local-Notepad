import { $getRoot, $getState, $setState, createState } from 'lexical'
import { BLOCK_STATE_KEY, BLOCK_TYPES, validBlockId } from '../../../services/blockReferenceModel.mjs'
export const blockIdState = createState(BLOCK_STATE_KEY, { parse: value => validBlockId(value) ? value : '', resetOnCopyNode: true })
export const $blockId = node => $getState(node, blockIdState)
export const $setBlockId = (node, id) => $setState(node, blockIdState, id)
export function newBlockId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw Error('当前环境不能生成安全块标识。')
  return 'b-' + globalThis.crypto.randomUUID().replaceAll('-', '')
}
export function $referenceBlockNodes(id) { return $getRoot().getChildren().filter(node => $blockId(node) === id) }
export function $ensureBlockId(node) {
  if (!node || node.getParent()?.getType() !== 'root' || !BLOCK_TYPES.has(node.getType())) throw Error('请选择正文顶层的段落、标题、引用、列表、代码或表格。')
  const existing = $blockId(node)
  if (existing && $referenceBlockNodes(existing).length !== 1) throw Error('当前块标识存在歧义，不能复制引用。')
  if (existing) return existing
  const used = new Set($getRoot().getChildren().map($blockId))
  let id = newBlockId(); while (used.has(id)) id = newBlockId()
  $setBlockId(node, id)
  return id
}
