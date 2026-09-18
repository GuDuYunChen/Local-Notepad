import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { stopChildProcess, waitForHttpService } from './backend-process.js'

class FakeChild extends EventEmitter {
  constructor({ exitCode = null, killed = false } = {}) {
    super()
    this.exitCode = exitCode
    this.signalCode = null
    this.killed = killed
    this.kill = vi.fn((signal) => {
      if (signal === 'SIGTERM') return true
      if (signal === 'SIGKILL') {
        this.killed = true
        return true
      }
      return true
    })
  }
}

describe('stopChildProcess', () => {
  it('sends SIGTERM and resolves when the child exits', async () => {
    const child = new FakeChild()
    const stopping = stopChildProcess(child, 1000)

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.exitCode = 0
    child.emit('exit', 0, null)

    await expect(stopping).resolves.toBeUndefined()
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('forces termination after the graceful timeout', async () => {
    vi.useFakeTimers()
    try {
      const child = new FakeChild()
      const stopping = stopChildProcess(child, 100)

      await vi.advanceTimersByTimeAsync(100)
      expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
      expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')

      await vi.advanceTimersByTimeAsync(500)
      await expect(stopping).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does nothing for an already exited process', async () => {
    const child = new FakeChild({ exitCode: 0 })
    await expect(stopChildProcess(child)).resolves.toBeUndefined()
    expect(child.kill).not.toHaveBeenCalled()
  })
})


describe('waitForHttpService', () => {
  it('returns immediately for a healthy endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0 }),
    })
    const sleep = vi.fn()

    await expect(waitForHttpService('http://127.0.0.1/health', {
      fetchImpl,
      sleep,
      now: () => 0,
    })).resolves.toBe(true)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries until the backend becomes healthy', async () => {
    let clock = 0
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0 }),
      })
    const sleep = vi.fn(async (ms) => {
      clock += ms
    })

    await expect(waitForHttpService('http://127.0.0.1/health', {
      timeoutMs: 1000,
      intervalMs: 100,
      fetchImpl,
      sleep,
      now: () => clock,
    })).resolves.toBe(true)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('returns false after the startup timeout', async () => {
    let clock = 0
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused'))
    const sleep = vi.fn(async (ms) => {
      clock += ms
    })

    await expect(waitForHttpService('http://127.0.0.1/health', {
      timeoutMs: 250,
      intervalMs: 100,
      fetchImpl,
      sleep,
      now: () => clock,
    })).resolves.toBe(false)

    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
