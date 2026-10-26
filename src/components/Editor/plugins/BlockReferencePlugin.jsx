import React, { useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import { $getNodeByKey, $getNearestNodeFromDOMNode, $getSelection, $insertNodes, $isRangeSelection, $setSelection, COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from 'lexical'
import { $generateNodesFromSerializedNodes, $insertGeneratedNodes } from '@lexical/clipboard'
import { api } from '~/services/api'
import { isEvidenceContentReady, subscribeEvidenceContentReady } from '~/services/evidenceNavigation'
import { blockLocator, parseBlockLocator, removeCopiedBlockIds, validBlockId } from '../../../services/blockReferenceModel.mjs'
import { readBlockReference } from '../../../services/blockReferences.mjs'
import { $blockId, $ensureBlockId, $referenceBlockNodes } from '../utils/blockReferenceState.js'
import { $createBlockReferenceNode } from '../nodes/WikiLinkNode.jsx'
import './BlockReferences.css'

export function $captureBlockReferenceSelection(editor) {
  const focused = document.activeElement
  const root = editor.getRootElement()
  // A code decorator uses its own textarea, not a RangeSelection. Capture it
  // only while its real DOM control is focused; stale selection is not proof.
  if (focused && root?.contains(focused) && focused.matches('textarea')) {
    const node = $getNearestNodeFromDOMNode(focused)
    const block = node?.getTopLevelElement()
    if (block?.getType() === 'code-block') return { selection: null, blockKey: block.getKey(), content: JSON.stringify(editor.getEditorState()) }
  }
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) throw Error('请先把光标放在目标位置，再打开块引用。')
  const node = selection.anchor.getNode(), block = node.getTopLevelElement()
  if (!block) throw Error('当前光标不在可引用的正文块中。')
  return { selection: selection.clone(), blockKey: block.getKey(), content: JSON.stringify(editor.getEditorState()) }
}
export function $insertReviewedBlockReference(editor, ticket, target, embedded) {
  if (!editor.isEditable() || JSON.stringify(editor.getEditorState()) !== ticket.content) throw Error('正文已变化，请关闭面板后重新选择插入位置。')
  if (!ticket.selection) throw Error('代码块只提供来源引用；请关闭面板，把光标放在正文段落再插入。')
  if (!$getNodeByKey(ticket.selection.anchor.key) || !$getNodeByKey(ticket.selection.focus.key)) throw Error('插入位置已失效，请重新选择。')
  $setSelection(ticket.selection.clone())
  $insertNodes([$createBlockReferenceNode(target.id, target.title, target.blockId, embedded)])
}

export default function BlockReferencePlugin(props) { return <CurrentBlockReferences key={props.documentId || ''} {...props} /> }
function CurrentBlockReferences({ documentId, documentTitle, initialContent }) {
  const [editor] = useLexicalComposerContext(), editable = useLexicalEditable()
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [error, setError] = useState(''), [address, setAddress] = useState(''), [sourceAddress, setSourceAddress] = useState('')
  const [preview, setPreview] = useState(null), [embedded, setEmbedded] = useState(false)
  const alive = useRef(false), owner = useRef(null), ticket = useRef(null), panel = useRef(null), entry = useRef(null)
  const active = useRef(false), frames = useRef(new Set()), flash = useRef(null), flashTimer = useRef(null)
  const ready = () => isEvidenceContentReady(editor, documentId, initialContent)
  const invalidateRead = () => { owner.current?.abort(); owner.current = null }
  const clearFlash = () => { clearTimeout(flashTimer.current); flash.current?.classList.remove('block-reference-highlight'); flash.current = null }
  const clearFrames = () => { for (const id of frames.current) cancelAnimationFrame(id); frames.current.clear(); clearFlash() }
  const frame = callback => { const id = requestAnimationFrame(() => { frames.current.delete(id); callback() }); frames.current.add(id) }
  const close = () => { active.current = false; invalidateRead(); setBusy(false); setOpen(false); ticket.current = null; entry.current?.focus({ preventScroll: true }) }
  const show = () => {
    invalidateRead(); setPreview(null); setSourceAddress(''); setAddress(''); setError(''); setMessage(''); setBusy(false)
    try {
      if (!ready()) throw Error('正文尚未加载完成。')
      editor.getEditorState().read(() => { ticket.current = $captureBlockReferenceSelection(editor) })
      active.current = true; setOpen(true)
    } catch (failure) { setError(failure.message) }
  }
  const current = () => {
    if (!alive.current || !active.current || !ready() || !editor.isEditable() || !ticket.current) throw Error('当前笔记或编辑状态已变化，请重新打开块引用。')
    if (JSON.stringify(editor.getEditorState()) !== ticket.current.content) throw Error('正文已变化，请关闭面板后重新选择插入位置。')
    return ticket.current
  }
  const run = async action => {
    if (owner.current) return
    const controller = new AbortController(); owner.current = controller; setBusy(true); setError(''); setMessage('')
    const valid = () => alive.current && active.current && owner.current === controller && !controller.signal.aborted
    try { await action(controller, valid) } catch (failure) { if (valid()) setError(failure.message) }
    finally { if (valid()) setBusy(false); if (owner.current === controller) owner.current = null }
  }
  const createAnchor = () => {
    try {
      const captured = current(); let id, failure
      editor.update(() => { try { if (!editor.isEditable()) throw Error('阅读模式不能创建块标识。'); id = $ensureBlockId($getNodeByKey(captured.blockKey)) } catch (error) { failure = error } }, { discrete: true })
      if (failure) throw failure
      captured.content = JSON.stringify(editor.getEditorState()); captured.blockId = id
      setMessage('块标识已加入当前草稿，沿用原有自动保存。核对保存成功后才能复制引用。'); setError(''); setSourceAddress('')
    } catch (failure) { setError(failure.message) }
  }
  const copySource = () => void run(async (controller, valid) => {
    const captured = current(); let id
    editor.getEditorState().read(() => { const node = $getNodeByKey(captured.blockKey); if (node) id = $blockId(node) })
    if (!id) throw Error('请先为当前块创建引用标识。')
    const result = await readBlockReference(api, { id: documentId, blockId: id }, controller.signal)
    if (!valid()) return
    current()
    const source = JSON.parse(captured.content).root.children.find(n => n.$?.localBlockId === id)
    if (result.blockJSON !== JSON.stringify(source)) throw Error('当前块尚未保存或已改变，未复制未确认的引用。请等待原保存完成后重新核对。')
    const value = blockLocator(documentId, id); setSourceAddress(value)
    try {
      if (!navigator.clipboard?.writeText) throw Error()
      await navigator.clipboard.writeText(value)
      if (valid()) setMessage('已核对保存并复制块引用。在另一篇笔记打开“块引用”粘贴此地址。')
    } catch { if (valid()) setMessage('已核对保存；系统剪贴板不可用，请从下方地址框手动复制。') }
  })
  const readTarget = () => void run(async (controller, valid) => {
    current(); setPreview(null)
    const request = parseBlockLocator(address), result = await readBlockReference(api, request, controller.signal)
    if (valid()) { current(); setPreview(result); setMessage('已读取保存版本。确认插入时会再次核对来源，预览不会修改任何笔记。') }
  })
  const insert = () => void run(async (controller, valid) => {
    const captured = current()
    if (!preview) throw Error('请先读取并检查来源块。')
    const request = parseBlockLocator(address)
    if (request.id !== preview.id || request.blockId !== preview.blockId) throw Error('引用地址已改变，请重新读取。')
    const fresh = await readBlockReference(api, request, controller.signal)
    if (!valid()) return
    current()
    if (fresh.blockJSON !== preview.blockJSON || fresh.title !== preview.title) { setPreview(fresh); setMessage('来源已改变，预览已更新；请检查后再次确认插入。'); return }
    let failure
    editor.update(() => { try { $insertReviewedBlockReference(editor, captured, fresh, embedded) } catch (error) { failure = error } }, { discrete: true })
    if (failure) throw failure
    close(); setMessage(embedded ? '已插入只读块嵌入，沿用原有保存流程。' : '已插入块引用，沿用原有保存流程。')
  })
  useEffect(() => {
    alive.current = true
    active.current = false; ticket.current = null; setOpen(false); setBusy(false); setPreview(null)
    const publishReady = () => { if (alive.current && ready()) window.dispatchEvent(new CustomEvent('editor:block-navigation-ready', { detail: { documentId, content: initialContent } })) }
    publishReady(); const unsubscribe = subscribeEvidenceContentReady(publishReady)
    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size || dirtyLeaves.size) clearFrames()
      publishReady()
    })
    const openBlock = event => {
      if (event.detail?.documentId !== documentId) return
      clearFrames(); setError(''); setMessage('')
      const id = event.detail.blockId
      if (!ready() || !validBlockId(id)) { setError('正文未就绪或块标识无效，未定位。'); return }
      let key
      editor.getEditorState().read(() => { const nodes = $referenceBlockNodes(id); if (nodes.length === 1) key = nodes[0].getKey() })
      if (!key) { setError('来源块已删除或标识不唯一，未定位到其他段落。'); return }
      window.dispatchEvent(new CustomEvent('editor:search-match', { detail: { documentId, topLevelKey: key } }))
      frame(() => frame(() => {
        if (!alive.current || !ready()) return
        let unchanged = false
        editor.getEditorState().read(() => { const nodes = $referenceBlockNodes(id); unchanged = nodes.length === 1 && nodes[0].getKey() === key })
        const element = editor.getElementByKey(key), root = editor.getRootElement(), box = root?.closest('.editor-container')
        if (!unchanged || !element?.isConnected || !root?.contains(element) || !box) { setError('来源块在定位期间改变，请重新打开引用。'); return }
        box.scrollTo({ top: Math.max(0, box.scrollTop + element.getBoundingClientRect().top - box.getBoundingClientRect().top - 24), behavior: 'auto' })
        flash.current = element; element.classList.add('block-reference-highlight'); flashTimer.current = setTimeout(clearFlash, 1200); setMessage('已定位到来源块。')
      }))
    }
    window.addEventListener('editor:open-block-anchor', openBlock)
    const paste = editor.registerCommand(PASTE_COMMAND, event => {
      if (!editor.isEditable() || !event?.clipboardData) return false
      const raw = event.clipboardData.getData('application/x-lexical-editor')
      if (!raw || !raw.includes('localBlockId')) return false
      try {
        if (raw.length > 2 * 1024 * 1024) throw Error()
        const payload = JSON.parse(raw)
        if (payload.namespace !== 'MyEditor' || !Array.isArray(payload.nodes)) return false
        const selection = $getSelection(); if (!$isRangeSelection(selection)) return false
        const nodes = $generateNodesFromSerializedNodes(removeCopiedBlockIds(payload.nodes))
        event.preventDefault(); $insertGeneratedNodes(editor, nodes, selection); return true
      } catch { event.preventDefault(); setError('复制的块内容无效或过大，未粘贴，也未修改原块。'); return true }
    }, COMMAND_PRIORITY_HIGH)
    return () => { alive.current = false; active.current = false; invalidateRead(); clearFrames(); unregister(); unsubscribe(); paste(); window.removeEventListener('editor:open-block-anchor', openBlock) }
  }, [editor, documentId, initialContent])
  useEffect(() => { if (!editable && open) close() }, [editable])
  useEffect(() => { if (open) panel.current?.querySelector('button')?.focus({ preventScroll: true }) }, [open])
  const keyboard = event => {
    if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'Tab') {
      const elements = [...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')]
      const first = elements[0], last = elements.at(-1)
      if (event.shiftKey && (document.activeElement === first || !elements.includes(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }
  return <>
    <div className="block-reference-entry"><button ref={entry} type="button" aria-haspopup="dialog" aria-expanded={open} disabled={!editable || !documentId} onMouseDown={e => e.preventDefault()} onClick={show}>块引用</button>
      {!open && (error || message) && <span role={error ? 'alert' : 'status'}>{error || message}</span>}</div>
    {open && <div className="block-reference-shade"><section ref={panel} className="block-reference-panel" role="dialog" aria-modal="true" aria-label="本地块引用与嵌入" onKeyDown={keyboard}>
      <header><div><strong>块引用与嵌入</strong><p>引用已保存的正文块，不复制或覆盖来源。</p></div><button type="button" aria-label="关闭块引用" onClick={close}>×</button></header>
      <section><h3>1 · 引用当前块</h3><p>支持顶层段落、标题、引用、列表、代码与表格。生成标识属于一次普通正文编辑。</p><div className="block-reference-actions"><button type="button" disabled={busy} onClick={createAnchor}>为当前块创建引用</button><button type="button" disabled={busy} onClick={copySource}>核对保存并复制引用</button></div>
      {sourceAddress && <label>已保存的块引用地址<input readOnly value={sourceAddress} onFocus={e => e.target.select()} /></label>}</section>
      <section><h3>2 · 插入来源块</h3><label>块引用地址<input value={address} disabled={busy} placeholder="notepad://block/…" onChange={e => { setAddress(e.target.value); setPreview(null); setError(''); setMessage('') }} /></label>
        <div className="block-reference-actions"><button type="button" disabled={busy || !address.trim()} onClick={readTarget}>读取来源块</button><label>展示方式<select value={embedded ? 'embed' : 'link'} disabled={busy} onChange={e => setEmbedded(e.target.value === 'embed')}><option value="link">行内引用</option><option value="embed">只读内容嵌入</option></select></label></div>
        {preview && <div className="block-reference-preview"><strong>{preview.title}</strong><pre>{preview.text}</pre><p>嵌入保留正文文字；图片、附件和嵌套引用显示说明，打开来源可查看原控件。</p></div>}</section>
      {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
      <footer>{busy && <button type="button" onClick={() => { invalidateRead(); setBusy(false); setPreview(null); setMessage('读取已停止，未插入内容。') }}>停止读取</button>}<button type="button" onClick={close}>取消</button><button type="button" disabled={busy || !preview} onClick={insert}>{busy ? '正在核对…' : embedded ? '确认插入嵌入' : '确认插入引用'}</button></footer>
    </section></div>}
  </>
}
