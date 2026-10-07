import test from 'node:test'
import { registerS3PreviewRefusalTests } from './s3-preview-refusal-cases.mjs'
registerS3PreviewRefusalTests((name, fn, timeout) => test(name, timeout ? { timeout } : {}, fn))
