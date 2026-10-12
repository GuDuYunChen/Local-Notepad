// @vitest-environment node
import { test } from 'vitest'
import { registerPackageTerminationTests } from '../../scripts/windows-package-termination-cases.mjs'
registerPackageTerminationTests(test)
