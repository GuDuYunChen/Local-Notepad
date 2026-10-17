import React from 'react'
import './WikiNavigationStatus.css'

export default function WikiNavigationStatus({ state, stop, close, retry }) {
  if (!state) return null
  const waiting = ['reading', 'decision'].includes(state.phase)
  return <aside className="wiki-navigation-status" aria-label="引用导航状态">
    <header><strong>打开引用</strong><button type="button" className="icon-btn" aria-label="关闭引用导航提示" onClick={close}>×</button></header>
    <p role={state.phase === 'error' ? 'alert' : 'status'}>{state.message}</p>
    {state.request && <small>{state.request.title}{state.request.headingPath.length ? ' › ' + state.request.headingPath.join(' › ') : ''}</small>}
    <div className="wiki-navigation-actions">
      {waiting ? <button type="button" className="btn small" onClick={stop}>停止打开引用</button> : state.request && <button type="button" className="btn small" onClick={() => void retry()}>重试打开引用</button>}
      {!waiting && state.canOpenBody && <button type="button" className="btn small" onClick={() => void retry(true)}>仅打开笔记正文</button>}
    </div>
  </aside>
}
