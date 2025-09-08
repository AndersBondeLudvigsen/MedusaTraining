import type Medusa from "@medusajs/js-sdk";
import { withQuery } from "./query";

export type Http = {
  get<T>(path: string, query?: Record<string, unknown>): Promise<T>;
  post<T>(
    path: string,
    body?: any,
    query?: Record<string, unknown>
  ): Promise<T>;
  del<T>(path: string, query?: Record<string, unknown>): Promise<T>;
};

export function createHttp(sdk: Medusa, getToken: () => string | ""): Http {
  async function request<T>(
    method: "get" | "post" | "delete",
    path: string,
    { query, body }: any = {}
  ) {
    const url = withQuery(path, query ?? {});
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await (sdk as any).client.fetch(url, {
      method,
      headers,
      ...(body ? { body } : {}),
    });
    return res as T;
  }
  return {
    get: <T>(p: string, q?: Record<string, unknown>) =>
      request<T>("get", p, { query: q }),
    post: <T>(p: string, b?: unknown, q?: Record<string, unknown>) =>
      request<T>("post", p, { body: b, query: q }),
    del: <T>(p: string, q?: Record<string, unknown>) =>
      request<T>("delete", p, { query: q }),
  };
}
