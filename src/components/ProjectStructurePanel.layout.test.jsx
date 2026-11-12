import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('project storyline chapter cards retain their open action and declare content layout', () => {
  const source = readFileSync(process.cwd() + '/src/components/ProjectStructurePanel.jsx', 'utf8')
  const start = source.indexOf('<div className="project-story-track">')
  const end = source.indexOf('{!volume.chapters.length', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const track = source.slice(start, end)
  expect(track).toMatch(/<UiButton\s+key=\{chapter\.id\}\s+type="button"\s+layout="content"/)
  expect(track).toMatch(/className=\{[\s\S]*?'project-story-node status-'\s*\+\s*chapter\.status/)
  expect(track).toMatch(/onClick=\{\(\) => onOpenFile\?\.\(chapter\.id\)\}/)
  expect(track).toMatch(/<strong>\{stripExtension\(chapter\.title\)\}<\/strong>/)
  expect(track).toMatch(/\{detailMode && \(/)
  expect(track).toMatch(/\{chapter\.markers\.length > 0 && \(/)
  expect(track).toMatch(/\{\(storylineModel\.chapterEvents\[chapter\.id\] \|\| \[\]\)\.length > 0 && \(/)
})

test('the original rich story-card height and shared action-height contract remain separate', () => {
  const css = readFileSync(process.cwd() + '/src/components/ProjectStructurePanel.css', 'utf8')
  const match = css.match(/\.project-story-node\s*\{([^}]*)\}/)
  expect(match).not.toBeNull()
  expect(match[1]).toMatch(/min-height:\s*80px\s*;/)
  expect(match[1]).toMatch(/flex-direction:\s*column\s*;/)
  const control = readFileSync(process.cwd() + '/src/components/ui/ControlKit.jsx', 'utf8')
  expect(control).toMatch(/layout === 'content' \|\| structural \? 'content' : 'action'/)
})
