import { randomBytes } from 'node:crypto'
import { createS3LocalOverviewService, registerS3LocalOverviewHandler } from './s3-local-overview-bridge.js'
import { createS3ProbeScope } from './s3-probe-scope.js'

// The token stays in main and its owned backend environment, never preload,
// renderer, diagnostics, settings or disk. It is not an OS-user sandbox.
export function createS3LocalOverviewRuntime({ ipcMain, getWindow, getExpectedURL, isClosing, isAvailable }) {
  const token = randomBytes(32).toString('hex')
  const scope = createS3ProbeScope({ getWindow, getExpectedURL, isClosing })
  const service = createS3LocalOverviewService({ getToken: () => isAvailable() ? token : null })
  registerS3LocalOverviewHandler(ipcMain, service, scope)
  return Object.freeze({
    childEnvironment: env => ({ ...env, NOTEPAD_LOCAL_OVERVIEW_TOKEN: token }),
    abort: () => scope.abortAll(),
  })
}
