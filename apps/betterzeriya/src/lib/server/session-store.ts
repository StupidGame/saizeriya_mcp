import { env } from '$env/dynamic/private'
import type { OfficialSessionSnapshot } from './official-client'

export const sessionTtlMs = 1000 * 60 * 60 * 6
const sessions = new Map<string, OfficialSessionSnapshot>()

const getRedisConfig = () => {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN
  if (url && token) {
    return { url, token }
  }
  if (url || token) {
    throw new Error(
      'Session storage configuration requires both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or both KV_REST_API_URL and KV_REST_API_TOKEN).',
    )
  }
  return undefined
}

const redisCommand = async (
  config: { url: string; token: string },
  command: Array<string | number>,
) => {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error('Session storage is unavailable')
  }
  const payload = (await response.json()) as { result?: unknown; error?: string }
  if (payload.error) {
    throw new Error('Session storage command failed')
  }
  return payload.result
}

const sessionKey = (id: string) => `betterzeriya:session:${id}`

export const isSessionExpired = (snapshot: OfficialSessionSnapshot) =>
  !Number.isFinite(snapshot.updatedAt) || Date.now() - snapshot.updatedAt >= sessionTtlMs

export const loadSessionSnapshot = async (id: string) => {
  const config = getRedisConfig()
  let snapshot: OfficialSessionSnapshot | undefined
  if (config) {
    const value = await redisCommand(config, ['GET', sessionKey(id)])
    if (typeof value === 'string') {
      snapshot = JSON.parse(value) as OfficialSessionSnapshot
    }
  } else {
    for (const [key, value] of sessions) {
      if (isSessionExpired(value)) {
        sessions.delete(key)
      }
    }
    snapshot = sessions.get(id)
  }
  if (!snapshot || snapshot.id !== id || isSessionExpired(snapshot)) {
    return undefined
  }
  return structuredClone(snapshot)
}

export const saveSessionSnapshot = async (snapshot: OfficialSessionSnapshot) => {
  const config = getRedisConfig()
  if (config) {
    const result = await redisCommand(config, [
      'SET',
      sessionKey(snapshot.id),
      JSON.stringify(snapshot),
      'PX',
      sessionTtlMs,
    ])
    if (result !== 'OK') {
      throw new Error('Session storage write failed')
    }
  } else {
    sessions.set(snapshot.id, structuredClone(snapshot))
  }
  return snapshot
}
