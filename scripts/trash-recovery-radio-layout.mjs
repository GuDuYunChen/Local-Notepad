import assert from 'node:assert/strict'
// Actual browser geometry, not a DOM-fixture claim. Only scrolling is allowed;
// selection, styles, animation, viewport, and application state are not changed.
export function observeRecoveryDestinationLayout(){
 const scope=document.querySelector('.trash-recovery-destination'),scroll=document.querySelector('.trash-recovery-scroll')
 if(!scope||!scroll)return null
 scope.scrollIntoView({block:'center',inline:'nearest'})
 const area=scroll.getBoundingClientRect(),inputs=[...scope.querySelectorAll('input[type=radio]')]
 if(inputs.length!==2)return null
 const rect=n=>{const b=n.getBoundingClientRect();return{left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height}}
 const rows=inputs.map(input=>{
  const label=input.closest('label'),walker=document.createTreeWalker(label,NodeFilter.SHOW_TEXT);let textNode
  while(walker.nextNode())if(walker.currentNode.textContent.trim()){textNode=walker.currentNode;break}
  if(!textNode)return null
  const range=document.createRange();range.selectNodeContents(textNode)
  const marker=rect(input),text=rect(range),css=getComputedStyle(input)
  const hit=(n,b)=>n.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2))
  const visible=b=>b.width>0&&b.height>0&&b.left>=Math.max(0,area.left)&&b.right<=Math.min(innerWidth,area.right)&&b.top>=Math.max(0,area.top)&&b.bottom<=Math.min(innerHeight,area.bottom)
  return{label:label.textContent.trim(),checked:input.checked,marker,text,padding:css.padding,flexGrow:css.flexGrow,hit:hit(label,marker)&&hit(label,text),visible:visible(marker)&&visible(text)}
 })
 if(rows.some(row=>!row||!row.visible||!row.hit))return null
 return{width:innerWidth,height:innerHeight,rows}
}
export function verifyRecoveryDestinationLayouts(report){
 const values=report.destinationLayouts
 assert.deepEqual(Object.keys(values||{}).sort(),['normalOriginal','normalTarget','smallOriginal','smallTarget'].sort())
 for(const[name,value]of Object.entries(values)){
  assert.ok(Number.isFinite(value.width)&&Number.isFinite(value.height)&&value.width>0&&value.height>0)
  if(name.startsWith('small'))assert.ok(value.width<=720&&value.height<=520,'Not the actual minimum window')
  else assert.ok(value.width>720,'Normal window not observed')
  assert.equal(value.rows.length,2)
  for(const[i,row]of value.rows.entries()){
   assert.equal(row.label,['各自原位置','指定现存目录'][i]);assert.equal(row.checked,name.endsWith('Original')?i===0:i===1)
   assert.equal(row.visible,true);assert.equal(row.hit,true);assert.equal(row.padding,'0px');assert.equal(row.flexGrow,'0')
   for(const key of ['left','top','right','bottom','width','height'])assert.ok(Number.isFinite(row.marker[key])&&Number.isFinite(row.text[key]))
   for(const box of [row.marker,row.text]){assert.ok(box.left>=0&&box.top>=0&&box.right<=value.width&&box.bottom<=value.height);assert.ok(box.width>0&&box.height>0);assert.ok(Math.abs(box.right-box.left-box.width)<0.1&&Math.abs(box.bottom-box.top-box.height)<0.1)}
   assert.ok(row.marker.width>=12&&row.marker.width<=20&&row.marker.height>=12&&row.marker.height<=20,'Stretched radio')
   const gap=row.text.left-row.marker.right,dy=Math.abs((row.text.top+row.text.bottom-row.marker.top-row.marker.bottom)/2)
   assert.ok(gap>=6&&gap<=12,'Radio separated from its own label');assert.ok(dy<=4,'Radio/text vertical alignment')
  }
 }
 return true
}
