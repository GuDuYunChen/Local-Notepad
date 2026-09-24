import SearchPresetTransfer from './SearchPresetTransfer'
import React, { useEffect, useRef, useState } from 'react'
import { SEARCH_PRESET_PREFIX, searchPresets } from '~/services/searchPresets'

export default function SearchPresetsPanel({ filters, onApply, store = searchPresets }) {
  const [shelf, setShelf] = useState(() => store.list())
  const [name, setName] = useState(''), [selectedKey, setSelectedKey] = useState('')
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [deleting, setDeleting] = useState(null)
  const selectRef = useRef(null)
  useEffect(() => {
    const refresh = () => setShelf(store.list())
    const storage = event => { if (event.key === null || event.key?.startsWith(SEARCH_PRESET_PREFIX)) refresh() }
    const unsubscribe = store.subscribe(refresh)
    window.addEventListener('storage', storage); window.addEventListener('focus', refresh)
    refresh()
    return () => { unsubscribe(); window.removeEventListener('storage', storage); window.removeEventListener('focus', refresh) }
  }, [store])
  const selected = shelf.entries.find(entry => entry.key === selectedKey)
  const run = action => { setError(''); setMessage(''); try { action() } catch (failure) { setError(failure.message || '操作失败，原记录未改动'); setShelf(store.list()) } }
  const cancelDelete = () => { setDeleting(null); selectRef.current?.focus() }
  return <details className="search-presets">
    <summary>常用检索 · {shelf.error ? '读取失败' : shelf.entries.length + ' 条'}</summary>
    <p className="global-search-help">仅点击保存后将名称和关键词留在本机，不自动记录搜索历史。不含笔记或结果，也不随正文数据库备份迁移。</p>
    <div className="search-presets-tools">
      <label>检索名称<input aria-label="保存检索名称" maxLength={96} value={name} onChange={event => setName(event.target.value)} placeholder="例如：最近一周的设定检查" /></label>
      <button type="button" disabled={!!shelf.error || !!deleting} onClick={() => run(() => {
        const preset = store.save(name, filters); setSelectedKey(SEARCH_PRESET_PREFIX + preset.id); setName(''); setMessage('已保存当前检索条件；后续修改不会自动覆盖。')
      })}>保存当前检索</button>
      <label>已保存检索<select ref={selectRef} aria-label="已保存检索" value={selected ? selectedKey : ''} disabled={!!deleting} onChange={event => { setSelectedKey(event.target.value); setMessage(''); setError('') }}>
        <option value="">选择常用检索</option>
        {shelf.entries.map((entry, index) => <option key={entry.key} value={entry.key}>{entry.preset?.name || '不可读取的检索 ' + (index + 1)}</option>)}
      </select></label>
      <button type="button" disabled={!selected?.preset || !!shelf.error || !!deleting} onClick={() => run(() => {
        onApply(store.apply(selected)); setMessage('已重新检索；最近 N 天按本次时间计算，目录不会自动扩大。')
      })}>应用检索</button>
      <button type="button" disabled={!selected || !!shelf.error || !!deleting} onClick={() => { setDeleting(selected); setError(''); setMessage('') }}>删除此检索</button>
      <button type="button" onClick={() => setShelf(store.list())}>刷新已保存检索</button>
    </div>
    <SearchPresetTransfer store={store} disabled={!!deleting} />
    {selected?.error && <p role="status">{selected.error}</p>}
    {deleting && <div className="search-presets-confirm" role="group" aria-label="确认删除已保存检索">
      <span>删除“{deleting.preset?.name || '不可读取的检索'}”？只移除此条检索条件，不删除笔记。</span>
      <button type="button" onClick={cancelDelete}>取消删除</button>
      <button type="button" onClick={() => run(() => { store.remove(deleting); setSelectedKey(''); cancelDelete(); setMessage('此条检索已删除，笔记未改动。') })}>确认删除检索</button>
    </div>}
    {(shelf.error || error) && <p className="global-search-notice" role="alert">{error || shelf.error}</p>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </details>
}
