import { useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Lookup } from "@/lib/api";
import { Input } from "./ui/input";

export function ProductSelect({ id, value, products, disabled, onChange }: {
  id: string; value: string; products: Lookup[]; disabled?: boolean; onChange: (value: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = products.find(product => product.id === value);
  const matches = products.filter(product => (product.active !== false || product.id === value) &&
    product.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const options = [{ id: "", name: "None" }, ...matches];
  const choose = (productId: string) => {
    onChange(productId); setOpen(false); trigger.current?.focus();
  };
  return <div className="relative" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} id={id} type="button" className="field flex items-center justify-between gap-2 text-left"
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} disabled={disabled}
      onClick={() => { setOpen(!open); setQuery(""); setActive(0); }}>
      <span className="truncate">{selected ? `${selected.name}${selected.active === false ? " (inactive)" : ""}` : "Select product"}</span>
      <ChevronDown className="size-4 shrink-0 text-slate-400" />
    </button>
    {open && <div className="absolute left-0 right-0 z-50 mt-1 rounded-lg border bg-white p-2 shadow-lg">
      <Input autoFocus role="combobox" aria-label="Search products" placeholder="Search products..."
        aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const next = event.key === "ArrowDown" ? Math.min(active + 1, options.length - 1) : Math.max(active - 1, 0);
            setActive(next);
            document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
          }
          if (event.key === "Enter") { event.preventDefault(); if (options[active]) choose(options[active].id); }
        }} />
      <ul id={listId} role="listbox" aria-label="Products" className="mt-1 max-h-48 overflow-y-auto">
        {options.map((product, index) => <li key={product.id} id={`${listId}-${index}`} role="option"
          aria-selected={value === product.id}
          className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-xs ${active === index ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50"}`}
          onMouseDown={event => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => choose(product.id)}>
          <span>{product.name}{product.active === false ? " (inactive)" : ""}</span>
          {value === product.id && <Check className="size-3 shrink-0" />}
        </li>)}
      </ul>
      {!matches.length && <p role="status" className="px-2 py-2 text-xs text-slate-500">No matching products.</p>}
    </div>}
  </div>;
}
