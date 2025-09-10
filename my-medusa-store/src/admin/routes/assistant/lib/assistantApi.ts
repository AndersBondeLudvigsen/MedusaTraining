import { z } from "zod";
import type { AssistantResponse } from "../types";


const ChartSpecSchema = z.any(); // if you have a stricter ChartSpec, swap it in


const AssistantResponseSchema = z.object({
answer: z.string().default(""),
chart: ChartSpecSchema.nullish(),
});


export type AskPayload = {
prompt: string;
wantsChart: boolean;
chartType: "bar" | "line";
chartTitle?: string;
};


export async function askAssistant(payload: AskPayload): Promise<AssistantResponse> {
const res = await fetch("/assistant", {
method: "POST",
headers: { "Content-Type": "application/json" },
credentials: "include",
body: JSON.stringify(payload),
});


const json = await res.json().catch(() => ({}));
if (!res.ok) {
const msg = (json && json.error) ? String(json.error) : `Request failed with ${res.status}`;
throw new Error(msg);
}


const parsed = AssistantResponseSchema.safeParse(json);
if (!parsed.success) {
throw new Error("Invalid response from server");
}


return parsed.data;
}