/**
 * 自检用的最小 stdio MCP 服务器（换行分帧 JSON-RPC 2.0）。
 *
 * 只服务本目录的 dev 脚本（`gui-flow.mjs`、手工验证）：不随包发布，
 * 也不会被宿主加载。暴露 1 个 echo 工具 + 19 个填充工具：前者用来证明"能被连上、
 * 能列出工具"，后者让工具清单**肯定溢出**浮层的高度上限，好验收"浮层内可滚动"。
 *
 * 帧格式依据：@modelcontextprotocol/client/dist/src-D_zzAWoS.mjs
 *   serializeMessage(message) => JSON.stringify(message) + "\n"
 *   ReadBuffer.readMessage()   => 以 "\n" 切分
 */

const TOOLS = [
  {
    name: 'spike_echo',
    description: 'Echo back the provided text. Used only to prove a dynamically mounted MCP server reaches the tool registry.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'text to echo' } },
      required: ['text'],
      additionalProperties: false
    }
  },
  // 填充工具：只为把工具清单撑到溢出（验收浮层的换行与滚动），调用直接回显名字。
  ...Array.from({ length: 19 }, (unused, index) => {
    const name = `spike_filler_${String(index + 1).padStart(2, '0')}`
    return {
      name,
      description: `Filler tool ${name}, exposed so the tool list inside the hover tooltip overflows and can be scroll-tested.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    }
  })
]

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const reply = (id, result) => send({ jsonrpc: '2.0', id, result })

const handle = (message) => {
  const { id, method, params } = message
  if (method === 'initialize') {
    const requested = params?.protocolVersion
    reply(id, {
      protocolVersion: typeof requested === 'string' && requested.length > 0 ? requested : '2025-11-25',
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'dsh-mcp-spike', version: '0.0.1' },
      instructions: 'Spike server: exposes a single echo tool.'
    })
    return
  }
  if (method === 'notifications/initialized' || id === undefined || id === null) return
  if (method === 'ping') {
    reply(id, {})
    return
  }
  if (method === 'tools/list') {
    reply(id, { tools: TOOLS })
    return
  }
  if (method === 'tools/call') {
    const args = params?.arguments ?? {}
    reply(id, {
      content: [{ type: 'text', text: `spike echo: ${String(args.text ?? '')}` }]
    })
    return
  }
  if (method === 'resources/list') {
    reply(id, { resources: [] })
    return
  }
  if (method === 'resources/templates/list') {
    reply(id, { resourceTemplates: [] })
    return
  }
  send({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `method not found: ${String(method)}` }
  })
}

let buffered = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffered += chunk
  let index = buffered.indexOf('\n')
  while (index !== -1) {
    const line = buffered.slice(0, index).replace(/\r$/u, '')
    buffered = buffered.slice(index + 1)
    if (line.trim() !== '') {
      try {
        handle(JSON.parse(line))
      } catch (error) {
        process.stderr.write(`spike server: bad message: ${String(error)}\n`)
      }
    }
    index = buffered.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
