export const mcpProtocolVersion = '2025-06-18'

type JsonRpcId = string | number | null

type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: unknown
}

type JsonRpcError = {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcResponse =
  | {
      jsonrpc: '2.0'
      id: JsonRpcId
      result: unknown
    }
  | {
      jsonrpc: '2.0'
      id: JsonRpcId
      error: JsonRpcError
    }

export type McpToolDefinition = {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export type McpToolCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>

const serverInfo = {
  name: 'betterzeriya',
  title: 'Betterzeriya MCP',
  version: '0.1.0',
}

const protocolError = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const getId = (message: JsonRpcRequest): JsonRpcId =>
  typeof message.id === 'string' || typeof message.id === 'number' || message.id === null
    ? message.id
    : null

export const createJsonRpcError = (
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: {
    code,
    message,
    ...(data === undefined ? {} : { data }),
  },
})

export const createParseError = (message = 'Parse error') =>
  createJsonRpcError(null, protocolError.parseError, message)

const createJsonRpcResult = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
})

export const createMcpToolResult = (
  structuredContent: Record<string, unknown>,
  isError = false,
): McpToolResult => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(structuredContent, null, 2),
    },
  ],
  structuredContent,
  ...(isError ? { isError: true } : {}),
})

const invalidParams = (id: JsonRpcId, message: string) =>
  createJsonRpcError(id, protocolError.invalidParams, message)

export const handleMcpMessage = async (
  message: unknown,
  tools: McpToolDefinition[],
  callTool: McpToolCaller,
): Promise<JsonRpcResponse | null> => {
  if (!isRecord(message) || Array.isArray(message)) {
    return createJsonRpcError(null, protocolError.invalidRequest, 'Expected a JSON-RPC object')
  }

  const request = message as JsonRpcRequest
  const id = getId(request)

  if (
    request.jsonrpc === '2.0' &&
    !('method' in request) &&
    ('result' in request || 'error' in request)
  ) {
    return null
  }

  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return createJsonRpcError(id, protocolError.invalidRequest, 'Invalid JSON-RPC request')
  }

  if (!('id' in request)) {
    return null
  }

  switch (request.method) {
    case 'initialize':
      return createJsonRpcResult(id, {
        protocolVersion: mcpProtocolVersion,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo,
        instructions:
          'Use start_order_session with a Saizeriya QR URL first. Preserve officialSession from each tool result and pass it to later session tools.',
      })

    case 'ping':
      return createJsonRpcResult(id, {})

    case 'tools/list':
      return createJsonRpcResult(id, { tools })

    case 'tools/call': {
      if (!isRecord(request.params) || typeof request.params.name !== 'string') {
        return invalidParams(id, 'Tool name is required')
      }
      const params = request.params
      const toolName = params.name as string
      const args = isRecord(params.arguments) ? params.arguments : {}
      if (!tools.some((tool) => tool.name === toolName)) {
        return invalidParams(id, `Unknown tool: ${toolName}`)
      }

      try {
        return createJsonRpcResult(id, createMcpToolResult(await callTool(toolName, args)))
      } catch (error) {
        return createJsonRpcResult(
          id,
          createMcpToolResult(
            {
              error: error instanceof Error ? error.message : 'Tool call failed',
            },
            true,
          ),
        )
      }
    }

    default:
      return createJsonRpcError(id, protocolError.methodNotFound, 'Method not found')
  }
}
