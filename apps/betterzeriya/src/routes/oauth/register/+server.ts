import type { RequestHandler } from '@sveltejs/kit'
import { registerOAuthClient } from '$lib/server/mcp-oauth'

export const POST: RequestHandler = (event) => registerOAuthClient(event)
