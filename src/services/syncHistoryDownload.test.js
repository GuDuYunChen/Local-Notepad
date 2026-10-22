import { it, expect, vi, afterEach } from 'vitest'
import { requestHistoryDownload } from './syncHistoryExport.mjs'
const prepared={raw:'{"format":"fixture"}\n',filename:'history.json'}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers()})
it('requests the exact UTF-8 JSON file, removes the link and revokes the object URL',async()=>{
 vi.useFakeTimers();let blob
 vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{blob=b;return 'blob:fixture'})
 const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){expect(this.download).toBe('history.json');expect(this.href).toBe('blob:fixture');expect(this.isConnected).toBe(true)})
 expect(requestHistoryDownload(prepared)).toBe('history.json');expect(click).toHaveBeenCalledTimes(1)
 expect(blob.type).toBe('application/json;charset=utf-8');expect(await blob.text()).toBe(prepared.raw)
 expect(document.querySelector('a[download]')).toBeNull();vi.advanceTimersByTime(1000);expect(revoke).toHaveBeenCalledWith('blob:fixture')
})
it('cleans up the link and object URL when request dispatch fails',()=>{
 vi.useFakeTimers();vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:failed')
 const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{throw Error('failed')})
 expect(()=>requestHistoryDownload(prepared)).toThrow('failed');expect(document.querySelector('a[download]')).toBeNull()
 vi.advanceTimersByTime(1000);expect(revoke).toHaveBeenCalledWith('blob:failed')
})
it('does not leave a download link when object URL creation fails',()=>{
 vi.spyOn(URL,'createObjectURL').mockImplementation(()=>{throw Error('quota')})
 expect(()=>requestHistoryDownload(prepared)).toThrow('quota');expect(document.querySelector('a[download]')).toBeNull()
})
