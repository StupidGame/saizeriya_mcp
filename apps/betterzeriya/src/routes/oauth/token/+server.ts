import type { RequestHandler } from '@sveltejs/kit'
import { exchangeOAuthToken } from '$lib/server/mcp-oauth'

export const POST: RequestHandler = (event) => exchangeOAuthToken(event)
