// @vitest-environment node
import { test } from 'vitest'
import { registerS3PreviewRefusalTests } from '../../scripts/s3-preview-refusal-cases.mjs'
registerS3PreviewRefusalTests(test)
