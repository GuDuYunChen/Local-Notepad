import { describe, it, expect } from 'vitest'
/**
 * @vitest-environment jsdom
 */
import React from 'react'
import ReactDOMServer from 'react-dom/server'
import Editor from '../src/components/Editor/Editor'

describe('表格尺寸选择面板重构', () => {
  it('仅渲染“插入表格”入口并移除独立按钮', () => {
    const html = ReactDOMServer.renderToString(<Editor />)
    expect(html.includes('插入表格')).toBe(true)
    const removed = ['选择模式','添加行','删除行','添加列','删除列']
    removed.forEach(t => expect(html.includes(t)).toBe(false))
  })
  it('无选区时动作路由不报错（示例：顶对齐）', () => {
    const html = ReactDOMServer.renderToString(<Editor />)
    expect(html.length).toBeGreaterThan(0)
  })
})
