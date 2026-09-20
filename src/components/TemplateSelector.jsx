import React, { useEffect } from 'react'

const TEMPLATES = [
  {
    id: 'blank',
    title: '空白笔记',
    category: '自由记录',
    description: '从干净页面开始，不预设任何结构。',
    preview: ['自由书写', '适合临时记录与草稿'],
    content: '',
  },
  {
    id: 'meeting',
    title: '会议记录',
    category: '工作',
    description: '议题、结论和待办事项放在同一页。',
    preview: ['讨论要点', '结论', '待办事项'],
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
    category: '计划',
    description: '快速建立目标、里程碑和下一步。',
    preview: ['目标', '里程碑', '下一步'],
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
    category: '学习',
    description: '记录核心观点、摘录和自己的思考。',
    preview: ['核心观点', '值得记录', '我的思考'],
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
    category: '灵感',
    description: '快速捕捉尚未成形、值得继续发展的想法。',
    preview: ['为什么值得继续', '可能的方向', '需要验证'],
    content: `想法

为什么值得继续

可能的方向
- 

需要验证
- 
`,
  },
]

function TemplateIcon({ id }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }

  if (id === 'meeting') {
    return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M7 11h10M7 15h6" /></svg>
  }
  if (id === 'project') {
    return <svg {...common}><path d="M5 4h14v16H5z" /><path d="M8 9h8M8 13h5M8 17h7" /><path d="m16 13 1.5 1.5L20 12" /></svg>
  }
  if (id === 'reading') {
    return <svg {...common}><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23z" /><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5A3.5 3.5 0 0 1 20 23z" /></svg>
  }
  if (id === 'idea') {
    return <svg {...common}><path d="M9 18h6M10 22h4" /><path d="M8.5 15.5A6 6 0 1 1 15.5 15.5c-.9.7-1.5 1.4-1.5 2.5h-4c0-1.1-.6-1.8-1.5-2.5z" /></svg>
  }
  return <svg {...common}><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4" /></svg>
}

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
    <div
      className="modal-overlay template-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <section className="template-selector" role="dialog" aria-modal="true" aria-labelledby="template-title">
        <header className="template-selector-header">
          <div>
            <div className="template-eyebrow">新建笔记</div>
            <h2 id="template-title">从哪里开始？</h2>
            <p>直接空白开始，或者先套一个轻量结构，之后都可以自由修改。</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭" title="关闭">×</button>
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
                <span className="template-card-icon"><TemplateIcon id={template.id} /></span>
                <span className="template-card-title">
                  <strong>{template.title}</strong>
                  <small>{template.category}</small>
                </span>
              </span>

              <span className="template-card-description">{template.description}</span>

              <span className="template-card-preview" aria-hidden="true">
                {template.preview.map(item => (
                  <span key={item}>
                    <i />
                    <em>{item}</em>
                  </span>
                ))}
              </span>

              <span className="template-card-arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
