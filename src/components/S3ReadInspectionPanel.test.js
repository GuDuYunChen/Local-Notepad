// @vitest-environment jsdom
import { test } from 'vitest'
import { registerS3ReadInspectionPanelTests } from './s3ReadInspectionPanel.cases.js'
registerS3ReadInspectionPanelTests(test)
