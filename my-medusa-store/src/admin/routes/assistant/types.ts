import type { ChartSpec } from "./ChartRenderer"; // keep your existing type


export type Category = "" | "customers" | "orders" | "products" | "promotions";


export interface AssistantResponse {
answer: string;
chart?: ChartSpec | null;
}