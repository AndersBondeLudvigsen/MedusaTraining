// Lazy-load the MCP SDK at runtime to avoid startup failures if not installed yet
type SDK = {
  McpClient: new (info: { name: string; version: string }) => any
  StdioClientTransport: new (opts: { command: string; args?: string[] }) => any
}

async function loadSdk(): Promise<SDK> {
  try {
    // CommonJS resolution
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mcp = require("@modelcontextprotocol/sdk/client/mcp.js")
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const stdio = require("@modelcontextprotocol/sdk/client/stdio.js")
    return { McpClient: mcp.McpClient, StdioClientTransport: stdio.StdioClientTransport }
  } catch (e) {
    throw new Error(
      "@modelcontextprotocol/sdk is not installed. Please run `npm install @modelcontextprotocol/sdk --save` in my-medusa-store."
    )
  }
}

export type McpSession = {
  client: any
  transport: any
  dispose: () => Promise<void>
}

function parseCommand(bin: string): { command: string; args: string[] } {
  let raw = bin.trim()
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1)
  }
  const lower = raw.toLowerCase()
  if (lower.startsWith("node ") || lower.startsWith("node.exe ")) {
    const firstSpace = raw.indexOf(" ")
    const cmd = raw.slice(0, firstSpace)
    let rest = raw.slice(firstSpace + 1).trim()
    if ((rest.startsWith('"') && rest.endsWith('"')) || (rest.startsWith("'") && rest.endsWith("'"))) {
      rest = rest.slice(1, -1)
    }
    return { command: cmd, args: [rest] }
  }
  const firstSpace = raw.indexOf(" ")
  if (firstSpace === -1) {
    return { command: raw, args: [] }
  }
  return { command: raw.slice(0, firstSpace), args: [raw.slice(firstSpace + 1)] }
}

export async function connectMcp(): Promise<McpSession> {
  const bin = process.env.MCP_BIN
  if (!bin) {
    throw new Error("MCP_BIN is not set")
  }
  const { McpClient, StdioClientTransport } = await loadSdk()
  const { command, args } = parseCommand(bin)
  const transport = new StdioClientTransport({ command, args })
  const client = new McpClient({ name: "medusa-ask-ai", version: "0.1.0" })
  await client.connect(transport)

  const dispose = async () => {
    try {
      await client.close()
    } finally {
      await transport.close()
    }
  }

  return { client, transport, dispose }
}

export async function callTool(session: McpSession, name: string, input: any) {
  const resp = await session.client.callTool({ name, arguments: input })
  // Extract first text content part
  const text = resp.content?.find((c: any) => c.type === "text")?.text || ""
  return { raw: resp, text }
}
