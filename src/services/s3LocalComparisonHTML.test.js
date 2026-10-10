// @vitest-environment node
import { test } from 'vitest'
import { registerComparisonHTMLTests } from '../../scripts/s3-local-comparison-html-cases.mjs'
registerComparisonHTMLTests(test)
