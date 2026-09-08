import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { OfficialSessionSnapshot } from '../apps/betterzeriya/src/lib/server/official-client'

const snapshot = (): OfficialSessionSnapshot => ({
  id: crypto.randomUUID(),
  state: {
    baseURL: 'https://example.com/saizeriya3/',
    nextId: 'next',
    shopId: 525,
    tableNo: 51,
    peopleCount: 2,
    pageKind: 'menu',
    cart: [],
  },
  cookies: [['session', 'test-cookie']],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const loadInstance = async (config: Record<string, string> = {}) => {
  vi.resetModules()
  const { env } = await import('./fixtures/env')
  Object.assign(env, config)
  return await import('../apps/betterzeriya/src/lib/server/session-store')
}

describe('shared session storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each(['UPSTASH', 'KV'])(
    'shares sessions between instances using %s settings',
    async (provider) => {
      const records = new Map<string, string>()
      const config =
        provider === 'UPSTASH'
          ? {
              UPSTASH_REDIS_REST_URL: 'https://redis.example',
              UPSTASH_REDIS_REST_TOKEN: 'test-token',
            }
          : { KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'test-token' }
      const fetchRedis = vi.fn(async (_url: string, options: RequestInit) => {
        expect(options.headers).toMatchObject({ authorization: 'Bearer test-token' })
        const [command, key, value, expiry, ttl] = JSON.parse(String(options.body))
        if (command === 'SET') {
          expect(expiry).toBe('PX')
          expect(ttl).toBe(6 * 60 * 60 * 1000)
          records.set(key, value)
          return Response.json({ result: 'OK' })
        }
        return Response.json({ result: records.get(key) ?? null })
      })
      vi.stubGlobal('fetch', fetchRedis)
      const firstInstance = await loadInstance({ VERCEL: '1', ...config })
      const session = snapshot()
      await firstInstance.saveSessionSnapshot(session)

      const secondInstance = await loadInstance({ VERCEL: '1', ...config })
      expect(await secondInstance.loadSessionSnapshot(session.id)).toEqual(session)
      expect(await secondInstance.loadSessionSnapshot('unknown')).toBeUndefined()
      await secondInstance.saveSessionSnapshot({
        ...session,
        state: { ...session.state, peopleCount: 4 },
      })
      expect((await firstInstance.loadSessionSnapshot(session.id))?.state.peopleCount).toBe(4)
    },
  )

  it('falls back to memory on Vercel when a shared store is not configured', async () => {
    const store = await loadInstance({ VERCEL: '1' })
    const session = snapshot()
    await expect(store.saveSessionSnapshot(session)).resolves.toEqual(session)
    expect(await store.loadSessionSnapshot(session.id)).toEqual(session)
  })

  it('fails clearly when only half of the Redis configuration is provided', async () => {
    const store = await loadInstance({
      VERCEL: '1',
      UPSTASH_REDIS_REST_URL: 'https://redis.example',
    })
    await expect(store.saveSessionSnapshot(snapshot())).rejects.toThrow(
      'requires both UPSTASH_REDIS_REST_URL',
    )
  })

  it('does not silently use local memory when Redis fails', async () => {
    const store = await loadInstance({
      KV_REST_API_URL: 'https://redis.example',
      KV_REST_API_TOKEN: 'test-token',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 503 })),
    )
    await expect(store.saveSessionSnapshot(snapshot())).rejects.toThrow('unavailable')
    await expect(store.loadSessionSnapshot('unknown')).rejects.toThrow('unavailable')
  })

  it('expires idle sessions and isolates snapshots in local development', async () => {
    const store = await loadInstance()
    const session = snapshot()
    await store.saveSessionSnapshot(session)
    session.state.peopleCount = 99
    expect((await store.loadSessionSnapshot(session.id))?.state.peopleCount).toBe(2)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + store.sessionTtlMs)
    expect(await store.loadSessionSnapshot(session.id)).toBeUndefined()
  })
})
