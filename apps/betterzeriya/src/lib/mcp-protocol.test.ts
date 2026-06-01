import { describe, expect, it } from 'vite-plus/test'
import {
  createMcpToolResult,
  handleMcpMessage,
  mcpProtocolVersion,
  type McpToolDefinition,
} from './mcp-protocol'

const tools: McpToolDefinition[] = [
  {
    name: 'echo',
    title: 'Echo',
    description: 'Echo arguments',
    inputSchema: {
      type: 'object',
      additionalProperties: true,
    },
  },
]

describe('mcp protocol', () => {
  it('initializes with tool capability', async () => {
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: mcpProtocolVersion,
        },
      },
      tools,
      async () => ({}),
    )

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: mcpProtocolVersion,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      },
    })
  })

  it('does not respond to notifications', async () => {
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      },
      tools,
      async () => ({}),
    )

    expect(response).toBeNull()
  })

  it('accepts JSON-RPC responses without a reply', async () => {
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 'client-response',
        result: {},
      },
      tools,
      async () => ({}),
    )

    expect(response).toBeNull()
  })

  it('lists tools and calls a tool with structured content', async () => {
    const listResponse = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 'tools',
        method: 'tools/list',
      },
      tools,
      async () => ({}),
    )
    expect(listResponse).toMatchObject({
      result: {
        tools,
      },
    })

    const callResponse = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 'call',
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: {
            value: 'ok',
          },
        },
      },
      tools,
      async (_name, args) => args,
    )

    expect(callResponse).toMatchObject({
      result: createMcpToolResult({
        value: 'ok',
      }),
    })
  })

  it('returns tool errors as MCP tool results', async () => {
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 'call',
        method: 'tools/call',
        params: {
          name: 'echo',
        },
      },
      tools,
      async () => {
        throw new Error('snap')
      },
    )

    expect(response).toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          error: 'snap',
        },
      },
    })
  })
})
