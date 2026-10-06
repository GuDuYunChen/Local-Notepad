// @vitest-environment node
import { test } from 'vitest'
import { registerS3PreviewBridgeTests } from '../scripts/s3-preview-bridge-cases.mjs'
registerS3PreviewBridgeTests(test)
