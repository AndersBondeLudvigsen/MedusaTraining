export function createTTLMap<K, V>(
    ttlMs: number,
    max = 5000
): {
    get: (k: K) => V | undefined;
    set: (k: K, v: V) => void;
    clear: () => void;
} {
    const m = new Map<K, { v: V; t: number }>();
    function get(k: K): V | undefined {
        const e = m.get(k);
        if (!e) {
            return undefined;
        }
        if (Date.now() - e.t > ttlMs) {
            m.delete(k);
            return undefined;
        }
        return e.v;
    }
    function set(k: K, v: V): void {
        if (m.size >= max) {
            m.delete(m.keys().next().value as K);
        }
        m.set(k, { v, t: Date.now() });
    }
    return { get, set, clear: () => m.clear() };
}
