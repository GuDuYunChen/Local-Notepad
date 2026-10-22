import React,{act,useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {LexicalComposer} from '@lexical/react/LexicalComposer'
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext'
import {RichTextPlugin} from '@lexical/react/LexicalRichTextPlugin'
import {ContentEditable} from '@lexical/react/LexicalContentEditable'
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary'
import {$getRoot,$createTextNode,$createParagraphNode} from 'lexical'
import {HeadingNode,$createHeadingNode} from '@lexical/rich-text'
import DocumentOutlinePlugin from './DocumentOutlinePlugin'
import {beginEvidenceContentLoad,completeEvidenceContentLoad,cancelEvidenceContentLoad} from '~/services/evidenceNavigation'
let host,root,editor,errors,scrolls,frames,nextFrame
function Capture(){const [e]=useLexicalComposerContext();useEffect(()=>{editor=e},[e]);return null}
function Harness({id='A',requireLoaded=false}) {return <LexicalComposer initialConfig={{namespace:'outline-real',nodes:[HeadingNode],onError:e=>errors.push(e)}}><div className="editor-shell"><DocumentOutlinePlugin documentId={id} documentTitle={'笔记'+id} initialContent={id} requireLoaded={requireLoaded}/><div className="editor-container"><RichTextPlugin contentEditable={<ContentEditable className="editor-input"/>} placeholder={null} ErrorBoundary={LexicalErrorBoundary}/><Capture/></div></div></LexicalComposer>}
const flush=async()=>act(async()=>{for(let i=0;i<12;i++)await Promise.resolve()})
async function render(props={}){await act(async()=>root.render(<Harness {...props}/>));await flush()}
async function seed(rows=[['h1','卷一'],['p','第一段正文'],['h2','章节甲'],['p','章节甲正文'],['h2','章节乙'],['p','章节乙正文'],['h1','卷二'],['p','卷二正文']]){await act(async()=>editor.update(()=>{$getRoot().clear();for(const[tag,text]of rows)$getRoot().append((tag==='p'?$createParagraphNode():$createHeadingNode(tag)).append($createTextNode(text)))},{discrete:true}));await flush()}
async function tick(){await act(async()=>{for(let pass=0;pass<4;pass++){const current=[...frames.values()];frames.clear();for(const fn of current)fn();await Promise.resolve()}});await flush()}
const button=label=>[...host.querySelectorAll('button')].find(n=>n.textContent===label||n.getAttribute('aria-label')===label)
async function click(label){expect(button(label),'Missing '+label).toBeTruthy();await act(async()=>button(label).click());await flush()}
async function field(value){await act(async()=>{const n=host.querySelector('[aria-label="查找章节"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}))});await flush()}
const serialized=()=>JSON.stringify(editor.getEditorState().toJSON())
async function start(){await render();await seed();await click('文档目录')}
beforeEach(()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;errors=[];scrolls=[];frames=new Map();nextFrame=0;localStorage.clear()
 vi.stubGlobal('requestAnimationFrame',fn=>{const id=++nextFrame;frames.set(id,fn);return id});vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id))
 vi.spyOn(HTMLElement.prototype,'scrollTo').mockImplementation(function(options){scrolls.push({element:this,top:options.top});this.scrollTop=options.top})
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(){let top=0;if(/^H[1-6]$/.test(this.tagName))top=200+[...document.querySelectorAll('.editor-input h1,.editor-input h2')].indexOf(this)*300;return {top,bottom:top+40,left:0,right:300,width:300,height:40,x:0,y:top}})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();delete globalThis.IS_REACT_ACT_ENVIRONMENT})
test('empty outline retains a usable entry and explanatory empty state',async()=>{await render();await seed([['p','没有标题']]);await click('文档目录');expect(host.textContent).toContain('当前正文没有标题');expect(errors).toEqual([])})
test('one heading supports a real outline and navigation without writing',async()=>{await render();await seed([['h1','唯一标题'],['p','正文']]);const before=serialized();await click('文档目录');await click('唯一标题');await tick();expect(host.textContent).toContain('已定位：唯一标题');expect(serialized()).toBe(before);expect(scrolls.some(s=>s.element.className==='editor-container')).toBe(true)})
test('shortcut and Escape open and close with trigger focus',async()=>{await render();await seed();await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'O',ctrlKey:true,shiftKey:true,cancelable:true})));await tick();expect(host.querySelector('[aria-label="查找章节"]')).toBeTruthy();await act(async()=>host.querySelector('[aria-label="查找章节"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));expect(host.querySelector('.document-outline-panel')).toBeNull();expect(document.activeElement).toBe(button('文档目录'))})
test('IME query is not applied until composition completes',async()=>{await start();const n=host.querySelector('input');await act(async()=>n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await field('不匹配');expect(host.querySelectorAll('.document-outline-row')).toHaveLength(4);await act(async()=>n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));expect(host.querySelectorAll('.document-outline-row')).toHaveLength(0);expect(host.textContent).toContain('没有匹配')})
test('search includes parent names and clears back to the full directory',async()=>{await start();const before=serialized();await field('卷一');expect(host.querySelectorAll('.document-outline-row')).toHaveLength(3);await field('[');expect(host.textContent).toContain('没有匹配');await field('');expect(host.querySelectorAll('.document-outline-row')).toHaveLength(4);expect(serialized()).toBe(before)})
test('folds preserve serialized body and search navigation reveals a hidden child',async()=>{await start();const before=serialized();await click('折叠章节：卷一');expect(host.querySelector('.editor-input h2').style.display).toBe('none');await field('章节甲');await click('章节甲');await tick();expect(host.querySelector('.editor-input h2').style.display).not.toBe('none');expect(serialized()).toBe(before)})
test('expand all restores section bodies without a text write',async()=>{await start();await click('折叠章节：卷一');await click('展开全部');expect([...host.querySelector('.editor-input').children].every(n=>n.style.display!=='none')).toBe(true)})
test('return restores the saved scroll origin once',async()=>{await start();const box=host.querySelector('.editor-container');box.scrollTop=43;await click('章节乙');await tick();await click('返回');expect(box.scrollTop).toBe(43);expect(button('返回').disabled).toBe(true)})
test('a queued heading jump cannot run after the document changes',async()=>{await start();await click('章节乙');scrolls.length=0;await seed([['h1','新版'],['p','正文']]);await tick();expect(scrolls.filter(s=>s.element.className==='editor-container')).toHaveLength(0);expect(host.textContent).not.toContain('已定位：章节乙')})
test('close cancels a pending navigation and old flash timers',async()=>{await start();await click('章节乙');await click('关闭文档目录');scrolls.length=0;await tick();expect(scrolls.filter(s=>s.element.className==='editor-container')).toHaveLength(0);expect(host.querySelector('.outline-target-flash')).toBeNull()})
test('same-composer document switch clears query folds return and pending navigation',async()=>{await start();await field('章节');await click('章节乙');await render({id:'B'});await seed([['h1','新笔记'],['p','B正文']]);scrolls.length=0;await tick();expect(host.querySelector('.document-outline-panel')).toBeNull();await click('文档目录');expect(host.querySelector('input').value).toBe('');expect(button('返回').disabled).toBe(true);expect(host.textContent).not.toContain('章节乙');expect(scrolls.filter(s=>s.element.className==='editor-container')).toHaveLength(0)})
test('old root display overrides are restored on unmount',async()=>{await start();await click('折叠章节：卷一');const el=host.querySelector('.editor-input h2');expect(el.style.display).toBe('none');await act(async()=>root.render(null));expect(el.style.display).toBe('')})
test('readiness refuses old content until the exact document load is complete',async()=>{await render({requireLoaded:true});await seed();await click('文档目录');expect(host.textContent).toContain('正文正在加载');let token;await act(async()=>{token=beginEvidenceContentLoad(editor,'A','A');completeEvidenceContentLoad(editor,token)});await flush();expect(host.textContent).toContain('卷一');expect(host.textContent).not.toContain('正文正在加载')})
test('ambiguous anchors show a refusal but direct unique-key row navigation still works',async()=>{await render();await seed([['h1','相同'],['p','A'],['h1','相同'],['p','B']]);await act(async()=>window.dispatchEvent(new CustomEvent('editor:open-heading-anchor',{detail:{path:['相同']}})));await tick();expect(host.textContent).toContain('同名章节路径');expect(scrolls.filter(s=>s.element.className==='editor-container')).toHaveLength(0);await act(async()=>host.querySelectorAll('.document-outline-item')[1].click());await tick();expect(host.textContent).toContain('已定位：相同')})
test('events explicitly targeting another document are ignored',async()=>{await start();await act(async()=>window.dispatchEvent(new CustomEvent('editor:open-heading-anchor',{detail:{documentId:'B',path:['卷二']}})));await tick();expect(host.textContent).not.toContain('已定位：卷二')})
test('missing headings never fall back to a different heading',async()=>{await start();await act(async()=>window.dispatchEvent(new CustomEvent('editor:open-heading-anchor',{detail:{path:['不存在']}})));await tick();expect(host.textContent).toContain('未找到该章节');expect(scrolls.filter(s=>s.element.className==='editor-container')).toHaveLength(0)})
test('clipboard denial is visible and never changes the document',async()=>{await start();const before=serialized();vi.stubGlobal('navigator',{clipboard:{writeText:vi.fn(()=>Promise.reject(Error('denied')))}});await click('复制章节锚点：卷一');expect(host.textContent).toContain('复制未成功');expect(serialized()).toBe(before)})
test('clipboard success contains the exact encoded hierarchy',async()=>{await start();const write=vi.fn(async()=>{});vi.stubGlobal('navigator',{clipboard:{writeText:write}});await click('复制章节锚点：章节甲');expect(write).toHaveBeenCalledWith('#heading/'+encodeURIComponent('卷一')+'/'+encodeURIComponent('章节甲'));expect(host.textContent).toContain('章节锚点已复制')})
test('late clipboard completion after a note switch cannot report success or remember an old reference',async()=>{await start();let release;const write=vi.fn(()=>new Promise(r=>release=r));vi.stubGlobal('navigator',{clipboard:{writeText:write}});await act(async()=>window.dispatchEvent(new Event('editor:copy-current-reference')));await flush();await render({id:'B'});await seed([['h1','B标题']]);await act(async()=>release());await flush();expect(host.textContent).not.toContain('引用已复制');expect(localStorage.getItem('localNotepad.recentReferences.v1')).toBeNull()})
test('search reveals a collapsed section without editing body',async()=>{await start();await click('折叠章节：卷一');let key;editor.getEditorState().read(()=>key=$getRoot().getChildren()[3].getKey());const before=serialized();await act(async()=>window.dispatchEvent(new CustomEvent('editor:search-match',{detail:{documentId:'A',topLevelKey:key}})));expect(host.querySelectorAll('.editor-input p')[1].style.display).not.toBe('none');expect(serialized()).toBe(before)})
test('readonly editor supports navigation without entering editable state',async()=>{await start();editor.setEditable(false);const before=serialized();await click('章节甲');await tick();expect(editor.isEditable()).toBe(false);expect(serialized()).toBe(before)})
test('oversize query shows an explicit error and never navigates a truncated result',async()=>{await start();await field('X'.repeat(201));expect(host.textContent).toContain('最多 200');expect(host.querySelectorAll('.document-outline-item')).toHaveLength(0)})
test('over-budget outline reports an error and a later valid read recovers',async()=>{await render();await seed(Array.from({length:501},(_,i)=>['h1','H'+i]));await click('文档目录');expect(host.textContent).toContain('完整读取上限');await seed([['h1','恢复']]);expect(host.textContent).toContain('恢复');expect(host.textContent).not.toContain('完整读取上限')})

async function withHeadingReadiness(run,onReady=()=>{}) {
  const observations=[]
  const observe=event=>{
    observations.push({
      detail:event.detail,
      headings:[...host.querySelectorAll('.document-outline-item')].map(n=>n.textContent),
      bodyHeadings:[...host.querySelectorAll('.editor-input h1,.editor-input h2')].map(n=>n.textContent),
      count:button('文档目录')?.querySelector('span:last-child')?.textContent,
      loading:host.textContent.includes('正文正在加载'),
    })
    onReady(event)
  }
  window.addEventListener('editor:heading-navigation-ready',observe)
  try{await run(observations)}finally{window.removeEventListener('editor:heading-navigation-ready',observe)}
}
function LoadedOutlineHarness({showOutline=false}) {
  return <LexicalComposer initialConfig={{namespace:'outline-loaded-mount',nodes:[HeadingNode],onError:e=>errors.push(e)}}><div className="editor-shell">{showOutline&&<DocumentOutlinePlugin documentId="A" documentTitle="已加载笔记" initialContent="mounted-body" requireLoaded/>}<div className="editor-container"><RichTextPlugin contentEditable={<ContentEditable className="editor-input"/>} placeholder={null} ErrorBoundary={LexicalErrorBoundary}/><Capture/></div></div></LexicalComposer>
}

test('heading readiness waits for the exact body and committed outline before original navigation',async()=>{
  await withHeadingReadiness(async observations=>{
    await render({requireLoaded:true});await seed();await click('文档目录')
    const before=serialized(),token=beginEvidenceContentLoad(editor,'A','A')
    await tick()
    expect(observations).toEqual([])
    expect(host.textContent).toContain('正文正在加载')
    await act(async()=>{
      completeEvidenceContentLoad(editor,token)
      expect(observations).toEqual([])
      expect(host.querySelectorAll('.document-outline-item')).toHaveLength(0)
      expect(host.textContent).toContain('正文正在加载')
    })
    await flush()
    expect(observations).toEqual([{detail:{documentId:'A',content:'A'},headings:['卷一','章节甲','章节乙','卷二'],bodyHeadings:['卷一','章节甲','章节乙','卷二'],count:'4',loading:false}])
    expect(host.textContent).not.toContain('已定位：章节乙')
    await tick()
    expect(host.textContent).toContain('已定位：章节乙')
    expect(scrolls.some(s=>s.element.className==='editor-container')).toBe(true)
    expect(serialized()).toBe(before)
    expect(errors).toEqual([])
  },event=>window.dispatchEvent(new CustomEvent('editor:open-heading-anchor',{detail:{documentId:event.detail.documentId,path:['卷一','章节乙']}})))
})

test('an outline mounted after body readiness signals its committed heading count',async()=>{
  await withHeadingReadiness(async observations=>{
    await act(async()=>root.render(<LoadedOutlineHarness/>));await flush()
    await seed([['h1','预先加载章节'],['p','已加载正文']])
    const loadedEditor=editor,token=beginEvidenceContentLoad(editor,'A','mounted-body')
    await act(async()=>completeEvidenceContentLoad(editor,token))
    expect(observations).toEqual([])
    expect(host.querySelector('.document-outline')).toBeNull()
    await act(async()=>root.render(<LoadedOutlineHarness showOutline/>));await flush()
    expect(editor).toBe(loadedEditor)
    expect(observations).toEqual([{detail:{documentId:'A',content:'mounted-body'},headings:[],bodyHeadings:['预先加载章节'],count:'1',loading:false}])
    await click('文档目录')
    expect([...host.querySelectorAll('.document-outline-item')].map(n=>n.textContent)).toEqual(['预先加载章节'])
    expect(observations).toHaveLength(1)
    expect(errors).toEqual([])
  })
})

test('invalidated or mismatched content cannot publish a pending heading readiness signal',async()=>{
  await withHeadingReadiness(async observations=>{
    await render({requireLoaded:true});await seed();await click('文档目录')
    const stale=beginEvidenceContentLoad(editor,'A','A')
    await act(async()=>{
      completeEvidenceContentLoad(editor,stale)
      cancelEvidenceContentLoad(editor,stale)
      expect(observations).toEqual([])
    })
    await flush()
    expect(observations).toEqual([])
    await act(async()=>completeEvidenceContentLoad(editor,stale));await flush()
    const mismatched=beginEvidenceContentLoad(editor,'A','different-content')
    await act(async()=>completeEvidenceContentLoad(editor,mismatched));await flush()
    expect(observations).toEqual([])
    expect(host.textContent).toContain('正文正在加载')
    const current=beginEvidenceContentLoad(editor,'A','A')
    await seed([['h1','恢复章节'],['p','最新正文']])
    await act(async()=>{
      completeEvidenceContentLoad(editor,current)
      expect(observations).toEqual([])
    })
    await flush()
    expect(observations).toEqual([{detail:{documentId:'A',content:'A'},headings:['恢复章节'],bodyHeadings:['恢复章节'],count:'1',loading:false}])
    expect(errors).toEqual([])
  })
})

test('a same-composer document switch discards the old uncommitted heading readiness',async()=>{
  await withHeadingReadiness(async observations=>{
    await render({requireLoaded:true});await seed();await click('文档目录')
    const previousEditor=editor,stale=beginEvidenceContentLoad(editor,'A','A')
    await act(async()=>{
      completeEvidenceContentLoad(editor,stale)
      root.render(<Harness id="B" requireLoaded/>)
      expect(observations).toEqual([])
    })
    await flush()
    expect(editor).toBe(previousEditor)
    expect(observations).toEqual([])
    await seed([['h1','B标题'],['p','B正文']]);await click('文档目录')
    await act(async()=>completeEvidenceContentLoad(editor,stale));await flush()
    expect(observations).toEqual([])
    expect(host.textContent).toContain('正文正在加载')
    const current=beginEvidenceContentLoad(editor,'B','B')
    await act(async()=>{
      completeEvidenceContentLoad(editor,current)
      expect(observations).toEqual([])
    })
    await flush()
    expect(observations).toEqual([{detail:{documentId:'B',content:'B'},headings:['B标题'],bodyHeadings:['B标题'],count:'1',loading:false}])
    expect(host.textContent).not.toContain('卷一')
    expect(errors).toEqual([])
  })
})
