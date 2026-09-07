import { json, type RequestHandler } from '@sveltejs/kit'
import { callMcpTool, mcpTools } from '$lib/server/mcp-tools'
import { createParseError, handleMcpMessage, mcpProtocolVersion } from '$lib/mcp-protocol'

const allowedBrowserOrigins = new Set([
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'code.claude.com',
  'platform.openai.com',
])

const isLoopback = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'

const isAllowedOrigin = (origin: string | null, endpointOrigin: string) => {
  if (!origin) {
    return true
  }
  if (!URL.canParse(origin)) {
    return false
  }

  const originURL = new URL(origin)
  if (originURL.origin === endpointOrigin || isLoopback(originURL.hostname)) {
    return true
  }
  return originURL.protocol === 'https:' && allowedBrowserOrigins.has(originURL.hostname)
}

const corsHeaders = (origin: string | null) => ({
  'access-control-allow-origin': origin ?? '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS, DELETE',
  'access-control-allow-headers':
    'authorization, content-type, accept, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'mcp-protocol-version, mcp-session-id',
  'mcp-protocol-version': mcpProtocolVersion,
  vary: 'Origin',
})

export const OPTIONS: RequestHandler = ({ request, url }) => {
  const origin = request.headers.get('origin')
  if (!isAllowedOrigin(origin, url.origin)) {
    return new Response(null, { status: 403 })
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin) })
}

export const GET: RequestHandler = ({ request }) =>
  new Response('Betterzeriya MCP uses Streamable HTTP over POST.', {
    status: 405,
    headers: {
      ...corsHeaders(request.headers.get('origin')),
      allow: 'POST, OPTIONS',
    },
  })

export const DELETE: RequestHandler = ({ request }) =>
  new Response(null, {
    status: 405,
    headers: {
      ...corsHeaders(request.headers.get('origin')),
      allow: 'POST, OPTIONS',
    },
  })

export const POST: RequestHandler = async ({ request, url }) => {
  const origin = request.headers.get('origin')
  const headers = corsHeaders(origin)

  if (!isAllowedOrigin(origin, url.origin)) {
    return json(createParseError('Origin is not allowed'), { status: 403, headers })
  }

  const message = await request.json().catch(() => undefined)
  if (message === undefined) {
    return json(createParseError(), { status: 400, headers })
  }

  const response = await handleMcpMessage(message, mcpTools, callMcpTool)
  if (!response) {
    return new Response(null, { status: 202, headers })
  }

  return json(response, { headers })
}
