import path from "node:path";
import { MedusaMcpClient } from "./client";

let instance: MedusaMcpClient | null = null;
let connecting: Promise<MedusaMcpClient> | null = null;

export async function getMcp(): Promise<MedusaMcpClient> {
  if (instance) return instance;
  if (connecting) return connecting;

  const serverEntry = path.resolve(process.cwd(), "..", "medusa-mcp", "dist", "index.js");
  const env: Record<string, string> = {
    ...process.env as any,
  };
  const client = new MedusaMcpClient({ serverEntry, cwd: path.dirname(serverEntry), env });
  connecting = client.connect().then(() => {
    instance = client;
    connecting = null;
    return client;
  });
  return connecting;
}

export async function closeMcp(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}
