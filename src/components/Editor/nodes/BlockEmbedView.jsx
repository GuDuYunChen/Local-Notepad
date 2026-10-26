import React, { useEffect, useRef, useState } from 'react'
import { api } from '~/services/api'
import { queueBlockReference } from '../../../services/blockReferences.mjs'
import '../plugins/BlockReferences.css'
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
  const stop = () => { owner.current?.abort(); setPhase('stopped'); setResult(null) }
  return <section className="block-reference-embed" contentEditable={false} aria-label={'块嵌入：' + (result?.title || title || '笔记')}>
    <header><strong>{result?.title || title || '关联笔记'}</strong><span>只读块嵌入</span></header>
    {phase === 'loading' && <p role="status">正在读取来源的已保存正文…</p>}
    {phase === 'stopped' && <p role="status">读取已停止，未修改源笔记。</p>}
    {error && <p role="alert">{error}</p>}
    {result && <><pre>{result.text}</pre><small>来源更新于 {new Date(result.updatedAt * 1000).toLocaleString()}。嵌套引用仅显示标识，不递归展开。</small></>}
    <footer>{phase === 'loading' ? <button type="button" onClick={stop}>停止读取</button> : <button type="button" onClick={() => void load()}>刷新来源</button>}
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('wikiLink:open', { detail: { id, title: result?.title || title, blockId } }))}>打开来源块</button></footer>
  </section>
}
