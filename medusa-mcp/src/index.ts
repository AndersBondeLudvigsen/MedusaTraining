import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// 1. Remove the MedusaStoreService import
// import MedusaStoreService from "./services/medusa-store"; 
import MedusaAdminService from "./services/medusa-admin";

async function main(): Promise<void> {
    // 2. Update the startup message for clarity
    console.error("Starting Medusa Admin MCP Server...");

    // 3. Remove the store service and related logic
    const medusaAdminService = new MedusaAdminService();
    let tools = [];
    try {
        await medusaAdminService.init();

        // 4. Load tools exclusively from the admin service
        tools = medusaAdminService.defineTools();
    } catch (error) {
        // 5. Update error handling to be specific to the admin service
        console.error("Fatal Error: Could not initialize Medusa Admin Services:", error);
        process.exit(1);
    }

    const server = new McpServer(
        {
            // 6. Rename the server to reflect its purpose
            name: "Medusa Admin MCP Server",
            version: "1.0.0"
        },
        {
            capabilities: {
                tools: {}
            }
        }
    );

    tools.forEach((tool) => {
        server.tool(
            tool.name,
            tool.description,
            tool.inputSchema,
            tool.handler
        );
    });

    const transport = new StdioServerTransport();
    console.error("Connecting server to transport...");
    await server.connect(transport);

    console.error("Medusajs MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});