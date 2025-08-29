# Assistant API

POST /assistant

Body:
- prompt: string (optional)
- tool: string (optional) – if provided, calls the tool by name
- args: object (optional) – arguments to pass to the tool

This endpoint connects to the medusa-mcp server via Model Context Protocol (stdio) and lists available tools or calls a selected tool. It returns a friendly `answer` when the tool responds with text.

Ensure medusa-mcp is built (dist/index.js) and reachable relative to this project (../medusa-mcp/dist/index.js).
