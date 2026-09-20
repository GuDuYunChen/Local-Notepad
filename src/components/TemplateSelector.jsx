import React, { useEffect } from 'react'

const TEMPLATES = [
  {
    id: 'blank',
    title: '空白笔记',
    description: '从一张干净的页面开始。',
    shortcut: 'Blank',
    content: '',
  },
  {
    id: 'meeting',
    title: '会议记录',
    description: '议题、结论和待办事项放在同一页。',
    shortcut: 'Meeting',
    content: `会议主题

日期：
参与人：

讨论要点
- 

结论
- 

待办事项
- [ ] 
`,
  },
  {
    id: 'project',
    title: '项目计划',
    description: '快速建立目标、里程碑和下一步。',
    shortcut: 'Project',
    content: `项目名称

目标

背景

里程碑
- 

下一步
- [ ] 

备注
`,
  },
  {
    id: 'reading',
    title: '阅读笔记',
    description: '记录核心观点、摘录和自己的思考。',
    shortcut: 'Reading',
    content: `书名 / 文章

作者：

核心观点
- 

值得记录
- 

我的思考

下一步
`,
  },
  {
    id: 'idea',
    title: '灵感草稿',
    description: '低结构、快速捕捉尚未成形的想法。',
    shortcut: 'Idea',
    content: `想法

为什么值得继续

可能的方向
- 

需要验证
- 
`,
  },
]

export default function TemplateSelector({ open, onClose, onSelect }) {
  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const choose = (template) => {
    if (template.id === 'blank') onSelect?.(null)
    else onSelect?.({ id: template.id, title: template.title, content: template.content })
  }

  return (
    <div className="modal-overlay template-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.()
    }}>
      <section className="template-selector" role="dialog" aria-modal="true" aria-labelledby="template-title">
        <header className="template-selector-header">
          <div>
            <div className="template-eyebrow">新建笔记</div>
            <h2 id="template-title">选择模板</h2>
            <p>先选择一个结构，也可以直接创建空白笔记。</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <div className="template-grid">
          {TEMPLATES.map((template, index) => (
            <button
              key={template.id}
              type="button"
              className={`template-card${index === 0 ? ' primary-template' : ''}`}
              onClick={() => choose(template)}
            >
              <span className="template-card-top">
                <strong>{template.title}</strong>
                <small>{template.shortcut}</small>
              </span>
              <span className="template-card-description">{template.description}</span>
              <span className="template-card-arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
