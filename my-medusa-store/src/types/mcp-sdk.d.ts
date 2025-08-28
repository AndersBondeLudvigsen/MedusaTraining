declare module "@modelcontextprotocol/sdk/client/mcp.js" {
  export class McpClient {
    constructor(info: { name: string; version: string })
    connect(transport: any): Promise<void>
    callTool(args: { name: string; arguments?: any }): Promise<any>
    close(): Promise<void>
  }
}

declare module "@modelcontextprotocol/sdk/client/stdio.js" {
  export class StdioClientTransport {
    constructor(options: { command: string; args?: string[] })
    close(): Promise<void>
  }
}
