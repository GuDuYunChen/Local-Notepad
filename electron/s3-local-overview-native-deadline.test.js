// @vitest-environment node
import { test } from 'vitest'
import { registerNativeOverviewDeadlineTests } from '../scripts/s3-local-overview-native-deadline-cases.mjs'
registerNativeOverviewDeadlineTests(test)
