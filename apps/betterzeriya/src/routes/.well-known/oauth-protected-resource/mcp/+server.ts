import { json, type RequestHandler } from '@sveltejs/kit'
import { createProtectedResourceMetadata } from '$lib/server/mcp-oauth'

export const GET: RequestHandler = ({ url }) => json(createProtectedResourceMetadata(url))
