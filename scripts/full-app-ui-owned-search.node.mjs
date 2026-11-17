import assert from 'node:assert/strict'
import test from 'node:test'
import { exactTitleSearchResultIndex } from './full-app-ui-owned-search.mjs'

test('a legitimate body-text match does not hide the uniquely owned exact title', () => {
  assert.equal(exactTitleSearchResultIndex(['EDITOR-1 引用来源', 'EDITOR-1 基本编辑正文'], 'EDITOR-1 基本编辑正文'), 1)
  assert.equal(exactTitleSearchResultIndex(['EDITOR-1 基本编辑正文', 'EDITOR-1 引用来源'], 'EDITOR-1 基本编辑正文'), 0)
})
test('duplicate exact titles remain ambiguous even with other results', () => {
  assert.equal(exactTitleSearchResultIndex(['EDITOR-1 基本编辑正文', '引用来源', 'EDITOR-1 基本编辑正文'], 'EDITOR-1 基本编辑正文'), -1)
})
test('missing title, lookalike prefix, or missing title nodes cannot pass', () => {
  assert.equal(exactTitleSearchResultIndex(['EDITOR-1 基本编辑正文 2', '引用来源', null], 'EDITOR-1 基本编辑正文'), -1)
  assert.equal(exactTitleSearchResultIndex([], 'EDITOR-1 基本编辑正文'), -1)
})
