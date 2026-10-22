// @vitest-environment node
import { test } from 'vitest'
import { registerS3PreviewBindingTests } from '../../scripts/s3-preview-binding-cases.mjs'
registerS3PreviewBindingTests(test)
