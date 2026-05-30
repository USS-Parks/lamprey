import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({
  name: 'mock-echo-server',
  version: '1.0.0'
})

server.tool('echo', { message: z.string() }, async ({ message }) => ({
  content: [{ type: 'text', text: `Echo: ${message}` }]
}))

server.tool('get_time', {}, async () => ({
  content: [{ type: 'text', text: new Date().toISOString() }]
}))

server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
  content: [{ type: 'text', text: String(a + b) }]
}))

const transport = new StdioServerTransport()
server.connect(transport).then(() => {
  console.error('[mock-mcp] Server started on stdio')
})
