// Use package exported subpaths; resolves to CJS under require per package exports
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

export type McpClientOptions = {
  /** Absolute path to Node executable, defaults to `process.execPath` */
  nodePath?: string;
  /** Absolute path to built medusa-mcp dist/index.js */
  serverEntry: string;
  /** Working directory for the server process */
  cwd?: string;
  /** Extra environment variables */
  env?: Record<string, string>;
};

export class MedusaMcpClient {
  private client: any;
  private transport: any;

  constructor(private opts: McpClientOptions) {
    const command = opts.nodePath ?? process.execPath;
    const args = [opts.serverEntry];
    this.transport = new StdioClientTransport({
      command,
      args,
      cwd: opts.cwd,
      env: opts.env,
      stderr: "inherit",
    });
  this.client = new Client({ name: "my-medusa-store", version: "0.0.1" }, {
      capabilities: { tools: {} },
    });
  }

  async connect() {
    await this.client.connect(this.transport as any);
  }

  async listTools() {
    return await this.client.listTools({});
  }

  async callTool(name: string, args: Record<string, any>) {
    return await this.client.callTool({ name, arguments: args });
  }

  async close() {
    await this.client.close();
  }
}
