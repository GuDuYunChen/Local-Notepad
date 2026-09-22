import { describe, expect, it } from 'vitest'
import { normalizeLegacyTableBreakMarkup } from './legacyContentCompatibility'

describe('legacy content compatibility', () => {
  it('converts legacy table-cell <br> text into Lexical linebreak nodes', () => {
    const source = JSON.stringify({
      root: {
        type: 'root',
        children: [{
          type: 'table',
          children: [{
            type: 'tablerow',
            children: [{
              type: 'tablecell',
              children: [{
                type: 'paragraph',
                children: [{
                  type: 'text',
                  text: '来源：天地灵气。<br>方式：吐纳导引。',
                  detail: 0,
                  format: 0,
                  mode: 'normal',
                  style: '',
                  version: 1,
                }],
                version: 1,
              }],
              version: 1,
            }],
            version: 1,
          }],
          version: 1,
        }],
        version: 1,
      },
    })

    const normalized = JSON.parse(normalizeLegacyTableBreakMarkup(source))
    const children = normalized.root.children[0].children[0].children[0].children[0].children

    expect(children).toEqual([
      expect.objectContaining({
        type: 'text',
        text: '来源：天地灵气。',
      }),
      {
        type: 'linebreak',
        version: 1,
      },
      expect.objectContaining({
        type: 'text',
        text: '方式：吐纳导引。',
      }),
    ])
  })

  it('does not rewrite literal <br> text outside table cells', () => {
    const source = JSON.stringify({
      root: {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [{
            type: 'text',
            text: '正文示例 <br> 不应自动改写',
            version: 1,
          }],
          version: 1,
        }],
        version: 1,
      },
    })

    expect(normalizeLegacyTableBreakMarkup(source)).toBe(source)
  })
})
