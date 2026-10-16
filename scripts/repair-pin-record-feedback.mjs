// Keep the operation-record conflict visible after refreshing corrupt-record status.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const path='src/components/PinnedNotesPanel.jsx',source=readFileSync(path,'utf8')
assert.equal(createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0').update(source).digest('hex'),'ad26a2730424a77e278008424bb000aa6cdd42a5')
const before='    catch(e){setError(e.message);refreshPending();setReviewed(false)}'
const after='    catch(e){refreshPending();setError(e.message);setReviewed(false)}'
assert.equal(source.split(before).length,2)
writeFileSync(path,source.replace(before,after))
