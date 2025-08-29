// TypeScript declarations to resolve MCP SDK subpath imports.
// At runtime, Node resolves these via the package "exports" field.
declare module "@modelcontextprotocol/sdk/client" {
  import type { Client as _Client } from "@modelcontextprotocol/sdk/dist/cjs/client/index.js";
  export const Client: typeof _Client;
}

declare module "@modelcontextprotocol/sdk/client/stdio" {
  import type { StdioClientTransport as _StdioClientTransport } from "@modelcontextprotocol/sdk/dist/cjs/client/stdio.js";
  export const StdioClientTransport: typeof _StdioClientTransport;
}
