// @vitest-environment node
import { test } from 'vitest'
import { registerClipboardAdmissionTests } from '../../scripts/s3-local-overview-clipboard-admission-cases.mjs'
registerClipboardAdmissionTests(test)
