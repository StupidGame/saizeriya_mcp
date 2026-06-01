import { env } from '$env/dynamic/private'
import { json, redirect, type RequestEvent } from '@sveltejs/kit'

type OAuthPayload = {
  typ: 'client_id' | 'authorization_code' | 'access_token'
  exp: number
  aud: string
  client_id?: string
  code_challenge?: string
  code_challenge_method?: string
  redirect_uri?: string
  redirect_uris?: string[]
  resource?: string
  scope?: string
  sub?: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const tokenLifetimeSeconds = 60 * 60
const authorizationCodeLifetimeSeconds = 5 * 60
const fallbackOAuthSecret = crypto.randomUUID()

const base64UrlEncode = (value: Uint8Array | string) => {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const base64UrlDecode = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

const timingSafeEqual = (a: string, b: string) => {
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  let diff = aBytes.length ^ bBytes.length
  const length = Math.max(aBytes.length, bBytes.length)
  for (let index = 0; index < length; index += 1) {
    diff |= (aBytes[index] ?? 0) ^ (bBytes[index] ?? 0)
  }
  return diff === 0
}

const getOAuthSecret = () =>
  env.MCP_OAUTH_SECRET ??
  env.MCP_OAUTH_PASSWORD ??
  env.VERCEL_DEPLOYMENT_ID ??
  env.VERCEL_URL ??
  fallbackOAuthSecret

const importSigningKey = async () =>
  await crypto.subtle.importKey(
    'raw',
    encoder.encode(getOAuthSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

const sign = async (payload: string) => {
  const key = await importSigningKey()
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return base64UrlEncode(new Uint8Array(signature))
}

const createSignedPayload = async (payload: OAuthPayload) => {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  return `${encodedPayload}.${await sign(encodedPayload)}`
}

const readSignedPayload = async (token: string, expectedType: OAuthPayload['typ']) => {
  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature || signature !== (await sign(encodedPayload))) {
    return undefined
  }

  try {
    const payload = JSON.parse(decoder.decode(base64UrlDecode(encodedPayload))) as OAuthPayload
    if (payload.typ !== expectedType || payload.exp < Math.floor(Date.now() / 1000)) {
      return undefined
    }
    return payload
  } catch {
    return undefined
  }
}

export const isMcpOAuthEnabled = () => env.MCP_OAUTH_ENABLED !== '0'

export const mcpResourceUrl = (url: URL) => new URL('/mcp', url.origin).toString()

export const protectedResourceMetadataUrl = (url: URL) =>
  new URL('/.well-known/oauth-protected-resource/mcp', url.origin).toString()

export const authorizationServerMetadataUrl = (url: URL) =>
  new URL('/.well-known/oauth-authorization-server', url.origin).toString()

export const createUnauthorizedResponse = (
  url: URL,
  description = 'OAuth authorization required',
) =>
  json(
    {
      error: 'unauthorized',
      error_description: description,
    },
    {
      status: 401,
      headers: {
        'www-authenticate': `Bearer resource_metadata="${protectedResourceMetadataUrl(url)}", error="invalid_token", error_description="${description}"`,
      },
    },
  )

export const requireMcpBearer = async (request: Request, url: URL) => {
  if (!isMcpOAuthEnabled()) {
    return undefined
  }

  const authorization = request.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) {
    return createUnauthorizedResponse(url)
  }

  const payload = await readSignedPayload(match[1], 'access_token')
  if (!payload || payload.aud !== mcpResourceUrl(url)) {
    return createUnauthorizedResponse(url, 'Invalid or expired access token')
  }

  return undefined
}

export const createProtectedResourceMetadata = (url: URL) => ({
  resource: mcpResourceUrl(url),
  authorization_servers: [url.origin],
  bearer_methods_supported: ['header'],
  scopes_supported: ['mcp'],
})

export const createAuthorizationServerMetadata = (url: URL) => ({
  issuer: url.origin,
  authorization_endpoint: new URL('/oauth/authorize', url.origin).toString(),
  token_endpoint: new URL('/oauth/token', url.origin).toString(),
  registration_endpoint: new URL('/oauth/register', url.origin).toString(),
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['mcp'],
  protected_resources: [mcpResourceUrl(url)],
})

const validateRedirectUri = (redirectUri: string) => {
  if (!URL.canParse(redirectUri)) {
    return false
  }
  const parsed = new URL(redirectUri)
  return (
    parsed.protocol === 'https:' ||
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1'
  )
}

const invalidOAuthRequest = (message: string, status = 400) =>
  json({ error: 'invalid_request', error_description: message }, { status })

export const registerOAuthClient = async ({ request, url }: RequestEvent) => {
  const body = (await request.json().catch(() => ({}))) as { redirect_uris?: unknown }
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.map((entry: unknown) => String(entry)).filter(validateRedirectUri)
    : []

  if (redirectUris.length === 0) {
    return invalidOAuthRequest('redirect_uris must include at least one HTTPS or localhost URL')
  }

  const now = Math.floor(Date.now() / 1000)
  const clientId = await createSignedPayload({
    typ: 'client_id',
    exp: now + 60 * 60 * 24 * 365,
    aud: url.origin,
    redirect_uris: redirectUris,
  })

  return json(
    {
      client_id: clientId,
      client_id_issued_at: now,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    { status: 201 },
  )
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const renderAuthorizeForm = (params: URLSearchParams, error = '') => {
  const hiddenFields = [...params.entries()]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
    )
    .join('\n')
  const passwordField = env.MCP_OAUTH_PASSWORD
    ? `<label>Password
        <input name="password" type="password" autocomplete="current-password" autofocus />
      </label>`
    : ''

  return new Response(
    `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Betterzeriya MCP OAuth</title>
  <style>
    body { min-height: 100svh; margin: 0; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, sans-serif; background: #101827; color: #101827; }
    main { width: min(420px, calc(100% - 32px)); border-radius: 8px; background: #fff; padding: 24px; box-shadow: 0 28px 90px rgba(0,0,0,.28); }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0 0 18px; color: #475569; line-height: 1.6; }
    label { display: grid; gap: 6px; font-weight: 800; font-size: 13px; }
    input { min-height: 42px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0 12px; font: inherit; }
    button { width: 100%; min-height: 44px; margin-top: 14px; border: 0; border-radius: 8px; background: #159a63; color: white; font-weight: 900; }
    .error { color: #991b1b; font-weight: 800; margin-bottom: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Betterzeriya MCP</h1>
    <p>Authorize access to this MCP server.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form method="post" action="/oauth/authorize">
      ${hiddenFields}
      ${passwordField}
      <button type="submit">Authorize</button>
    </form>
  </main>
</body>
</html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )
}

const getAuthorizationParams = (form: FormData | URLSearchParams) => ({
  response_type: String(form.get('response_type') ?? ''),
  client_id: String(form.get('client_id') ?? ''),
  redirect_uri: String(form.get('redirect_uri') ?? ''),
  state: String(form.get('state') ?? ''),
  code_challenge: String(form.get('code_challenge') ?? ''),
  code_challenge_method: String(form.get('code_challenge_method') ?? ''),
  resource: String(form.get('resource') ?? ''),
  scope: String(form.get('scope') ?? 'mcp'),
})

const validateAuthorizationParams = async (
  params: ReturnType<typeof getAuthorizationParams>,
  url: URL,
) => {
  if (params.response_type !== 'code') {
    return 'response_type must be code'
  }
  const client = await readSignedPayload(params.client_id, 'client_id')
  if (!client || client.aud !== url.origin) {
    return 'client_id is invalid'
  }
  if (!client.redirect_uris?.includes(params.redirect_uri)) {
    return 'redirect_uri is not registered for this client_id'
  }
  if (!validateRedirectUri(params.redirect_uri)) {
    return 'redirect_uri must be HTTPS or localhost'
  }
  if (params.code_challenge_method !== 'S256' || !params.code_challenge) {
    return 'PKCE S256 code_challenge is required'
  }
  if (params.resource && params.resource !== mcpResourceUrl(url)) {
    return 'resource must match this MCP server'
  }
  return ''
}

export const showAuthorizationPage = async ({ url }: RequestEvent) => {
  const params = getAuthorizationParams(url.searchParams)
  const error = await validateAuthorizationParams(params, url)
  return renderAuthorizeForm(url.searchParams, error)
}

export const submitAuthorizationPage = async ({ request, url }: RequestEvent) => {
  const form = await request.formData()
  const params = getAuthorizationParams(form)
  const error = await validateAuthorizationParams(params, url)
  if (error) {
    return renderAuthorizeForm(new URLSearchParams(Object.entries(params)), error)
  }

  if (env.MCP_OAUTH_PASSWORD) {
    const password = String(form.get('password') ?? '')
    if (!timingSafeEqual(password, env.MCP_OAUTH_PASSWORD)) {
      return renderAuthorizeForm(
        new URLSearchParams(Object.entries(params)),
        'Password is incorrect',
      )
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const code = await createSignedPayload({
    typ: 'authorization_code',
    exp: now + authorizationCodeLifetimeSeconds,
    aud: url.origin,
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    resource: params.resource || mcpResourceUrl(url),
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    scope: params.scope || 'mcp',
  })

  const redirectUrl = new URL(params.redirect_uri)
  redirectUrl.searchParams.set('code', code)
  if (params.state) {
    redirectUrl.searchParams.set('state', params.state)
  }
  redirect(302, redirectUrl.toString())
}

const sha256Base64Url = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return base64UrlEncode(new Uint8Array(digest))
}

export const exchangeOAuthToken = async ({ request, url }: RequestEvent) => {
  const form = await request.formData()
  const grantType = String(form.get('grant_type') ?? '')
  if (grantType !== 'authorization_code') {
    return json({ error: 'unsupported_grant_type' }, { status: 400 })
  }

  const code = String(form.get('code') ?? '')
  const codeVerifier = String(form.get('code_verifier') ?? '')
  const redirectUri = String(form.get('redirect_uri') ?? '')
  const clientId = String(form.get('client_id') ?? '')
  const resource = String(form.get('resource') ?? mcpResourceUrl(url))
  const payload = await readSignedPayload(code, 'authorization_code')

  if (
    !payload ||
    payload.client_id !== clientId ||
    payload.redirect_uri !== redirectUri ||
    payload.resource !== resource ||
    payload.code_challenge !== (await sha256Base64Url(codeVerifier))
  ) {
    return json({ error: 'invalid_grant' }, { status: 400 })
  }

  const now = Math.floor(Date.now() / 1000)
  const accessToken = await createSignedPayload({
    typ: 'access_token',
    exp: now + tokenLifetimeSeconds,
    aud: mcpResourceUrl(url),
    scope: payload.scope ?? 'mcp',
    sub: 'owner',
  })

  return json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: tokenLifetimeSeconds,
      scope: payload.scope ?? 'mcp',
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
    },
  )
}
