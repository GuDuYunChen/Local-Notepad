import assert from 'node:assert/strict'
import { offlinePairViewDescription as describe } from '../src/services/s3OfflinePairViewDescription.mjs'
export function registerViewDescriptionTests(test) {
  test('offline view description defaults to a complete canonical view', () => assert.equal(describe(), '全部 12 项 · 原始顺序'))
  test('offline view description ignores inactive filter and sort values', () => assert.equal(describe(false, 'decrease', 'bytes', 'largest'), describe()))
  for (const [scope, unit] of [['all', '全部指标'], ['counts', '仅数量（项）'], ['bytes', '仅容量（B）']]) {
    test(`offline view description covers every direction and order for ${scope}`, () => {
      for (const [direction,label] of [['all','全部差异'],['increase','仅增加'],['decrease','仅减少']])
        for (const [order,ranking] of [['original','原始顺序'],['largest','幅度从大到小'],['smallest','幅度从小到大']])
          assert.equal(describe(true,direction,scope,order), `仅差异 · ${unit} · ${label} · ${scope === 'all' ? '原始顺序' : ranking}`)
    })
  }
  for (const [label,args] of [['boolean',[1]],['direction',[true,'bad']],['scope',[true,'all','bad']],['order',[true,'all','all','bad']],['inherited key',[true,'toString']]])
    test(`offline view description rejects invalid ${label} without echoing it`, () => assert.throws(() => describe(...args), {message:'无效的比较视图。'}))
  test('offline view description never presents mixed-unit magnitude ordering', () => assert.equal(describe(true,'all','all','largest'), describe(true)))
  test('offline view description does not equate metric directions with changed notes', () => assert.doesNotMatch(describe(true,'increase','counts','largest'), /笔记|时间|相同/))
}
