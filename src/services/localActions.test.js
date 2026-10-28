import { describe, expect, it, vi } from 'vitest'
import { LOCAL_ACTIONS, LOCAL_ACTION_CATEGORIES, filterLocalActions, findLocalAction, executeLocalAction } from './localActions.mjs'

describe('local-only registry and literal bounded search', () => {
  it('has unique immutable actions and only existing destinations', () => {
    expect(LOCAL_ACTIONS).toHaveLength(17)
    expect(new Set(LOCAL_ACTIONS.map(x => x.id)).size).toBe(17)
    expect(Object.isFrozen(LOCAL_ACTIONS)).toBe(true)
    for (const a of LOCAL_ACTIONS) { expect(Object.isFrozen(a)).toBe(true); expect(LOCAL_ACTION_CATEGORIES).toContain(a.category); expect(['workspace','overlay','settings']).toContain(a.kind); expect(a.target).toMatch(/^[A-Za-z]+$/) }
  })
  it('supports Chinese, normalized English, multiple literal tokens and category', () => {
    expect(filterLocalActions('ＴＡＳＫ')).toEqual([findLocalAction('tasks')])
    expect(filterLocalActions('备份')).toEqual([findLocalAction('backup')])
    expect(filterLocalActions('local')).toEqual([])
    expect(filterLocalActions('   search find   ')).toEqual([findLocalAction('globalSearch')])
    expect(filterLocalActions('','设置').length).toBe(3)
    expect(filterLocalActions('附件','写作')).toEqual([])
    expect(filterLocalActions('.*')).toEqual([])
  })
  it.each([null,{},42,'x'.repeat(101)])('refuses malformed or unbounded query %j', q => expect(filterLocalActions(q)).toEqual([]))
  it('rejects unknown IDs and categories without interpreting a script or URL', async () => {
    expect(filterLocalActions('','remote')).toEqual([])
    expect(findLocalAction('__proto__')).toBe(null)
    await expect(executeLocalAction('https://example.invalid')).rejects.toThrow('列表')
  })
})
describe('original-entry dispatch without mutation/replay', () => {
  for (const a of LOCAL_ACTIONS) it(`dispatches ${a.id} once to its registered owner`, async () => {
    const navigate=vi.fn((_,o)=>{expect(o.shouldChange()).toBe(true);o.afterChange()}),openOverlay=vi.fn(),openSettingsTool=vi.fn()
    expect(await executeLocalAction(a.id,{navigate,openOverlay,openSettingsTool})).toEqual({accepted:true,id:a.id})
    if(a.kind==='overlay'){expect(openOverlay).toHaveBeenCalledTimes(1);expect(openOverlay).toHaveBeenCalledWith(a.target);expect(navigate).not.toHaveBeenCalled()}
    else expect(navigate).toHaveBeenCalledTimes(1)
    if(a.kind==='settings'){expect(openSettingsTool).toHaveBeenCalledTimes(1);expect(openSettingsTool).toHaveBeenCalledWith(a.target)}else expect(openSettingsTool).not.toHaveBeenCalled()
  })
  it('waits for save/accept and does not launch a child on cancellation', async () => {
    let owner;const openSettingsTool=vi.fn(),run=executeLocalAction('tasks',{navigate:(_,o)=>{owner=o},openSettingsTool})
    expect(openSettingsTool).not.toHaveBeenCalled();owner.onCancel()
    expect(await run).toEqual({accepted:false,reason:'cancelled'});owner.afterChange();expect(openSettingsTool).not.toHaveBeenCalled()
  })
  it('cancels pending navigation and ignores late acceptance or repeated callbacks', async () => {
    const controller=new AbortController();let owner;const launch=vi.fn()
    const run=executeLocalAction('tasks',{signal:controller.signal,navigate:(_,o)=>{owner=o},openSettingsTool:launch});controller.abort()
    expect(owner.shouldChange()).toBe(false);owner.afterChange();owner.afterChange()
    expect((await run).accepted).toBe(false);expect(launch).not.toHaveBeenCalled()
  })
  it('does not navigate an already cancelled invocation', async () => {const c=new AbortController();c.abort();const navigate=vi.fn();expect((await executeLocalAction('notes',{signal:c.signal,navigate})).accepted).toBe(false);expect(navigate).not.toHaveBeenCalled()})
  it('refuses a changed owner before handing off a settings child', async () => {let current=true,owner;const launch=vi.fn(),run=executeLocalAction('tasks',{isCurrent:()=>current,navigate:(_,o)=>{owner=o},openSettingsTool:launch});current=false;owner.afterChange();expect((await run).accepted).toBe(false);expect(launch).not.toHaveBeenCalled()})
  it('reports active focus session as a cancellation, not success', async () => {expect(await executeLocalAction('daily',{navigate:(_,o)=>o.onCancel('focus-session')})).toEqual({accepted:false,reason:'focus-session'})})
  it('does not navigate before checking the required settings entry', async () => {const navigate=vi.fn();await expect(executeLocalAction('tasks',{navigate})).rejects.toThrow();expect(navigate).not.toHaveBeenCalled()})
  it('propagates entry failure without automatic repeat', async () => {const openOverlay=vi.fn(()=>{throw Error('unavailable')});await expect(executeLocalAction('backup',{openOverlay})).rejects.toThrow('unavailable');expect(openOverlay).toHaveBeenCalledTimes(1)})
})
