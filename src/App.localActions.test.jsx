import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { api } from './services/api'
const fixture=vi.hoisted(()=>({select:null,clear:vi.fn(),save:vi.fn()}))
vi.mock('./services/api',()=>({api:vi.fn(),searchFiles:vi.fn().mockResolvedValue([]),createFileVersionSnapshot:vi.fn(),listAllFilesWithContent:vi.fn()}))
vi.mock('./components/FileList',()=>({default:({onSelect})=>{fixture.select=onSelect;return null}}))
vi.mock('./components/LibraryReferenceHealthPanel',()=>({default:()=>null}))
vi.mock('./components/SyncCenterPanel',()=>({default:()=>null}))
vi.mock('./components/S3ReadInspectionPanel',()=>({default:()=>null}))
vi.mock('./components/S3LocalOverviewPanel',()=>({default:()=>null}))
vi.mock('./components/DailyNotesPanel',()=>({default:()=> <div data-daily-target>每日笔记原入口</div>}))
// Only source reads and editor persistence are isolated; App, Sidebar,
// LocalActions, Settings and the original unsaved decision remain real.
vi.mock('./components/TextEditor',()=>({default:React.forwardRef(function EditorFixture({activeId,onLoaded,onChange,onStatusChange},ref){
 const [draft,setDraft]=React.useState('原正文')
 React.useEffect(()=>{if(activeId){onLoaded?.('原正文');onStatusChange?.({dirty:false})}},[activeId])
 React.useImperativeHandle(ref,()=>({clearCache:fixture.clear,save:fixture.save,getReferenceRefactorState:()=>({savedContent:'原正文',currentContent:draft})}))
 return activeId?<button onClick={()=>{setDraft('未保存草稿');onChange('未保存草稿');onStatusChange?.({dirty:true})}}>编辑正文</button>:null
})}))
let host,root
const settle=async()=>{await act(async()=>vi.dynamicImportSettled());await act(async()=>vi.advanceTimersByTimeAsync(100))}
const button=text=>[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===text||n.getAttribute('aria-label')===text)
const click=async text=>{expect(button(text),text).toBeTruthy();await act(async()=>{button(text).focus();button(text).click()});await settle()}
const action=async id=>{await act(async()=>host.querySelector('[data-local-action='+id+']').click());await settle()}
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();localStorage.clear();fixture.clear.mockReset().mockReturnValue(true);fixture.save.mockReset().mockResolvedValue(null)
 api.mockReset().mockImplementation(async p=>p==='/api/diagnostics'?{status:'ok',integrity:'ok'}:p==='/api/settings'?{theme:'light'}:p==='/api/files?size=200'?[]:{})
 host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<App/>));await settle();await act(async()=>fixture.select({id:'source',title:'当前笔记.md',content:'原正文'}));await settle()
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear()})
it('has a real persistent sidebar entry in both expanded and collapsed states',async()=>{await click('打开快捷操作');expect(host.querySelector('.local-actions')).not.toBeNull();await click('关闭快捷操作');await click('折叠侧边栏');await click('打开快捷操作');expect(host.querySelectorAll('[data-local-action]')).toHaveLength(17);expect(fixture.clear).not.toHaveBeenCalled();expect(fixture.save).not.toHaveBeenCalled()})
it('same-workspace return closes only the palette and preserves unsaved content',async()=>{await click('编辑正文');await click('打开快捷操作');await action('notes');expect(host.querySelector('.local-actions')).toBeNull();expect(host.querySelector('.workspace-save-chip').textContent).toBe('未保存');expect(fixture.clear).not.toHaveBeenCalled()})
it('workspace navigation waits for original save/discard/cancel; cancel keeps draft and palette',async()=>{await click('编辑正文');await click('打开快捷操作');await action('daily');expect(host.querySelector('.modal-title').textContent).toBe('当前笔记未保存');expect(host.querySelector('[data-daily-target]')).toBeNull();await click('取消');expect(host.querySelector('.local-actions')).not.toBeNull();expect(host.querySelector('.local-actions [role=status]').textContent).toContain('保持不变');expect(host.querySelector('.workspace-save-chip').textContent).toBe('未保存');expect(fixture.clear).not.toHaveBeenCalled();expect(fixture.save).not.toHaveBeenCalled()})
it('explicit discard uses original clearCache and reaches the existing workspace',async()=>{await click('编辑正文');await click('打开快捷操作');await action('daily');await click('不保存');expect(fixture.clear).toHaveBeenCalledTimes(1);expect(host.querySelector('[data-daily-target]')).not.toBeNull();expect(host.querySelector('.local-actions')).toBeNull()})
it('failed original cache discard does not navigate or report acceptance',async()=>{fixture.clear.mockReturnValue(false);await click('编辑正文');await click('打开快捷操作');await action('daily');await click('不保存');expect(host.querySelector('[data-daily-target]')).toBeNull();expect(host.querySelector('.local-actions')).not.toBeNull();expect(host.querySelector('.modal-title').textContent).toBe('当前笔记未保存')})
it('closing a pending palette invalidates the original discard decision',async()=>{await click('编辑正文');await click('打开快捷操作');await action('daily');await click('关闭快捷操作');await click('不保存');expect(fixture.clear).not.toHaveBeenCalled();expect(host.querySelector('[data-daily-target]')).toBeNull();expect(host.querySelector('.workspace-save-chip').textContent).toBe('未保存')})
it('a failed/uncertain original save keeps both destination and draft guarded',async()=>{fixture.save.mockResolvedValue(null);await click('编辑正文');await click('打开快捷操作');await action('daily');await click('保存');expect(fixture.save).toHaveBeenCalledTimes(1);expect(host.querySelector('[data-daily-target]')).toBeNull();expect(host.querySelector('.local-actions')).not.toBeNull()})
it('opens the real settings task panel and does not reopen it on close',async()=>{await click('打开快捷操作');await action('tasks');expect(document.querySelector('.task-center'), 'tasks must mount '+host.textContent.slice(-1300)).not.toBeNull();expect(host.querySelector('.local-actions')).toBeNull();await click('关闭待办任务中心');expect(document.querySelector('.task-center')).toBeNull();await click('打开快捷操作');await action('appearance');expect(document.querySelector('.appearance-center'), 'appearance must mount '+host.textContent.slice(-1300)).not.toBeNull();expect(api.mock.calls.some(([,init])=>init?.method==='PUT')).toBe(false)})
it('global shortcut management opens through its existing owner without clearing a draft',async()=>{await click('编辑正文');await click('打开快捷操作');await action('shortcuts');expect(host.querySelector('[data-shortcut-settings]')).not.toBeNull();expect(host.querySelector('.local-actions')).toBeNull();expect(fixture.clear).not.toHaveBeenCalled();expect(fixture.save).not.toHaveBeenCalled()})
it('accepted original save is the only path to the requested destination',async()=>{fixture.save.mockResolvedValue({id:'source',content:'未保存草稿'});await click('编辑正文');await click('打开快捷操作');await action('daily');await click('保存');expect(fixture.save).toHaveBeenCalledTimes(1);expect(fixture.clear).not.toHaveBeenCalled();expect(host.querySelector('[data-daily-target]')).not.toBeNull();expect(host.querySelector('.local-actions')).toBeNull()})
it('cannot discard after a different workspace invalidated the invocation',async()=>{await click('编辑正文');await click('打开快捷操作');await action('daily');await act(async()=>fixture.select({id:'external',title:'新来源.md',content:'另一正文'},{skipSave:true}));await settle();await click('不保存');expect(fixture.clear).not.toHaveBeenCalled();expect(host.querySelector('[data-daily-target]')).toBeNull()})

// Native81: a browser event may commit the changed workspace before the async
// promise continuation runs. Async act alone hid this ordering in old tests.
it.each(['daily','tasks'])('acknowledges owned %s navigation before its synchronous React commit',async id=>{
 await click('打开快捷操作')
 act(()=>flushSync(()=>host.querySelector('[data-local-action='+id+']').click()))
 await settle()
 expect(host.querySelector('.local-actions')).toBeNull()
 expect(document.querySelector(id==='daily'?'[data-daily-target]':'.task-center')).not.toBeNull()
 expect(fixture.save).not.toHaveBeenCalled();expect(fixture.clear).not.toHaveBeenCalled()
})
it('does not call a successful original discard an external context change',async()=>{
 await click('编辑正文');await click('打开快捷操作');await action('daily')
 act(()=>flushSync(()=>button('不保存').click()));await settle()
 expect(fixture.clear).toHaveBeenCalledTimes(1)
 expect(host.querySelector('[data-daily-target]')).not.toBeNull()
 expect(host.querySelector('.local-actions')).toBeNull()
})
