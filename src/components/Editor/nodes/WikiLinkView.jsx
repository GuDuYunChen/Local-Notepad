import React, { useEffect, useRef, useState } from 'react'
import { api } from '~/services/api'
import { readBlockReference } from '../../../services/blockReferences.mjs'
import { readWikiPreview } from '../../../services/wikiNavigation.mjs'
import { normalizeSectionPath, formatSectionPath } from '../utils/referenceUtils.js'

export default function WikiLinkView({ id, title, sectionPath = [], blockId = '' }) {
  const path = normalizeSectionPath(sectionPath)
  return <Preview key={JSON.stringify([id, title, path, blockId])} id={id} title={title} path={path} blockId={blockId} />
}

function Preview({ id, title, path, blockId }) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(false), timer = useRef(null), owner = useRef(null)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; clearTimeout(timer.current); owner.current?.abort() }
  }, [])
  const load = async () => {
    owner.current?.abort()
    const controller = new AbortController(); owner.current = controller
    setLoading(true); setPreview(null); setError('')
    try {
      const source = blockId ? await readBlockReference(api, { id, blockId }, controller.signal) : null
      const result = source ? { title: source.title, excerpt: source.text, titleChanged: source.title !== title, backlinkCount: null } : await readWikiPreview(api, { id, title, headingPath: path }, controller.signal)
      if (alive.current && owner.current === controller && !controller.signal.aborted) setPreview(result)
    } catch (failure) {
      if (alive.current && owner.current === controller && !controller.signal.aborted) setError(failure.message)
    } finally {
      if (alive.current && owner.current === controller && !controller.signal.aborted) setLoading(false)
    }
  }
  const show = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (alive.current) { setOpen(true); void load() } }, 220)
  }
  const hide = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (alive.current) { setOpen(false); owner.current?.abort() } }, 100)
  }
  const controls = event => event.target?.closest?.('[data-wiki-control]')
  const navigate = event => {
    if (controls(event)) return
    event.preventDefault(); event.stopPropagation()
    clearTimeout(timer.current); owner.current?.abort(); setOpen(false)
    window.dispatchEvent(new CustomEvent('wikiLink:open', { detail: { id, title, headingPath: path, ...(blockId ? { blockId } : {}) } }))
  }
  const section = formatSectionPath(path)
  return <span className={'wiki-link' + (error ? ' broken' : preview?.titleChanged || preview?.sectionMissing ? ' stale' : '')}
    data-wiki-target-id={typeof id === 'string' ? id : undefined}
    role="link" tabIndex={0} title={section ? '打开：' + title + ' › ' + section : '打开笔记：' + title}
    onMouseEnter={show} onMouseLeave={hide} onFocus={event => { if (event.target === event.currentTarget) show() }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) hide() }}
    onMouseDown={event => { if (!controls(event)) event.preventDefault() }} onClick={navigate}
    onKeyDown={event => { if (event.target === event.currentTarget && !event.nativeEvent.isComposing && event.keyCode !== 229 && ['Enter', ' '].includes(event.key)) navigate(event) }}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4h10l2 2v14H6z" /><path d="M9 9h6M9 13h6M9 17h4" /></svg>
    <span>{preview?.title || title}</span>
    {blockId && <small className="wiki-link-section">› 块</small>}
    {section && <small className="wiki-link-section">› {path[path.length - 1]}</small>}
    {open && <span className="wiki-link-preview" role="group" aria-label="引用预览" onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={hide}>
      <span className="wiki-link-preview-kicker">{error ? '引用暂不可用' : preview?.sectionMissing ? '章节需要核对' : section ? '关联章节' : '关联笔记'}</span>
      <strong>{preview?.title || title}</strong>
      {section && <span className="wiki-link-preview-section">{section}</span>}
      {preview?.titleChanged && <span className="wiki-link-preview-health">当前标题：{preview.title}</span>}
      {preview?.sectionMissing && <span className="wiki-link-preview-health">{preview.sectionState === 'ambiguous' ? '同名章节不唯一，打开前将拒绝猜测定位。' : '章节已改名或移除，可在“引用”面板核对。'}</span>}
      <span className={'wiki-link-preview-excerpt' + (error ? ' unavailable' : '')} role={error ? 'alert' : 'status'}>{loading ? '正在读取预览…' : error || preview?.excerpt}</span>
      {!loading && <span className="wiki-link-preview-footer"><span>{preview ? preview.backlinkCount === null ? '反向链接暂不可用' : `${preview.backlinkCount} 个已索引反向链接` : '重试不会修改正文'}</span>
        <button type="button" data-wiki-control="true" className="btn small" onClick={event => { event.preventDefault(); event.stopPropagation(); void load() }}>{error ? '重试预览' : '刷新预览'}</button></span>}
    </span>}
  </span>
}
