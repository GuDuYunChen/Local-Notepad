// @vitest-environment node
import { test } from 'vitest'
import { registerTrashWorkspaceTests } from '../../scripts/trash-workspace-cases.mjs'
registerTrashWorkspaceTests(test)
