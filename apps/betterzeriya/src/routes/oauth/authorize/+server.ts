import type { RequestHandler } from '@sveltejs/kit'
import { showAuthorizationPage, submitAuthorizationPage } from '$lib/server/mcp-oauth'

export const GET: RequestHandler = (event) => showAuthorizationPage(event)

export const POST: RequestHandler = (event) => submitAuthorizationPage(event)
