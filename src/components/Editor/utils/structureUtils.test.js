import { describe, expect, it } from 'vitest'
import {
  buildLongFormStructure,
  extractStructureSection,
  mergeStructureSectionWithPrevious,
  moveStructureSectionAdjacent,
  planSectionExtractionImpact,
  rewriteSectionTargetReferences,
} from './structureUtils'

function text(value) {
  return { type: 'text', text: value }
}

function heading(tag, value) {
  return {
    type: 'heading',
    tag,
    children: [text(value)],
  }
}

function paragraph(value) {
  return {
    type: 'paragraph',
    children: [text(value)],
  }
}

function state(children) {
  return JSON.stringify({
    root: {
      type: 'root',
      children,
    },
  })
}

describe('long-form structure utilities', () => {
  it('builds a volume chapter and scene tree from headings', () => {
    const content = state([
      heading('h1', '第一卷'),
      paragraph('卷正文'),
      heading('h2', '第一章'),
      paragraph('章正文'),
      heading('h3', '第一场'),
      paragraph('场正文'),
      heading('h2', '第二章'),
      heading('h1', '第二卷'),
    ])

    const structure = buildLongFormStructure(content)

    expect(structure.counts).toEqual({
      volumes: 2,
      chapters: 2,
      scenes: 1,
      headings: 5,
    })
    expect(structure.roots).toHaveLength(2)
    expect(structure.roots[0].text).toBe('第一卷')
    expect(structure.roots[0].children.map(item => item.text)).toEqual([
      '第一章',
      '第二章',
    ])
    expect(structure.roots[0].children[0].children[0].path).toEqual([
      '第一卷',
      '第一章',
      '第一场',
    ])
  })

  it('reorders sibling sections without separating their descendant blocks', () => {
    const content = state([
      heading('h1', '第一卷'),
      heading('h2', '第一章'),
      paragraph('A'),
      heading('h3', '第一场'),
      paragraph('A1'),
      heading('h2', '第二章'),
      paragraph('B'),
    ])
    const structure = buildLongFormStructure(content)
    const second = structure.sections.find(item => item.text === '第二章')

    const moved = moveStructureSectionAdjacent(content, second.id, 'up')
    const next = JSON.parse(moved.content)

    expect(moved.changed).toBe(true)
    expect(next.root.children.map(node => (
      node.type === 'heading' ? node.children[0].text : node.children[0]?.text
    ))).toEqual([
      '第一卷',
      '第二章',
      'B',
      '第一章',
      'A',
      '第一场',
      'A1',
    ])
  })

  it('merges a sibling section and returns deterministic reference mappings', () => {
    const content = state([
      heading('h1', '第一卷'),
      heading('h2', '第一章'),
      paragraph('A'),
      heading('h2', '第二章'),
      paragraph('B'),
      heading('h3', '第二场'),
      paragraph('B2'),
    ])
    const structure = buildLongFormStructure(content)
    const second = structure.sections.find(item => item.text === '第二章')

    const merged = mergeStructureSectionWithPrevious(content, second.id)
    const next = JSON.parse(merged.content)

    expect(merged.changed).toBe(true)
    expect(merged.previous.path).toEqual(['第一卷', '第一章'])
    expect(merged.mappings).toEqual([
      {
        before: ['第一卷', '第二章'],
        after: ['第一卷', '第一章'],
      },
      {
        before: ['第一卷', '第二章', '第二场'],
        after: ['第一卷', '第一章', '第二场'],
      },
    ])
    expect(next.root.children.some(node => (
      node.type === 'heading' &&
      node.children?.[0]?.text === '第二章'
    ))).toBe(false)
  })

  it('extracts a nested chapter while preserving ancestor headings and paths', () => {
    const content = state([
      heading('h1', '第一卷'),
      paragraph('卷前言'),
      heading('h2', '第一章'),
      paragraph('A'),
      heading('h3', '第一场'),
      paragraph('A1'),
      heading('h2', '第二章'),
      paragraph('B'),
    ])

    const extracted = extractStructureSection(content, ['第一卷', '第一章'])
    const source = JSON.parse(extracted.sourceContent)
    const target = JSON.parse(extracted.extractedContent)

    expect(extracted.changed).toBe(true)
    expect(extracted.section.path).toEqual(['第一卷', '第一章'])
    expect(source.root.children.some(node => (
      node.type === 'heading' &&
      node.children?.[0]?.text === '第一章'
    ))).toBe(false)
    expect(target.root.children.slice(0, 3).map(node => (
      node.type === 'heading' ? node.children[0].text : node.children[0]?.text
    ))).toEqual(['第一卷', '第一章', 'A'])
  })

  it('rewrites only references inside the extracted section path prefix', () => {
    const content = state([
      {
        type: 'paragraph',
        children: [
          {
            type: 'wiki-link',
            id: 'source-note',
            title: '正文',
            sectionPath: ['第一卷', '第一章'],
          },
          {
            type: 'wiki-link',
            id: 'source-note',
            title: '正文',
            sectionPath: ['第一卷', '第二章'],
          },
        ],
      },
    ])

    const rewritten = rewriteSectionTargetReferences(
      content,
      'source-note',
      ['第一卷', '第一章'],
      'new-note',
      '第一章',
    )
    const next = JSON.parse(rewritten.content)
    const links = next.root.children[0].children

    expect(rewritten.rewrittenCount).toBe(1)
    expect(links[0]).toMatchObject({
      id: 'new-note',
      title: '第一章',
      sectionPath: ['第一卷', '第一章'],
    })
    expect(links[1]).toMatchObject({
      id: 'source-note',
      title: '正文',
      sectionPath: ['第一卷', '第二章'],
    })
  })

  it('plans cross-note extraction impact for the selected section and descendants', () => {
    const source = {
      id: 'story',
      title: '正文',
      content: state([]),
    }
    const refs = {
      id: 'notes',
      title: '设定',
      content: state([
        {
          type: 'paragraph',
          children: [
            {
              type: 'wiki-link',
              id: 'story',
              title: '正文',
              sectionPath: ['第一卷', '第一章'],
            },
            {
              type: 'wiki-link',
              id: 'story',
              title: '正文',
              sectionPath: ['第一卷', '第一章', '第一场'],
            },
            {
              type: 'wiki-link',
              id: 'story',
              title: '正文',
              sectionPath: ['第一卷', '第二章'],
            },
          ],
        },
      ]),
    }

    const plan = planSectionExtractionImpact(
      [source, refs],
      'story',
      ['第一卷', '第一章'],
      '第一章',
    )

    expect(plan.summary).toEqual({
      incomingReferences: 2,
      affectedFiles: 1,
      repairable: 2,
      broken: 0,
    })
    expect(plan.sources[0].changes).toHaveLength(2)
    expect(plan.sources[0].changes[0]).toMatchObject({
      before: '[[正文#第一卷 › 第一章]]',
      after: '[[第一章#第一卷 › 第一章]]',
    })
  })
})
