import test from 'node:test'
import { registerS3ReadProbeTests } from './s3-read-probe-cases.mjs'
registerS3ReadProbeTests(test)
