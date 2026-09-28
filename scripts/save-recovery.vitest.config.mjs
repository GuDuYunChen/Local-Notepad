import { mergeConfig } from 'vitest/config'
import config from '../vitest.config.js'
export default mergeConfig(config, { test: { include: ['scripts/integration/*.live.jsx'], testTimeout: 60000, hookTimeout: 25000, minWorkers: 1, maxWorkers: 1 } })
