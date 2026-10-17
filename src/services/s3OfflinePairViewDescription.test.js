// @vitest-environment node
import { test } from 'vitest'
import { registerViewDescriptionTests } from '../../scripts/s3-offline-pair-view-description-cases.mjs'
registerViewDescriptionTests(test)
