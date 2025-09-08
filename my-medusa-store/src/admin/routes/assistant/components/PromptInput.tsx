import type { Category } from "../types";


function getPlaceholder(category: Category) {
switch (category) {
case "customers":
return 'Ask about customers (e.g. "How many new customers did we get this month?" or "Show me customer demographics")';
case "orders":
return 'Ask about orders (e.g. "How many orders do I have in 2025, grouped by month?" or "What is my average order value?")';
case "products":
return 'Ask about products (e.g. "Which products are my best sellers?" or "Show me products with low inventory")';
case "promotions":
return 'Ask about promotions (e.g. "How effective were my recent promotions?" or "Show me discount usage statistics")';
default:
return 'Ask the assistant (e.g. "How many orders do I have in 2025, grouped by month?")';
}
}


export function PromptInput({ value, onChange, category, onSubmit }: {
value: string;
onChange: (v: string) => void;
category: Category;
onSubmit: () => void;
}) {
return (
<textarea
value={value}
onChange={(e) => onChange(e.target.value)}
onKeyDown={(e) => {
if (e.key === "Enter" && !e.shiftKey) {
e.preventDefault();
onSubmit();
}
}}
placeholder={getPlaceholder(category)}
rows={4}
className="border-ui-border-base bg-ui-bg-base text-ui-fg-base rounded-md border p-2"
/>
);
}