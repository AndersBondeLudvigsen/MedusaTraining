import type { Category } from "../types";


export function CategorySelect({ value, onChange }: { value: Category; onChange: (c: Category) => void; }) {
return (
<div className="flex items-center gap-2">
<label htmlFor="category-select" className="text-ui-fg-subtle font-medium">Category:</label>
<select
id="category-select"
value={value}
onChange={(e) => onChange(e.target.value as Category)}
className="rounded-md border border-ui-border-base bg-ui-bg-base text-ui-fg-base px-3 py-2 min-w-[150px]"
>
<option value="">Select a category</option>
<option value="customers">Customers</option>
<option value="orders">Orders</option>
<option value="products">Products</option>
<option value="promotions">Promotions</option>
</select>
</div>
);
}