import {test,expect} from 'vitest'
import {createEditor,$getRoot,$createParagraphNode,$createTextNode} from 'lexical'
import {findTextMatchOffsets,$findAllSearchMatches} from './SearchPlugin'
test('case folding uses original offsets even after dotted-I',()=>expect(findTextMatchOffsets('İx AB','ab')).toEqual([3]))
test('whole word respects a preceding supplementary Unicode letter',()=>expect(findTextMatchOffsets('𐐀cat cat','cat',{wholeWord:true})).toEqual([6]))
test('a literal match can cross bold text leaves within one paragraph',()=>{
 const editor=createEditor({namespace:'search-negative',onError:e=>{throw e}});let count
 editor.update(()=>{const a=$createTextNode('al'),b=$createTextNode('pha');b.toggleFormat('bold');$getRoot().clear().append($createParagraphNode().append(a,b));count=$findAllSearchMatches('alpha').length},{discrete:true})
 expect(count).toBe(1)
})
