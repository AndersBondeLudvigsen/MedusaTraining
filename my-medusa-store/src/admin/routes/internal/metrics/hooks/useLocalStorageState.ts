import { useEffect, useState } from "react";


export function useLocalStorageState<T>(key: string, initial: T) {
const [state, setState] = useState<T>(() => {
try {
const raw = localStorage.getItem(key);
if (raw == null) return initial;
return JSON.parse(raw) as T;
} catch {
try {
return (localStorage.getItem(key) as unknown as T) ?? initial;
} catch {
return initial;
}
}
});


useEffect(() => {
try {
const value = typeof state === "string" ? (state as string) : JSON.stringify(state);
if (value === undefined || value === "") {
localStorage.removeItem(key);
} else {
localStorage.setItem(key, value);
}
} catch {}
}, [key, state]);


return [state, setState] as const;
}