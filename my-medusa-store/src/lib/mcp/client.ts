// Use package exported subpaths; resolves to CJS under require per package exports
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");

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
    this.client = new Client(
      { name: "my-medusa-store", version: "0.0.1" },
      {
        capabilities: { tools: {} },
      }
    );
  }

  async connect() {
    await this.client.connect(this.transport as any);
  }

  async listTools() {
    const started = Date.now();
    try {
      const res = await this.client.listTools({});
      return res;
    } finally {
      // We intentionally do not log listTools as a tool-call event to avoid noise
      void started;
    }
  }

  async callTool(name: string, args: Record<string, any>) {
    // Lazy import to avoid circular
    const { withToolLogging } = require("../metrics/store");
    return await withToolLogging(name, args, async () => {
      return await this.client.callTool({ name, arguments: args });
    });
  }

  async close() {
    await this.client.close();
  }
}
