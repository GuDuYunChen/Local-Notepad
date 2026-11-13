import React, { useEffect, useRef, useState } from 'react'
import { api } from '~/services/api'
import { queueBlockReference } from '../../../services/blockReferences.mjs'
import '../plugins/BlockReferences.css'
import { UiButton } from '~/components/ui/ControlKit'

export default function BlockEmbedView({ id, blockId, title }) {
  return <Embed key={JSON.stringify([id, blockId])} id={id} blockId={blockId} title={title} />
}
function Embed({ id, blockId, title }) {
  const [result, setResult] = useState(null), [phase, setPhase] = useState('loading'), [error, setError] = useState('')
  const owner = useRef(null), alive = useRef(false)
  const load = async () => {
    owner.current?.abort(); const controller = new AbortController(); owner.current = controller
    setPhase('loading'); setError(''); setResult(null)
    try {
      const next = await queueBlockReference(api, { id, blockId }, controller.signal)
      if (alive.current && owner.current === controller && !controller.signal.aborted) { setResult(next); setPhase('ready') }
    } catch (failure) {
      if (alive.current && owner.current === controller && !controller.signal.aborted) { setError(failure.message); setPhase('error') }
    }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; owner.current?.abort() } }, [])
  const embedElement = useRef(null)
  useEffect(() => {
    // Lexical intentionally consumes plain Tab for indentation. F6 is a
    // separate, keyboard-only route into a read-only block's real buttons.
    // Keep the existing Tab/Shift+Tab editing semantics unchanged.
    const embed = embedElement.current
    const root = embed?.closest('.editor-input[contenteditable="true"]')
    if (!root) return undefined
    const enter = event => {
      if (event.defaultPrevented || event.key !== 'F6' || event.altKey ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing ||
          event.target !== root || root.ownerDocument.activeElement !== root) return
      const first = root.querySelector('.block-reference-embed footer button:first-child')
      if (!first || !embed.contains(first) || first.disabled || !first.isConnected) return
      first.focus()
      if (root.ownerDocument.activeElement !== first) return
      event.preventDefault()
      event.stopPropagation()
    }
    root.addEventListener('keydown', enter, true)
    return () => root.removeEventListener('keydown', enter, true)
  }, [])
  const stop = () => { owner.current?.abort(); setPhase('stopped'); setResult(null) }
  return <section ref={embedElement} className="block-reference-embed" contentEditable={false} title="按 F6 从编辑正文进入块嵌入操作" aria-label={'块嵌入：' + (result?.title || title || '笔记')}>
    <header><strong>{result?.title || title || '关联笔记'}</strong><span>只读块嵌入</span></header>
    {phase === 'loading' && <p role="status">正在读取来源的已保存正文…</p>}
    {phase === 'stopped' && <p role="status">读取已停止，未修改源笔记。</p>}
    {error && <p role="alert">{error}</p>}
    {result && <><pre>{result.text}</pre><small>来源更新于 {new Date(result.updatedAt * 1000).toLocaleString()}。嵌套引用仅显示标识，不递归展开。</small></>}
    <footer>{phase === 'loading' ? <UiButton density="compact" type="button" onClick={stop}>停止读取</UiButton> : <UiButton density="compact" type="button" onClick={() => void load()}>刷新来源</UiButton>}
      <UiButton density="compact" type="button" onClick={() => window.dispatchEvent(new CustomEvent('wikiLink:open', { detail: { id, title: result?.title || title, blockId } }))}>打开来源块</UiButton></footer>
  </section>
}
