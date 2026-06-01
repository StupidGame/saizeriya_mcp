import { json, type RequestHandler } from '@sveltejs/kit'
import { createAuthorizationServerMetadata } from '$lib/server/mcp-oauth'

export const GET: RequestHandler = ({ url }) => json(createAuthorizationServerMetadata(url))
