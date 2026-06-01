import defaultMenuData from '$lib/assets/data/menu.json'
import { matchesMenuSearch } from '$lib/menu-search'
import {
  callOfficialStaff,
  createOfficialSession,
  getOfficialAccount,
  getOfficialState,
  lookupOfficialItem,
  parseOfficialSessionSnapshot,
  serializeState,
  setOfficialPeopleCount,
  showOfficialReceipt,
  submitOfficialCart,
  type OfficialSessionSnapshot,
} from '$lib/server/official-client'
import type { McpToolDefinition } from '$lib/mcp-protocol'

type MenuEntry = {
  code?: string
  name?: string
  kana?: string
  price?: number
  category?: string
  tags?: string[]
  imageUrl?: string | null
}

const objectSchema = {
  type: 'object',
  additionalProperties: true,
} as const

const sessionArgsSchema = {
  officialSession: {
    ...objectSchema,
    description: 'The officialSession object returned by start_order_session or a later tool call.',
  },
  sessionId: {
    type: 'string',
    description: 'Optional when officialSession.id is present.',
  },
} as const

export const mcpTools: McpToolDefinition[] = [
  {
    name: 'search_menu',
    title: 'Search menu',
    description: 'Search the bundled Betterzeriya menu by code, name, category, or tag.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Menu search text. Empty returns popular seed items.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'start_order_session',
    title: 'Start order session',
    description: 'Create a Saizeriya ordering session from a table QR URL.',
    inputSchema: {
      type: 'object',
      properties: {
        qrURLSource: { type: 'string', description: 'The Saizeriya QR URL from the table.' },
        peopleCount: { type: 'integer', minimum: 1, maximum: 99 },
      },
      required: ['qrURLSource'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'get_session_state',
    title: 'Get session state',
    description: 'Read the current ordering session state.',
    inputSchema: {
      type: 'object',
      properties: sessionArgsSchema,
      required: ['officialSession'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'set_people_count',
    title: 'Set people count',
    description: 'Set the people count for a Saizeriya ordering session.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sessionArgsSchema,
        peopleCount: { type: 'integer', minimum: 1, maximum: 99 },
      },
      required: ['officialSession', 'peopleCount'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'lookup_item',
    title: 'Lookup item',
    description: 'Look up a 4 digit item code against the active Saizeriya session.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sessionArgsSchema,
        code: { type: 'string', pattern: '^\\d{4}$' },
      },
      required: ['officialSession', 'code'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'submit_order',
    title: 'Submit order',
    description: 'Submit a cart to the official ordering session.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sessionArgsSchema,
        cart: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', pattern: '^\\d{4}$' },
              count: { type: 'integer', minimum: 1, maximum: 99 },
            },
            required: ['id', 'count'],
            additionalProperties: false,
          },
        },
      },
      required: ['officialSession', 'cart'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'get_account',
    title: 'Get account',
    description: 'Load the current account summary for a Saizeriya ordering session.',
    inputSchema: {
      type: 'object',
      properties: sessionArgsSchema,
      required: ['officialSession'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'show_receipt',
    title: 'Show receipt',
    description: 'Show receipt and checkout barcode data for a Saizeriya ordering session.',
    inputSchema: {
      type: 'object',
      properties: sessionArgsSchema,
      required: ['officialSession'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'call_staff',
    title: 'Call staff',
    description: 'Call restaurant staff for the active Saizeriya ordering session.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sessionArgsSchema,
        after: {
          type: 'boolean',
          default: false,
          description: 'Use true for dessert timing, false for a normal staff call.',
        },
      },
      required: ['officialSession'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
]

const menuItems = (defaultMenuData as MenuEntry[])
  .map((entry) => ({
    code: String(entry.code ?? '').trim(),
    name: String(entry.name ?? '').trim(),
    kana: String(entry.kana ?? entry.name ?? '').trim(),
    price: Number(entry.price ?? 0),
    category: String(entry.category ?? '').trim(),
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    imageUrl: entry.imageUrl ?? null,
  }))
  .filter((item) => /^\d{4}$/.test(item.code) && item.name)

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

const getString = (args: Record<string, unknown>, name: string) => {
  const value = args[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

const getOptionalInteger = (
  args: Record<string, unknown>,
  name: string,
  min: number,
  max: number,
) => {
  if (args[name] === undefined) {
    return undefined
  }
  const value = Number(args[name])
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

const getSessionArgs = (args: Record<string, unknown>) => {
  const officialSession = parseOfficialSessionSnapshot(args.officialSession)
  if (!officialSession) {
    throw new Error('officialSession from start_order_session is required')
  }

  const sessionId =
    typeof args.sessionId === 'string' && args.sessionId.trim()
      ? args.sessionId.trim()
      : officialSession.id
  return { sessionId, officialSession }
}

const createSessionPayload = (
  id: string,
  state: unknown,
  officialSession: OfficialSessionSnapshot,
) => ({
  sessionId: id,
  state,
  officialSession,
})

const searchMenu = (args: Record<string, unknown>) => {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const limit = getOptionalInteger(args, 'limit', 1, 50) ?? 10
  const matched = query ? menuItems.filter((item) => matchesMenuSearch(item, query)) : menuItems

  return {
    query,
    count: matched.length,
    items: matched.slice(0, limit),
  }
}

const startOrderSession = async (args: Record<string, unknown>) => {
  const qrURLSource = getString(args, 'qrURLSource')
  if (!URL.canParse(qrURLSource)) {
    throw new Error('qrURLSource must be a valid URL')
  }

  const peopleCount = getOptionalInteger(args, 'peopleCount', 1, 99)
  const session = await createOfficialSession(qrURLSource)

  if (peopleCount === undefined) {
    return createSessionPayload(session.id, serializeState(session.state), session.officialSession)
  }

  const updated = await setOfficialPeopleCount(session.id, peopleCount, session.officialSession)
  return createSessionPayload(session.id, serializeState(updated.state), updated.officialSession)
}

const getState = async (args: Record<string, unknown>) => {
  const { sessionId, officialSession } = getSessionArgs(args)
  const result = await getOfficialState(sessionId, officialSession)
  return createSessionPayload(sessionId, serializeState(result.state), result.officialSession)
}

const setPeopleCount = async (args: Record<string, unknown>) => {
  const { sessionId, officialSession } = getSessionArgs(args)
  const peopleCount = getOptionalInteger(args, 'peopleCount', 1, 99)
  if (peopleCount === undefined) {
    throw new Error('peopleCount is required')
  }

  const result = await setOfficialPeopleCount(sessionId, peopleCount, officialSession)
  return createSessionPayload(sessionId, serializeState(result.state), result.officialSession)
}

const lookupItem = async (args: Record<string, unknown>) => {
  const { sessionId, officialSession } = getSessionArgs(args)
  const code = getString(args, 'code')
  if (!/^\d{4}$/.test(code)) {
    throw new Error('code must be 4 digits')
  }

  const result = await lookupOfficialItem(sessionId, code, officialSession)
  return {
    sessionId,
    ...result.result,
    officialSession: result.officialSession,
  }
}

const submitOrder = async (args: Record<string, unknown>) => {
  const { sessionId, officialSession } = getSessionArgs(args)
  const cart = Array.isArray(args.cart) ? args.cart : []
  if (cart.length === 0) {
    throw new Error('cart must include at least one item')
  }

  const normalizedCart = cart.map((item) => {
    const entry = asRecord(item)
    const id = getString(entry, 'id')
    const count = getOptionalInteger(entry, 'count', 1, 99) ?? 1
    if (!/^\d{4}$/.test(id)) {
      throw new Error('cart item id must be 4 digits')
    }
    return { id, count }
  })

  const result = await submitOfficialCart(sessionId, normalizedCart, officialSession)
  return createSessionPayload(sessionId, serializeState(result.state), result.officialSession)
}

const getAccount = async (args: Record<string, unknown>) => {
  const { sessionId, officialSession } = getSessionArgs(args)
  const result = await getOfficialAccount(sessionId, officialSession)
  return {
    sessionId,
    ...result,
  }
}

const showReceipt = async (args: Record<string, unknown>) => {
  const { sessionId, officialSession } = getSessionArgs(args)
  const result = await showOfficialReceipt(sessionId, officialSession)
  return {
    sessionId,
    ...result,
  }
}

const callStaff = async (args: Record<string, unknown>) => {
  const { sessionId, officialSession } = getSessionArgs(args)
  const result = await callOfficialStaff(sessionId, args.after === true, officialSession)
  return {
    sessionId,
    ...result,
  }
}

export const callMcpTool = async (name: string, args: Record<string, unknown>) => {
  switch (name) {
    case 'search_menu':
      return searchMenu(args)
    case 'start_order_session':
      return await startOrderSession(args)
    case 'get_session_state':
      return await getState(args)
    case 'set_people_count':
      return await setPeopleCount(args)
    case 'lookup_item':
      return await lookupItem(args)
    case 'submit_order':
      return await submitOrder(args)
    case 'get_account':
      return await getAccount(args)
    case 'show_receipt':
      return await showReceipt(args)
    case 'call_staff':
      return await callStaff(args)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
