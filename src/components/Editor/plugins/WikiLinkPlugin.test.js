import { describe, expect, it } from 'vitest'
import { matchWikiQuery } from './WikiLinkPlugin'

describe('WikiLink query parsing', () => {
  it('parses ordinary note queries', () => {
    expect(matchWikiQuery('前文 [[设定', '前文 [[设定'.length)).toMatchObject({
      query: '设定',
      noteQuery: '设定',
      sectionQuery: '',
      hasSectionQuery: false,
    })
  })

  it('splits note and section queries on the first hash', () => {
    expect(matchWikiQuery('[[设定集#青莲剑宗', '[[设定集#青莲剑宗'.length)).toMatchObject({
      query: '设定集#青莲剑宗',
      noteQuery: '设定集',
      sectionQuery: '青莲剑宗',
      hasSectionQuery: true,
    })
  })

  it('supports browsing all sections after a note hash', () => {
    expect(matchWikiQuery('[[设定集#', '[[设定集#'.length)).toMatchObject({
      noteQuery: '设定集',
      sectionQuery: '',
      hasSectionQuery: true,
    })
  })

  it('does not cross a closed bracket or newline', () => {
    expect(matchWikiQuery('[[设定]] 后文', '[[设定]] 后文'.length)).toBeNull()
    expect(matchWikiQuery('[[设定\n下一行', '[[设定\n下一行'.length)).toBeNull()
  })
})
