import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const editorCSS = readFileSync('src/components/Editor/Editor.css', 'utf8')
const documentCSS = readFileSync('src/styles/editor-document.css', 'utf8')

// This is a cascade regression, not a claim of browser layout verification.
// Native acceptance additionally measures the real text and checkbox rectangles.
afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })
function mount(checklistClass, order) {
  for (const css of order) {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
  }
  document.body.innerHTML = `<div class="editor-input" contenteditable="true"><ul class="editor-list-ul"><li class="editor-list-item ${checklistClass}"><span>TASK 待办文字</span></li></ul></div>`
  return document.querySelector('li')
}

describe('native checklist text has a dedicated checkbox gutter', () => {
  for (const state of ['checked', 'unchecked']) {
    for (const [orderName, order] of [['document-last', [editorCSS, documentCSS]], ['editor-last', [documentCSS, editorCSS]]]) {
      it(`${state}: reserves the original checkbox gutter with ${orderName}`, () => {
        const item = mount(`editor-list-item-${state}`, order)
        expect(getComputedStyle(item).paddingLeft).toBe('28px')
        expect(item.textContent).toBe('TASK 待办文字')
        expect(item.querySelector('span').textContent).toBe('TASK 待办文字')
      })
    }
  }
  it('does not expand the ordinary list-item gutter', () => {
    const item = mount('', [editorCSS, documentCSS])
    expect(parseFloat(getComputedStyle(item).paddingLeft)).toBeCloseTo(parseFloat(getComputedStyle(item).fontSize) * 0.12)
  })
  it('does not install a global list-item padding override', () => {
    const item = mount('editor-list-item-unchecked', [editorCSS, documentCSS])
    document.querySelector('.editor-input').className = 'outside-editor'
    expect(parseFloat(getComputedStyle(item).paddingLeft)).toBeCloseTo(parseFloat(getComputedStyle(item).fontSize) * 1.9)
  })
})
