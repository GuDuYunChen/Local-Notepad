import React, { useEffect, useMemo, useRef, useState } from 'react'
import { researchTasks } from '~/services/researchTasks'
import { createStudyCompilation } from '~/services/studyCompilation'
import { downloadCollectionReviewReport } from '~/services/collectionReviewReport'
import './StudyCompilationPanel.css'

export default function StudyCompilationPanel({ active, disabled, model, selected, hub, sourceStore, studyStore,
  folders = [], receipt, onReceipt, service: suppliedService }) {
  const service = useMemo(() => suppliedService || createStudyCompilation({ hub, sourceStore, studyStore, creationService: researchTasks }), [suppliedService, hub, sourceStore, studyStore])
  const [config, setConfig] = useState(() => ({ title: '阅读研究笔记 ' + new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-'), goal: '', group: 'collection', parentId: '' }))
  const [preview, setPreview] = useState(null), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [localReceipt, setLocalReceipt] = useState(null)
  const operation = useRef(null), mounted = useRef(false), current = useRef(null)
  const signature = JSON.stringify([config, [...selected].sort()])
  current.current = { active, disabled, model, signature, service }
  const attempt = receipt || localReceipt
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort() } }, [])
  useEffect(() => { if (!active) operation.current?.abort() }, [active])
  useEffect(() => { if (!attempt) setPreview(null) }, [signature, model, attempt])
  const publish = value => {
    if (mounted.current) setLocalReceipt(value)
    try { onReceipt?.(value) } catch { /* a view refresh failure must not turn a confirmed write into failure */ }
  }
  const optionsFor = controller => ({ signal: controller.signal, isCurrent: () => mounted.current &&
    current.current.active && !current.current.disabled && current.current.model === model &&
    current.current.signature === signature && current.current.service === service && operation.current === controller })
  const prepare = async () => {
    if (operation.current || disabled || attempt || !selected.size) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setNotice(''); setPreview(null)
    const options = optionsFor(controller)
    try { const next = await service.prepare(model, [...selected], config, options); if (options.isCurrent() && !controller.signal.aborted) setPreview(next) }
    catch (failure) { if (mounted.current && !controller.signal.aborted) setError(failure.message) }
    finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setBusy(false) } }
  }
  const create = async () => {
    if (!preview || operation.current || disabled || attempt) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setNotice('')
    const draft = { text: preview.markdown, filename: preview.title, type: 'text/markdown;charset=utf-8' }
    publish({ status: 'pending', title: preview.title, draft })
    try {
      const file = await service.create(preview, optionsFor(controller))
      publish({ status: 'confirmed', ...file, draft })
      try { window.dispatchEvent(new Event('library:refresh')) } catch { /* library can be refreshed independently */ }
      if (mounted.current) setNotice('独立研究笔记已创建。未切换正文或清空批注；可用上方按钮打开。' + (file.localWarning || ''))
    } catch (failure) {
      publish(failure.mayHaveCreated ? { status: 'uncertain', title: preview.title, message: failure.message, taskId: failure.taskId, draft } : null)
      if (mounted.current) setError(failure.message)
    } finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setBusy(false) } }
  }
  const saveDraft = async () => {
    if (!preview || operation.current || disabled || attempt || !service.saveDraft) return
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setNotice('')
    try {
      await service.saveDraft(preview, optionsFor(controller))
      if (mounted.current && !controller.signal.aborted) setNotice('研究预览草稿已保存到本机。重开应用后可在“研究草稿与创建记录”中继续；没有创建正文。')
    } catch (e) { if (mounted.current) setError(e.message) }
    finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setBusy(false) } }
  }
  const download = () => {
    try {
      if (!attempt) service.assertCurrent(preview)
      downloadCollectionReviewReport({ text: preview.markdown, filename: preview.title, type: 'text/markdown;charset=utf-8' })
      setNotice('已发起 Markdown 草稿下载；请核对保存位置。文件含所选私人批注，不含正文。')
    } catch (failure) { setError(failure.message) }
  }
  const update = patch => { setConfig(old => ({ ...old, ...patch })); setError('') }
  return <details className="study-compilation" aria-label="批注整理成研究笔记">
    <summary>整理成研究笔记 · 已选 {selected.size} 条</summary>
    <p>复用上方跨页选择，保留已存批注原文、来源与链接，不生成总结。预览后才新建独立笔记，不覆盖现有正文。</p>
    <fieldset disabled={disabled || busy || !!attempt} className="study-compilation-form">
      <label>笔记名称<input aria-label="研究笔记名称" maxLength={120} value={config.title} onChange={e => update({ title: e.target.value })} /></label>
      <label>存放目录<select aria-label="研究笔记存放目录" value={config.parentId} onChange={e => update({ parentId: e.target.value })}>
        <option value="">根目录</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.label}</option>)}
        {config.parentId && !folders.some(folder => folder.id === config.parentId) && <option value={config.parentId}>原目录不可用</option>}
      </select></label>
      <label>组织方式<select aria-label="研究笔记分组" value={config.group} onChange={e => update({ group: e.target.value })}><option value="collection">按资料集</option><option value="status">按阅读状态</option></select></label>
      <label className="study-compilation-goal">研究目标（可选）<textarea aria-label="研究目标" maxLength={2000} rows={3} value={config.goal} onChange={e => update({ goal: e.target.value })} /></label>
      <button type="button" disabled={!selected.size} onClick={() => void prepare()}>预览所选批注研究笔记</button>
    </fieldset>
    {busy && <p role="status">{attempt?.status === 'pending' ? '正在创建；关闭窗口不能撤销已经发出的写入。' : '正在核对来源与生成预览…'}</p>}
    {error && <p className="study-hub-notice" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {attempt?.status === 'uncertain' && <p className="study-hub-notice">可在下方“研究草稿与创建记录”中查回或使用同一任务重试；当前预览不会自动重发，草稿仍可下载。</p>}
    {attempt?.status === 'confirmed' && <button type="button" onClick={() => { publish(null); setPreview(null); setNotice(''); setError(''); update({ title: '阅读研究笔记 ' + new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-') }) }}>开始另一份研究笔记</button>}
    {preview && <section className="study-compilation-preview" aria-label="研究笔记完整预览">
      <header><h4>{preview.title}</h4><p>{preview.count} 条已存批注 · {preview.groups.length} 个分组 · 全部所选条目，不限于当前页</p></header>
      <div className="study-hub-actions">{service.saveDraft && <button type="button" disabled={disabled || busy || !!attempt} onClick={() => void saveDraft()}>保存研究预览草稿</button>}<button type="button" disabled={disabled || busy || !!attempt} onClick={() => void create()}>确认创建独立研究笔记</button><button type="button" disabled={busy || (!attempt && disabled)} onClick={download}>下载研究笔记 Markdown</button></div>
      <div className="study-compilation-document"><h4>研究目标</h4><p>{preview.goal || '（待填写）'}</p><h4>我的结论与下一步</h4><p>（请在新笔记中自行填写。）</p>
        {preview.groups.map(group => <section key={group.key}><h4>{group.title}</h4>{group.items.map(item => <article key={JSON.stringify([item.collectionId, item.id])}>
          <h5>{item.title || '未命名'}</h5><small>{item.collectionName} · {item.collectionId} · 原第 {item.ordinal} 条 · {item.folderPath || '根目录'} · 笔记 ID：{item.id}</small><p>{item.note}</p>
        </article>)}</section>)}
      </div>
    </section>}
    <p className="study-compilation-boundary">每次 1–200 条有批注的资料，文档最多 2 MiB。创建不包含未存批注、正文或附件。下载是 Markdown 草稿；应用内新笔记另有可点击的来源 WikiLink。创建后来源再变化，不会自动改写研究笔记。</p>
  </details>
}
