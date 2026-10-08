// @vitest-environment node
import { test } from 'vitest'
import { registerAppVersionTests } from '../../scripts/app-version-cases.mjs'
registerAppVersionTests(test)
