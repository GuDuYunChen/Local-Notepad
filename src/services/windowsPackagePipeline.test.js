// @vitest-environment node
import { test } from 'vitest'
import { registerWindowsPackageTests } from '../../scripts/windows-package-cases.mjs'
registerWindowsPackageTests(test)
