import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Script } from 'node:vm'
import { parse } from 'acorn'
import { actOnExportDirectory, createExportDirectorySession, validateExportDirectoryReadiness } from './local-export-directory-session.mjs'

// Pure protocol/driver contracts. No PowerShell, native UI or Windows process
// runs here. The retained native failure is a fixture, not a successful probe.
const sha256 = value => createHash('sha256').update(value).digest('hex')
const workerReplacements = [
  [
    "  public string buttonName; public int valueWrites; public int invocations; public int closePosts; public bool dialogClosed;",
    "  public string buttonName; public int valueWrites; public int invocations; public int closePosts; public bool dialogClosed; public bool controlsReady;"
  ],
  [
    "  public static ExportDialogResult Act(uint pid,long main,string executable,string action,string directory) {",
    "  static void RequireExpectedDialog(ExportDialogIdentity dialog,long expectedHandle,long[] expectedOwners) {\n    if(expectedHandle==0) {\n      if(expectedOwners!=null&&expectedOwners.Length!=0)throw new ArgumentException(\"INVALID_EXPECTED_DIALOG\");\n      return;\n    }\n    if(expectedHandle<0||dialog==null||dialog.handle!=expectedHandle||expectedOwners==null||\n      expectedOwners.Length==0||expectedOwners.Length>16||dialog.ownerChain.Count!=expectedOwners.Length)\n      throw new InvalidOperationException(\"DIRECTORY_DIALOG_CHANGED\");\n    for(int i=0;i<expectedOwners.Length;i++)if(expectedOwners[i]<=0||dialog.ownerChain[i]!=expectedOwners[i])\n      throw new InvalidOperationException(\"DIRECTORY_DIALOG_CHANGED\");\n  }\n  public static ExportDialogResult InspectChoice(uint pid,long main,string executable,long expectedHandle,long[] expectedOwners) {\n    LastObservation=null;\n    var dialog=Find(pid,main,executable);RequireExpectedDialog(dialog,expectedHandle,expectedOwners);\n    if(dialog==null)return null;\n    var result=new ExportDialogResult {action=\"inspect-choice\",dialog=dialog};LastObservation=result;\n    var root=AutomationElement.FromHandle(new IntPtr(dialog.handle));\n    if(root==null||root.Current.ProcessId!=pid)throw new InvalidOperationException(\"UIA_ROOT_IDENTITY\");\n    var nodes=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);\n    if(nodes.Count>512)throw new InvalidOperationException(\"UIA_ELEMENT_LIMIT\");\n    var inputs=new List<AutomationElement>();var buttons=new List<AutomationElement>();\n    for(int i=0;i<nodes.Count;i++) {\n      var node=nodes[i];var value=node.Current;\n      if(value.ProcessId!=pid)throw new InvalidOperationException(\"UIA_FOREIGN_PROCESS\");\n      if(value.ControlType!=ControlType.Edit&&value.ControlType!=ControlType.Button)continue;\n      if(result.controls.Count>=128)throw new InvalidOperationException(\"UIA_CONTROL_LIMIT\");\n      result.controls.Add(new ExportDialogControl {id=value.AutomationId,name=value.Name,cls=value.ClassName,\n        type=value.ControlType.ProgrammaticName,enabled=value.IsEnabled,offscreen=value.IsOffscreen});\n      if(!value.IsEnabled||value.IsOffscreen)continue;\n      if(value.ControlType==ControlType.Button&&value.Name==\"选择此目录\")buttons.Add(node);\n      if(value.ControlType==ControlType.Edit&&(value.Name==\"Folder:\"||value.Name==\"文件夹:\"||value.Name==\"文件夹：\"))inputs.Add(node);\n    }\n    if(inputs.Count>1||buttons.Count>1)throw new InvalidOperationException(\"DIRECTORY_CONTROLS_MISSING_OR_AMBIGUOUS\");\n    Revalidate(dialog,pid,main,executable);\n    if(inputs.Count!=1||buttons.Count!=1)return result;\n    var input=inputs[0];var button=buttons[0];object rawValue,rawInvoke;\n    if(!input.TryGetCurrentPattern(ValuePattern.Pattern,out rawValue)||!button.TryGetCurrentPattern(InvokePattern.Pattern,out rawInvoke))\n      throw new InvalidOperationException(\"DIRECTORY_CONTROL_PATTERN_UNAVAILABLE\");\n    if(((ValuePattern)rawValue).Current.IsReadOnly)throw new InvalidOperationException(\"DIRECTORY_INPUT_READ_ONLY\");\n    result.inputID=input.Current.AutomationId;result.inputName=input.Current.Name;result.buttonName=button.Current.Name;\n    Revalidate(dialog,pid,main,executable);result.controlsReady=true;\n    return result;\n  }\n  public static ExportDialogResult Act(uint pid,long main,string executable,string action,string directory,long expectedHandle,long[] expectedOwners) {"
  ],
  [
    "    var result=new ExportDialogResult {action=action,dialog=dialog};LastObservation=result;",
    "    var result=new ExportDialogResult {action=action,dialog=dialog};LastObservation=result;\n    RequireExpectedDialog(dialog,expectedHandle,expectedOwners);"
  ],
  [
    "    } elseif ($request.op -eq 'choose' -or $request.op -eq 'cancel') {",
    "    } elseif ($request.op -eq 'inspect-choice') {\n      $result = [ExportDialog]::InspectChoice([uint32]$request.pid,[long]$request.mainHandle,[string]$request.executable,[long]$request.expectedHandle,[long[]]$request.expectedOwnerChain)\n      $reply = @{id=$request.id;ok=$true;result=$result}\n    } elseif ($request.op -eq 'choose' -or $request.op -eq 'cancel') {"
  ],
  [
    "      $result = [ExportDialog]::Act([uint32]$request.pid,[long]$request.mainHandle,[string]$request.executable,[string]$request.op,[string]$request.directory)",
    "      $result = [ExportDialog]::Act([uint32]$request.pid,[long]$request.mainHandle,[string]$request.executable,[string]$request.op,[string]$request.directory,[long]$request.expectedHandle,[long[]]$request.expectedOwnerChain)"
  ],
  [
    "  static void Revalidate(ExportDialogIdentity previous,uint pid,long main,string executable) {\n    var fresh=Find(pid,main,executable);\n    if(fresh==null||fresh.handle!=previous.handle||fresh.owner!=previous.owner||fresh.pid!=previous.pid)\n      throw new InvalidOperationException(\"DIRECTORY_DIALOG_CHANGED\");\n  }",
    "  static void Revalidate(ExportDialogIdentity previous,uint pid,long main,string executable) {\n    var fresh=Find(pid,main,executable);\n    if(fresh==null||fresh.handle!=previous.handle||fresh.owner!=previous.owner||fresh.pid!=previous.pid)\n      throw new InvalidOperationException(\"DIRECTORY_DIALOG_CHANGED\");\n    RequireExpectedDialog(fresh,previous.handle,previous.ownerChain.ToArray());\n  }"
  ]
]
export function restorePreReadinessWorker(source) {
  const canonical = source.replace(/\r\n/g, '\n'), crlf = source.includes('\r\n')
  assert.equal(source, crlf ? canonical.replace(/\n/g, '\r\n') : canonical, 'Only one exact checkout newline representation is permitted')
  let restored = canonical
  for (const [before, after] of [...workerReplacements].reverse()) {
    assert.equal(restored.split(after).length - 1, 1, 'Each authorized worker change must be unique')
    restored = restored.replace(after, before)
  }
  assert.equal(sha256(restored), 'b07ce35f3afa86d0454ca561c9d6ead793038bc2869e6bc8f20ca52825018a70',
    'Readiness changes must restore the complete actual f024 worker bytes')
  return crlf ? restored.replace(/\n/g, '\r\n') : restored
}

const retainedFailure = {
  "dialog": {
    "handle": 917970,
    "pid": 6480,
    "owner": 328038,
    "title": "选择文档导出目录",
    "cls": "#32770",
    "image": "D:\\a\\Local-Notepad\\Local-Notepad\\release\\win-unpacked\\记事本.exe",
    "visible": true,
    "ownerChain": [
      328038
    ]
  },
  "controls": [
    {
      "id": "Close",
      "name": "Close",
      "cls": "",
      "type": "ControlType.Button",
      "enabled": true,
      "offscreen": false
    }
  ],
  "action": "choose",
  "selectedPath": null,
  "inputID": null,
  "inputName": null,
  "buttonName": null,
  "valueWrites": 0,
  "invocations": 0,
  "closePosts": 0,
  "dialogClosed": false
}
const binding = { pid: retainedFailure.dialog.pid, mainHandle: retainedFailure.dialog.ownerChain.at(-1), executable: retainedFailure.dialog.image }
const ownedRoot = 'C:\\owned-export-readiness-contract', directory = ownedRoot + '\\exports\\ready'
const dialog = () => structuredClone(retainedFailure.dialog)
const input = () => ({ id: '1152', name: 'Folder:', cls: 'Edit', type: 'ControlType.Edit', enabled: true, offscreen: false })
const button = () => ({ id: '1', name: '选择此目录', cls: 'Button', type: 'ControlType.Button', enabled: true, offscreen: false })
const closeOnly = () => ({ ...structuredClone(retainedFailure), action: 'inspect-choice', controlsReady: false })
const readyObservation = () => ({ ...closeOnly(), controls: [...closeOnly().controls, input(), button()], controlsReady: true,
  inputID: '1152', inputName: 'Folder:', buttonName: '选择此目录' })
const actionResult = (operation, chosenDirectory) => operation === 'cancel'
  ? { ...closeOnly(), controls: [], action: operation, dialogClosed: true, closePosts: 1 }
  : { ...readyObservation(), action: operation, controlsReady: false, dialogClosed: true, selectedPath: chosenDirectory,
    valueWrites: 1, invocations: 1, closePosts: 0 }

function observedWorker(t, respond) {
  const child = new EventEmitter(), commands = [], spawns = []; let ended = false, kills = 0
  child.pid = 991; child.stdout = new PassThrough(); child.stderr = new PassThrough()
  const end = (code, signal = null) => { if (!ended) { ended = true; child.emit('exit', code, signal); child.emit('close', code, signal) } }
  const send = value => child.stdout.write(JSON.stringify(value) + '\r\n')
  child.stdin = new Writable({ write(chunk, _encoding, done) {
    const request = JSON.parse(chunk.toString()); commands.push(structuredClone(request)); done()
    const result = respond(request, commands)
    if (result !== undefined) queueMicrotask(() => send(result))
  }, final(done) { done(); queueMicrotask(() => end(0)) } })
  child.kill = () => { kills++; queueMicrotask(() => end(null, 'SIGTERM')); return true }
  const spawnWorker = (...args) => { spawns.push(args); queueMicrotask(() => send({ protocol: 1, ready: true })); return child }
  const directorySession = createExportDirectorySession({ ownedRoot, spawnWorker })
  t.after(() => directorySession.dispose())
  return { directorySession, commands, spawns, get kills() { return kills } }
}

function originalUntil() {
  const source = readFileSync(new URL('./run-local-export-desktop.mjs', import.meta.url), 'utf8')
  const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .filter(node => node.type === 'FunctionDeclaration' && node.id?.name === 'until')
  assert.equal(declarations.length, 1)
  const declaration = declarations[0], sleeps = [], calls = []; let elapsed = 0
  const actual = new Script(source.slice(declaration.start, declaration.end) + '; until').runInNewContext({
    performance: { now: () => elapsed },
    sleep: async milliseconds => { assert.equal(milliseconds, 100); sleeps.push(milliseconds); elapsed += milliseconds },
  })
  return { until: (...args) => { calls.push(args.slice(1)); return actual(...args) }, sleeps, calls, get elapsed() { return elapsed } }
}
const runChoice = (worker, clock) => actOnExportDirectory({ directorySession: worker.directorySession, binding, until: clock.until }, 'choose', directory)
const nativeActions = commands => commands.filter(request => ['choose', 'cancel', 'minimum-window'].includes(request.op))
function assertOriginalDefaults(worker, clock) {
  assert.equal(worker.directorySession.diagnostics().startupMs, 30000)
  assert.equal(worker.directorySession.diagnostics().requestMs, 10000)
  assert.equal(worker.directorySession.diagnostics().disposeMs, 2000)
  assert.ok(clock.calls.every(args => args.length === 1), 'Use the original until default budget without override')
}

test('DR01 visible Close-only native failure waits for complete controls before one choice', async t => {
  assert.equal(retainedFailure.action, 'choose')
  assert.deepEqual(retainedFailure.controls.map(control => control.name), ['Close'])
  assert.equal(retainedFailure.valueWrites, 0); assert.equal(retainedFailure.invocations, 0); assert.equal(retainedFailure.closePosts, 0)
  const partial = { ...closeOnly(), controls: [...closeOnly().controls, input()] }
  const observations = [null, closeOnly(), partial, readyObservation()]
  const worker = observedWorker(t, request => request.op === 'inspect-choice'
    ? { id: request.id, ok: true, result: observations.shift() }
    : { id: request.id, ok: true, result: actionResult(request.op, request.directory) })
  const clock = originalUntil(), result = await runChoice(worker, clock)
  assert.equal(result.valueWrites, 1); assert.equal(result.invocations, 1); assert.equal(result.dialogClosed, true)
  assert.deepEqual(worker.commands.map(request => request.op), ['inspect-choice', 'inspect-choice', 'inspect-choice', 'inspect-choice', 'choose'])
  assert.equal(worker.commands[0].expectedHandle, undefined); assert.equal(worker.commands[1].expectedHandle, undefined)
  for (const request of worker.commands.slice(2)) {
    assert.equal(request.expectedHandle, dialog().handle); assert.deepEqual(request.expectedOwnerChain, dialog().ownerChain)
  }
  assert.deepEqual(clock.sleeps, [100, 100, 100]); assert.equal(nativeActions(worker.commands).length, 1)
  assert.equal(worker.directorySession.events().filter(event => event.type === 'inspect-choice' && event.result?.controlsReady === false).length, 2)
  assert.equal(worker.spawns.length, 1); assertOriginalDefaults(worker, clock)
  assert.equal(await worker.directorySession.dispose(), true); assert.equal(worker.kills, 0)
})

test('DR02 missing controls exhaust the original fifteen-second wait without a native action', async t => {
  const worker = observedWorker(t, request => ({ id: request.id, ok: true, result: closeOnly() })), clock = originalUntil()
  await assert.rejects(runChoice(worker, clock), /Owned native directory picker missing/)
  assert.equal(clock.elapsed, 15000); assert.equal(clock.sleeps.length, 150)
  assert.equal(worker.commands.length, 150); assert.ok(worker.commands.every(request => request.op === 'inspect-choice'))
  assert.equal(nativeActions(worker.commands).length, 0); assert.equal(worker.kills, 0)
  assertOriginalDefaults(worker, clock); assert.equal(await worker.directorySession.dispose(), true)
})

test('DR03 ambiguous folder inputs or choice buttons refuse before any native write', async t => {
  for (const duplicate of [input, button]) {
    const observation = readyObservation(); observation.controls.push(duplicate())
    const worker = observedWorker(t, request => ({ id: request.id, ok: true, result: observation })), clock = originalUntil()
    await assert.rejects(runChoice(worker, clock), { code: 'IDENTITY_OR_ACTION_MISMATCH' })
    assert.equal(worker.commands.length, 1); assert.equal(nativeActions(worker.commands).length, 0)
    assert.equal(clock.sleeps.length, 0); assert.equal(worker.kills, 1)
    assert.equal(await worker.directorySession.dispose(), false)
  }
})

test('DR04 a foreign dialog cannot become a ready owned directory', async t => {
  for (const mutate of [value => value.dialog.pid++, value => { value.dialog.image = 'C:\\foreign\\app.exe' },
    value => { value.dialog.owner = 999; value.dialog.ownerChain = [999] }]) {
    const observation = readyObservation(); mutate(observation)
    const worker = observedWorker(t, request => ({ id: request.id, ok: true, result: observation })), clock = originalUntil()
    await assert.rejects(runChoice(worker, clock), { code: 'IDENTITY_OR_ACTION_MISMATCH' })
    assert.equal(worker.commands.length, 1); assert.equal(nativeActions(worker.commands).length, 0)
    assert.equal(clock.sleeps.length, 0); assert.equal(await worker.directorySession.dispose(), false)
  }
})

test('DR05 replacing an owned dialog handle during readiness is terminal', async t => {
  const replacement = readyObservation(); replacement.dialog.handle++
  const observations = [closeOnly(), replacement]
  const worker = observedWorker(t, request => ({ id: request.id, ok: true, result: observations.shift() })), clock = originalUntil()
  await assert.rejects(runChoice(worker, clock), { code: 'IDENTITY_OR_ACTION_MISMATCH' })
  assert.equal(worker.commands.length, 2); assert.equal(worker.commands[1].expectedHandle, dialog().handle)
  assert.deepEqual(clock.sleeps, [100]); assert.equal(nativeActions(worker.commands).length, 0)
  assert.equal(await worker.directorySession.dispose(), false)
})

test('DR06 changing an otherwise owned owner chain during readiness is terminal', async t => {
  for (const middleOnly of [false, true]) {
    const initial = closeOnly(), replacement = readyObservation()
    if (middleOnly) {
      initial.dialog.owner = replacement.dialog.owner = 444
      initial.dialog.ownerChain = [444, 555, binding.mainHandle]
      replacement.dialog.ownerChain = [444, 666, binding.mainHandle]
      assert.equal(initial.dialog.owner, replacement.dialog.owner)
    } else {
      replacement.dialog.owner = 444; replacement.dialog.ownerChain = [444, binding.mainHandle]
    }
    assert.equal(initial.dialog.handle, replacement.dialog.handle); assert.equal(initial.dialog.pid, replacement.dialog.pid)
    const expectedOwners = [...initial.dialog.ownerChain], observations = [initial, replacement]
    const worker = observedWorker(t, request => ({ id: request.id, ok: true, result: observations.shift() })), clock = originalUntil()
    await assert.rejects(runChoice(worker, clock), { code: 'IDENTITY_OR_ACTION_MISMATCH' })
    assert.deepEqual(worker.commands[1].expectedOwnerChain, expectedOwners)
    assert.equal(worker.commands.length, 2); assert.equal(nativeActions(worker.commands).length, 0)
    assert.equal(await worker.directorySession.dispose(), false)
  }
})

test('DR07 disappearance after the first owned dialog does not wait for a replacement', async t => {
  const observations = [closeOnly(), null]
  const worker = observedWorker(t, request => ({ id: request.id, ok: true, result: observations.shift() })), clock = originalUntil()
  await assert.rejects(runChoice(worker, clock), { code: 'IDENTITY_OR_ACTION_MISMATCH' })
  assert.equal(worker.commands.length, 2); assert.deepEqual(clock.sleeps, [100])
  assert.equal(nativeActions(worker.commands).length, 0); assert.equal(await worker.directorySession.dispose(), false)
})

test('DR08 native ambiguous foreign pattern and readonly refusals never become another poll', async t => {
  for (const reason of ['DIRECTORY_CONTROLS_MISSING_OR_AMBIGUOUS', 'UIA_FOREIGN_PROCESS', 'DIRECTORY_CONTROL_PATTERN_UNAVAILABLE', 'DIRECTORY_INPUT_READ_ONLY']) {
    const worker = observedWorker(t, request => ({ id: request.id, ok: false, error: reason, observation: closeOnly() })), clock = originalUntil()
    await assert.rejects(runChoice(worker, clock), { code: 'UNCONFIRMED_REPLY' })
    assert.equal(worker.directorySession.events().find(event => event.type === 'failed').reason, reason)
    assert.equal(worker.commands.length, 1); assert.equal(nativeActions(worker.commands).length, 0)
    assert.equal(clock.sleeps.length, 0)
    await assert.rejects(runChoice(worker, clock), { code: 'UNAVAILABLE' })
    assert.equal(worker.commands.length, 1); assert.equal(worker.spawns.length, 1)
    assert.equal(await worker.directorySession.dispose(), false)
  }
})

test('DR09 ready then native action refusal preserves one attempt and the original error', async t => {
  const worker = observedWorker(t, request => request.op === 'inspect-choice'
    ? { id: request.id, ok: true, result: readyObservation() }
    : { id: request.id, ok: false, error: 'DIRECTORY_DIALOG_CHANGED', observation: { ...closeOnly(), action: 'choose' } })
  const clock = originalUntil()
  await assert.rejects(runChoice(worker, clock), { code: 'UNCONFIRMED_REPLY' })
  assert.deepEqual(worker.commands.map(request => request.op), ['inspect-choice', 'choose'])
  assert.equal(worker.commands[1].expectedHandle, dialog().handle)
  assert.deepEqual(worker.commands[1].expectedOwnerChain, dialog().ownerChain)
  assert.equal(nativeActions(worker.commands).length, 1); assert.equal(clock.sleeps.length, 0)
  await assert.rejects(runChoice(worker, clock), { code: 'UNAVAILABLE' })
  assert.equal(worker.commands.length, 2); assert.equal(await worker.directorySession.dispose(), false)
  // The exported coordinator itself must not wrap or replace an action error.
  const refusal = new Error('owned native action refused'), directClock = originalUntil(); let actions = 0
  await assert.rejects(actOnExportDirectory({ binding, until: directClock.until,
    directorySession: { inspectChoice: async () => readyObservation(), choose: async () => { actions++; throw refusal } },
  }, 'choose', directory), error => error === refusal)
  assert.equal(actions, 1); assert.equal(directClock.sleeps.length, 0)
})

test('DR10 an uncertain reply after write and invoke is never replayed', async t => {
  const observation = { ...actionResult('choose', directory), dialogClosed: false }
  const worker = observedWorker(t, request => request.op === 'inspect-choice'
    ? { id: request.id, ok: true, result: readyObservation() }
    : { id: request.id, ok: false, error: 'DIRECTORY_DIALOG_DID_NOT_CLOSE', observation })
  const clock = originalUntil()
  await assert.rejects(runChoice(worker, clock), { code: 'UNCONFIRMED_REPLY' })
  const failed = worker.directorySession.events().find(event => event.type === 'failed')
  assert.equal(failed.nativeObservation.valueWrites, 1); assert.equal(failed.nativeObservation.invocations, 1)
  assert.equal(nativeActions(worker.commands).length, 1); assert.equal(worker.commands.length, 2)
  await assert.rejects(runChoice(worker, clock), { code: 'UNAVAILABLE' })
  assert.equal(worker.commands.length, 2); assert.equal(worker.kills, 1)
  assert.equal(await worker.directorySession.dispose(), false)
})

test('DR11 a readiness reply cannot claim an action or inconsistent readiness', async t => {
  for (const mutate of [value => { value.valueWrites = 1 }, value => { value.invocations = 1 },
    value => { value.closePosts = 1 }, value => { value.selectedPath = directory }, value => { value.dialogClosed = true },
    value => { value.controlsReady = true }, value => { value.controls.push({ ...input(), enabled: 'true' }) }]) {
    const observation = closeOnly(); mutate(observation)
    assert.throws(() => validateExportDirectoryReadiness(observation, binding))
    const worker = observedWorker(t, request => ({ id: request.id, ok: true, result: observation })), clock = originalUntil()
    await assert.rejects(runChoice(worker, clock), { code: 'IDENTITY_OR_ACTION_MISMATCH' })
    assert.equal(worker.commands.length, 1); assert.equal(nativeActions(worker.commands).length, 0)
    assert.equal(await worker.directorySession.dispose(), false)
  }
})

test('DR12 cancel keeps the original window-only observation and one close post', async t => {
  let inspections = 0
  const worker = observedWorker(t, request => request.op === 'inspect'
    ? { id: request.id, ok: true, dialog: ++inspections === 1 ? null : dialog() }
    : { id: request.id, ok: true, result: actionResult(request.op, request.directory) })
  const clock = originalUntil()
  const result = await actOnExportDirectory({ directorySession: worker.directorySession, binding, until: clock.until }, 'cancel')
  assert.deepEqual(worker.commands.map(request => request.op), ['inspect', 'inspect', 'cancel'])
  assert.ok(worker.commands.every(request => !Object.hasOwn(request, 'expectedHandle') && !Object.hasOwn(request, 'expectedOwnerChain')))
  assert.equal(result.closePosts, 1); assert.equal(result.valueWrites, 0); assert.equal(result.invocations, 0)
  assert.equal(nativeActions(worker.commands).length, 1); assert.deepEqual(clock.sleeps, [100])
  assertOriginalDefaults(worker, clock); assert.equal(await worker.directorySession.dispose(), true)
})

test('DR13 actual destination closure uses readiness and retains cancel reporting and return checks', async t => {
  const source = readFileSync(new URL('./check-local-export-desktop.mjs', import.meta.url), 'utf8')
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), matches = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'VariableDeclarator' && node.id?.name === 'destination') matches.push(node.init)
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value)
  }
  visit(ast); assert.equal(matches.length, 1)
  for (const cancel of [false, true]) {
    let probes = 0
    const worker = observedWorker(t, request => request.op === 'inspect-choice'
      ? { id: request.id, ok: true, result: ++probes === 1 ? closeOnly() : readyObservation() }
      : request.op === 'inspect' ? { id: request.id, ok: true, dialog: dialog() }
        : { id: request.id, ok: true, result: actionResult(request.op, request.directory) })
    const clock = originalUntil(), report = { directoryActions: [] }, order = []
    const actual = new Script(source.slice(matches[0].start, matches[0].end)).runInNewContext({
      ownedRoot, path, directorySession: worker.directorySession, binding, report, actOnExportDirectory,
      until: clock.until, structuredClone,
      mkdirSync: (value, options) => { order.push(['mkdir', value, options.recursive]) },
      click: async selector => { order.push(['click', selector]) },
      save: () => { order.push(['save', report.directoryActions.length]) },
      evaluate: async expression => { order.push(['returned', expression]); return true },
    })
    const selected = await actual('fixture', cancel)
    assert.equal(selected, cancel ? undefined : path.join(ownedRoot, 'exports', 'fixture'))
    assert.deepEqual(worker.commands.map(request => request.op), cancel ? ['inspect', 'cancel'] : ['inspect-choice', 'inspect-choice', 'choose'])
    assert.equal(report.directoryActions.length, 1); assert.equal(report.directoryActions[0].result.action, cancel ? 'cancel' : 'choose')
    assert.deepEqual(order.map(item => item[0]), cancel ? ['click', 'save', 'returned'] : ['mkdir', 'click', 'save', 'returned'])
    assert.equal(order.find(item => item[0] === 'click')[1], '[data-local-export-choose]')
    assert.equal(order.at(-1)[1], "!document.querySelector('[data-local-export-choose]')?.disabled")
    assertOriginalDefaults(worker, clock); assert.equal(await worker.directorySession.dispose(), true)
  }
})

