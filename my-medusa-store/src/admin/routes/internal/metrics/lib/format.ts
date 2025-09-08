export const formatMs = (v?: number) => (typeof v === "number" ? `${Math.round(v)} ms` : "");
export const timeStr = (ts: number) => new Date(ts).toLocaleTimeString();
export const numberOrDash = (v: unknown) => (typeof v === "number" && !Number.isNaN(v) ? String(v) : "—");
export function jsonPreview(v: unknown, max = 400) {
try {
const s = JSON.stringify(v, null, 2);
if (!s) return "";
return s.length > max ? s.slice(0, max) + "…" : s;
} catch {
return String(v ?? "");
}
}