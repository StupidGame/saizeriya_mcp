import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Server } from '../packages/server/src/main'
import { env } from './fixtures/env'
import { POST as postMcp } from '../apps/betterzeriya/src/routes/mcp/+server'
import { POST as postSession } from '../apps/betterzeriya/src/routes/api/sessions/+server'
import { getOfficialState } from '../apps/betterzeriya/src/lib/server/official-client'
import { sessionTtlMs } from '../apps/betterzeriya/src/lib/server/session-store'

const endpoint = new URL('https://betterzeriya.example/mcp')
const send = (message: unknown, headers: Record<string, string> = {}) =>
  postMcp({
    url: endpoint,
    request: new Request(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(message),
    }),
  } as Parameters<typeof postMcp>[0])

const callTool = async (name: string, args: Record<string, unknown> = {}) => {
  const response = await send({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })
  expect(response.status).toBe(200)
  return (await response.json()).result
}

describe('public MCP endpoint and ordering sessions', () => {
  let qrURL: string

  beforeEach(() => {
    for (const key of Object.keys(env)) delete env[key]
    const server = new Server()
    qrURL = server.createNewTable(525, 51).createQRCodeURL('http://example.com', '/saizeriya3')
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => server.app.fetch(input as Request))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('initializes and lists tools without OAuth or an ordering session, including on Vercel', async () => {
    env.VERCEL = '1'
    env.MCP_OAUTH_ENABLED = '1'
    for (const method of ['initialize', 'ping', 'tools/list']) {
      const response = await send({ jsonrpc: '2.0', id: 1, method })
      expect(response.status).toBe(200)
      expect(response.headers.has('www-authenticate')).toBe(false)
      const body = await response.json()
      expect(body.error).toBeUndefined()
      if (method === 'tools/list') {
        for (const tool of body.result.tools) {
          if (['search_menu', 'start_order_session'].includes(tool.name)) continue
          expect(tool.inputSchema.required).toContain('sessionId')
          expect(tool.inputSchema.properties.officialSession).toBeUndefined()
        }
      }
    }
    expect((await callTool('search_menu', { query: '1202' })).isError).toBeUndefined()
  })

  it('uses an ID from a browser-created session and keeps browser state in sync after MCP changes', async () => {
    const response = await postSession({
      request: new Request('https://betterzeriya.example/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ qrURLSource: qrURL }),
      }),
    } as Parameters<typeof postSession>[0])
    expect(response.status).toBe(200)
    const session = await response.json()
    const args = { sessionId: session.id }
    expect((await callTool('get_session_state', args)).structuredContent.state.tableNo).toBe(51)
    expect(
      (await callTool('set_people_count', { ...args, peopleCount: 4 })).isError,
    ).toBeUndefined()
    // The browser's original snapshot must not overwrite the newer server state.
    expect((await getOfficialState(session.id, session.officialSession)).state.peopleCount).toBe(4)
    const order = await callTool('submit_order', { ...args, cart: [{ id: '1202', count: 2 }] })
    expect(order.isError).toBeUndefined()
    const account = await callTool('get_account', args)
    expect(account.structuredContent.account.count).toBe(2)
    expect(account.structuredContent.officialSession).toBeUndefined()
    expect((await callTool('show_receipt', args)).isError).toBeUndefined()
    expect((await callTool('call_staff', args)).isError).toBeUndefined()
  })

  it('returns a reusable ID when starting a session through MCP', async () => {
    const started = await callTool('start_order_session', { qrURLSource: qrURL, peopleCount: 2 })
    expect(started.isError).toBeUndefined()
    expect(started.structuredContent.officialSession).toBeUndefined()
    const sessionId = started.structuredContent.sessionId
    expect(typeof sessionId).toBe('string')
    const item = await callTool('lookup_item', { sessionId, code: '1202' })
    expect(item.structuredContent.item_data.id).toBe('1202')
  })

  it('rejects missing, unknown and expired IDs without using another session', async () => {
    const started = await callTool('start_order_session', { qrURLSource: qrURL })
    const sessionId = started.structuredContent.sessionId
    for (const args of [{}, { sessionId: '' }, { sessionId: 'unknown' }]) {
      expect((await callTool('get_session_state', args)).isError).toBe(true)
    }
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + sessionTtlMs + 1)
    expect((await callTool('get_session_state', { sessionId })).isError).toBe(true)
  })

  it('rejects disallowed origins and still accepts notifications', async () => {
    const response = await send(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { origin: 'https://untrusted.example' },
    )
    expect(response.status).toBe(403)
    expect((await send({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
  })
})
