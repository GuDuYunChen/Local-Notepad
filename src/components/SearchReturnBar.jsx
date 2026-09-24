import React from 'react'
import { SEARCH_SOURCES } from '~/services/globalSearch'
import './SearchReturnBar.css'

export default function SearchReturnBar({ origin, documentId, dirty, onReturn, onEnd }) {
  if (!origin || origin.documentId !== documentId) return null
  return <section className="search-return-bar" aria-label="检索返回导航">
    <div><strong>从检索进入</strong><span>{origin.filters.query || '浏览全部笔记'} · {SEARCH_SOURCES[origin.filters.source]}</span>
      <small>{dirty ? '未保存草稿仍留在编辑器；返回只查看已保存的检索结果。' : '返回会重新检索，并按笔记标识找回原结果；不会改写正文。'}</small></div>
    <button type="button" onClick={onReturn}>返回检索结果</button>
    <button type="button" onClick={onEnd} aria-label="结束检索往返">结束往返</button>
  </section>
}
