import React, { useId, useLayoutEffect, useMemo, useRef } from 'react'
import useS3Preview from '../hooks/useS3Preview.js'
import './S3PreviewPanel.css'

const h = React.createElement
const columns = Object.freeze([
  ['total', '候选总数'], ['upload_candidates', '上传候选'],
  ['download_candidates', '下载候选'], ['conflicts', '冲突候选'], ['noops', '无变化'],
])
const kindNames = Object.freeze({ file: '笔记与文件夹', tag: '标签', 'file-tag': '文件—标签关系', attachment: '附件元数据' })

// request is a trusted caller-owned immutable snapshot, never a DOM attribute.
// Change revision for every edit to the input, local basis or remote pin. This
// component also invalidates when the request object or disabled state changes.
// It does not collect credentials, scan a database, or apply a sync plan.
export default function S3PreviewPanel({ request = null, revision = 0, disabled = false }) {
  const { result, read, invalidate } = useS3Preview(revision)
  const id = useId()
  const token = useMemo(() => ({}), [request, revision, disabled])
  const committed = useRef(null)
  useLayoutEffect(() => {
    committed.current = token
    invalidate()
    return () => { if (committed.current === token) committed.current = null }
  }, [token, invalidate])
  const hasRequest = request !== null && request !== undefined
  const pending = result.state === 'pending'
  const ready = result.state === 'ready' && result.summary !== null && hasRequest && !disabled
  const summary = ready ? result.summary : null
  const conflicts = summary?.counts.conflicts ?? 0
  const title = conflicts > 0 ? '有候选冲突，需要人工审阅' : ready ? '本次只读预览已完成' :
    pending ? '正在等待只读预览' : result.state === 'failed' ? '本次预览未完成' :
      result.state === 'stopped' || result.state === 'blocked' ? '本次结果不可采用' : '尚未进行只读预览'
  const start = () => {
    if (committed.current !== token || disabled || !hasRequest || pending) return
    // The original hook/session own result adoption. Do not keep a second copy
    // in React state or continue with an onSuccess/apply callback here.
    void read(request)
  }
  const stop = () => { if (committed.current === token) invalidate() }
  return h('section', { className: 's3-preview-panel', 'aria-labelledby': `${id}-title`, 'aria-describedby': `${id}-boundary` },
    h('header', { className: 's3-preview-panel-heading' },
      h('div', null, h('h3', { id: `${id}-title` }, 'S3 只读预览'),
        h('p', { className: 's3-preview-panel-subtitle' }, '先比较，再判断；这里不会执行同步。')),
      h('span', { className: 's3-preview-panel-badge' }, '只读 · 不写入')),
    h('p', { id: `${id}-boundary`, className: 's3-preview-panel-boundary' }, result.limitation),
    h('div', { className: 's3-preview-panel-actions' },
      h('button', { type: 'button', className: 'btn', disabled: disabled || !hasRequest || pending,
        onClick: start, 'aria-describedby': `${id}-boundary` }, pending ? '正在预览…' : ready ? '重新预览差异' : '预览差异'),
      pending && h('button', { type: 'button', className: 'btn', onClick: stop }, '停止采用本次结果')),
    !hasRequest && h('p', { className: 's3-preview-panel-note' }, '尚未提供完整的只读比较输入；不会扫描本地数据或自动请求远端。'),
    disabled && h('p', { className: 's3-preview-panel-note' }, '当前上下文暂不允许预览；不会自动恢复请求。'),
    h('div', { className: `s3-preview-panel-status${conflicts ? ' has-conflicts' : ''}`,
      role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
      h('strong', null, title), h('p', null, result.message)),
    summary && h(React.Fragment, null,
      h('dl', { className: 's3-preview-panel-counts', 'aria-label': '本次候选统计' },
        ...columns.map(([key, label]) => h('div', { key }, h('dt', null, label), h('dd', null, summary.counts[key])))),
      conflicts > 0 && h('p', { className: 's3-preview-panel-note' }, '冲突候选不在这里选边，也不会覆盖、合并或删除任何数据。'),
      summary.counts.total === 0 && h('p', { className: 's3-preview-panel-note' }, '本次已验证的比较没有候选项；不代表远端为空，也不是初始化或删除本地数据的许可。'),
      h('div', { className: 's3-preview-panel-table', role: 'region', 'aria-label': '按对象类型查看候选统计', tabIndex: 0 },
        h('table', null,
          h('caption', null, '对象类型与候选数量'),
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, '对象类型'),
            ...columns.map(([key, label]) => h('th', { key, scope: 'col' }, label)))),
          h('tbody', null, ...summary.kinds.map(row => h('tr', { key: row.kind },
            h('th', { scope: 'row' }, kindNames[row.kind]),
            ...columns.map(([key]) => h('td', { key }, row.counts[key]))))))),
      h('p', { className: 's3-preview-panel-note' }, '方向仅表示比较候选，不是已经完成的传输；附件这里只展示元数据统计，不验证附件正文。')))
}
