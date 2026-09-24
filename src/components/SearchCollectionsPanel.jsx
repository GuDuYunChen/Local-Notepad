import React, { useRef } from 'react'
import { MAX_SEARCH_COLLECTIONS } from '~/services/searchCollections'
import './SearchCollectionsPanel.css'

const labels = { historical: '尚未复查', unchanged: '本次未变化', body: '正文有变化', metadata: '元数据变化', outside: '不在原检索范围' }
const date = value => new Date(value).toLocaleString('zh-CN')
export default function SearchCollectionsPanel({ model, onOpenFile }) {
  const selectRef = useRef(null)
  const { selected, shelf, check, busy, preview, deleting } = model
  const collection = selected?.collection
  const rows = check?.rows || collection?.report.items.map(item => ({ id: item.id, before: item, current: null, status: 'historical', reasons: [] })) || []
  const query = model.query.normalize('NFC').trim().toLowerCase()
  const matching = rows.filter(row => (model.status === 'all' || row.status === model.status) &&
    (!query || [row.id, row.before.title, row.before.folderPath, row.current?.title, row.current?.folderPath]
      .some(value => value?.normalize('NFC').toLowerCase().includes(query))))
  const pages = Math.max(1, Math.ceil(matching.length / 8)), page = Math.min(model.page, pages)
  const locked = busy || !!deleting || !!preview
  return <section className="search-collections" aria-label="本地检索资料集">
    <header><h3>本地资料集</h3><p>保存的是当时的笔记清单，不是正文备份。重开查看历史元数据；复查按原来的固定检索范围读取当前数据。</p></header>
    <div className="search-collections-tools">
      <label>已保存资料集<select ref={selectRef} aria-label="已保存资料集" value={selected?.key || ''} disabled={locked} onChange={event => model.choose(event.target.value)}>
        <option value="">选择资料集</option>
        {shelf.entries.map((entry, index) => <option key={entry.key} value={entry.key}>{entry.collection ? `${entry.collection.name} · ${entry.collection.report.count} 篇` : `不可读取的资料集 ${index + 1}`}</option>)}
      </select></label>
      <button type="button" onClick={model.refresh} disabled={locked}>刷新资料集</button>
      <button type="button" disabled={locked || !collection || !!shelf.error} onClick={() => void model.inspect()}>检查当前变化</button>
      <button type="button" disabled={locked || !collection || !!shelf.error} onClick={model.export}>备份此资料集 JSON</button>
      <button type="button" disabled={locked || !selected || !!shelf.error} onClick={model.requestDelete}>删除此资料集</button>
    </div>
    <details className="search-collections-import"><summary>导入资料集备份</summary>
      <p>只接受本功能导出的单份资料集 JSON，最多 2 MiB。确认后新增独立副本，不覆盖同名记录，不导入或创建正文。</p>
      <input type="file" accept=".json,application/json" aria-label="选择资料集备份" disabled={locked} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; void model.prepareImport(file)
      }} />
    </details>
    {preview && <div className="search-collections-notice" role="group" aria-label="资料集导入预检">
      <strong>{preview.value.name} · {preview.value.report.count} 篇</strong>
      <p>历史检索时间：{date(preview.value.report.exportedAt)}。只包含元数据，未校验这些笔记在本机是否仍存在。</p>
      <button type="button" onClick={model.cancelImport}>取消资料集导入</button>
      <button type="button" onClick={model.confirmImport}>确认导入独立资料集</button>
    </div>}
    {deleting && <div className="search-collections-notice" role="group" aria-label="确认删除资料集">
      <p>删除“{deleting.collection?.name || '不可读取的资料集'}”？只移除此份本地清单，不删除笔记；需要保留时请先备份。</p>
      <button type="button" onClick={() => { model.cancelDelete(); selectRef.current?.focus() }}>取消删除资料集</button>
      <button type="button" onClick={() => { model.confirmDelete(); selectRef.current?.focus() }}>确认删除资料集</button>
    </div>}
    {(shelf.error || model.error || selected?.error) && <p className="search-collections-notice" role="alert">{model.error || shelf.error || selected.error}</p>}
    {model.message && <p className="search-collections-notice" role="status" aria-live="polite">{model.message}</p>}
    {busy && <div className="search-collections-notice" role="status">正在准备… {model.progress && `${model.progress.completed} / ${model.progress.total} 页`}
      <button type="button" onClick={model.cancel}>取消资料集准备</button></div>}
    {collection ? <>
      <div className="search-collections-context">
        <h4>{collection.name}</h4>
        <p>历史检索：{date(collection.report.exportedAt)} · 本机保存：{date(collection.savedAt)} · {collection.report.count} 篇</p>
        <p>原关键词：{collection.report.scope.criteria.query || '（空，浏览笔记）'} · 原目录：{collection.report.scope.folderLabel}</p>
        <p>原修改时间起点：{collection.report.scope.criteria.since ? date(collection.report.scope.criteria.since * 1000) : '不限'}。复查固定使用此起点，不重新计算“最近 N 天”。</p>
        {check && <><p>复查时间：{date(check.checkedAt)} · 未变化 {check.counts.unchanged} · 正文变化 {check.counts.body} · 元数据变化 {check.counts.metadata} · 不在原范围 {check.counts.outside}</p>
          <p>当前范围另有 {check.otherMatches} 篇不在这份资料集中，不表示它们是新建笔记；复查不会自动加入或移除条目。</p>
          {check.currentReport.scope.unsupported > 0 && <p>当前有 {check.currentReport.scope.unsupported} 篇正文格式未能解析，正文匹配可能不完整。</p>}</>}
      </div>
      <div className="search-collections-tools">
        <label>筛选条目<input type="search" aria-label="搜索资料集条目" value={model.query} onChange={event => model.setQuery(event.target.value)} placeholder="标题、目录或笔记 ID" /></label>
        <label>变化状态<select aria-label="资料集变化筛选" value={model.status} onChange={event => model.setStatus(event.target.value)}>
          <option value="all">全部条目</option>
          {Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
      </div>
      <p role="status">显示 {matching.length} / {rows.length} 篇历史条目</p>
      <div className="search-collections-rows">
        {matching.slice((page - 1) * 8, page * 8).map(row => <article key={row.id} aria-label={'资料集条目 ' + row.id}>
          <header><strong>{row.before.title || '未命名'}</strong><span>{labels[row.status]}</span></header>
          <p>保存时目录：{row.before.folderPath || '根目录'}</p>
          {row.current && row.reasons.length > 0 && <><p>当前标题：{row.current.title} · 当前目录：{row.current.folderPath || '根目录'}</p><p>{row.reasons.join(' · ')}</p></>}
          <small>笔记 ID：{row.id}</small>
          {row.status === 'outside' && <p>可能因正文、目录、筛选或删除而不再匹配，也可能正文未能解析；这不是已删除的证明。</p>}
          <button type="button" disabled={locked || !onOpenFile || !!shelf.error} onClick={() => void onOpenFile(row.before)}>打开当前笔记</button>
        </article>)}
        {!matching.length && <p>没有符合当前筛选的条目；历史资料集未删减。</p>}
      </div>
      <nav className="search-collections-pagination" aria-label="资料集分页">
        <button type="button" disabled={page <= 1} onClick={() => model.setPage(page - 1)}>资料集上一页</button>
        <span>第 {page} / {pages} 页</span>
        <button type="button" disabled={page >= pages} onClick={() => model.setPage(page + 1)}>资料集下一页</button>
      </nav>
    </> : <div className="global-search-empty">在“检索结果 → 结果清单与导出”中命名并保存，或从这里导入资料集备份。</div>}
    <footer>最多 {MAX_SEARCH_COLLECTIONS} 份，每份 2000 篇、2 MiB。记录保存在当前应用本地存储，不随数据库备份或核对存档迁移，请单独备份 JSON。打开读取当前正文，仍经过保存／不保存／取消确认；不使用历史指纹冒充当前定位。</footer>
  </section>
}
