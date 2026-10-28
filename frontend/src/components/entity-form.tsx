import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/auth";
import { api, ApiError, type EntityRecord, type Lookups } from "@/lib/api";
import type { Resource } from "@/lib/resources";
import { humanize, localDateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";
import { DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ErrorState, Loading } from "./feedback";
import { ProductSelect } from "./product-select";

type Values = Record<string, string | number | boolean>;
type Item = { productId: string; quantity: number };
type SavedItem = Item & { unitPrice: string | number };
export function savedItems(record?: EntityRecord): SavedItem[] {
  if (!Array.isArray(record?.items)) return [];
  return record.items.filter((item): item is SavedItem => typeof item === "object" && item !== null && typeof item.productId === "string" && typeof item.quantity === "number" && (typeof item.unitPrice === "string" || typeof item.unitPrice === "number"));
}

export function EntityForm({ resource, record, onClose, onSaved }: { resource: Resource; record?: EntityRecord; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [values, setValues] = useState<Values>(() => Object.fromEntries(resource.fields.map(field => {
    const existing = record?.[field.key];
    if (existing !== undefined && existing !== null) {
      if (field.type === "datetime-local") return [field.key, localDateTime(String(existing))];
      return [field.key, typeof existing === "boolean" || typeof existing === "number" ? existing : String(existing)];
    }
    if (field.type === "datetime-local") return [field.key, localDateTime(new Date().toISOString())];
    if (field.key === "ownerId" || field.key === "salespersonId") return [field.key, user?.id ?? ""];
    return [field.key, field.defaultValue ?? (field.type === "select" ? field.options?.[0] ?? "" : field.type === "checkbox" ? false : "")];
  })));
  const [items, setItems] = useState<Item[]>(() => savedItems(record).length ? savedItems(record).map(({ productId, quantity }) => ({ productId, quantity })) : [{ productId: "", quantity: 1 }]);
  const [lookups, setLookups] = useState<Lookups>();
  const [lookupError, setLookupError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const needsLookups = resource.key === "transactions" || resource.fields.some(field => field.lookup);
  useEffect(() => {
    if (!needsLookups) return;
    let active = true;
    setLookupError("");
    api<Lookups>("/lookups").then(data => { if (active) setLookups(data); }).catch(err => { if (active) setLookupError(err instanceof Error ? err.message : "Could not load linked records."); });
    return () => { active = false; };
  }, [needsLookups, attempt]);
  const set = (key: string, value: string | number | boolean) => {
    setValues(current => ({ ...current, [key]: value, ...(key === "customerId" && (resource.key === "activities" || resource.key === "transactions") ? { opportunityId: "" } : {}) }));
  };
  const price = (id: string) => Number(savedItems(record).find(i => i.productId === id)?.unitPrice ?? lookups?.products.find(p => p.id === id)?.price ?? 0);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(""); setFields({});
    try {
      const payload: Record<string, unknown> = {};
      for (const field of resource.fields) {
        const value = values[field.key];
        if (field.type === "product" && !value && !record?.productId && record?.interest) continue;
        if (field.type === "password" && record && !value) continue;
        if (field.type === "datetime-local") payload[field.key] = new Date(String(value)).toISOString();
        else if (field.type === "number") payload[field.key] = Number(value);
        else payload[field.key] = value === "" && !field.required ? null : value;
      }
      if (resource.key === "transactions") payload.items = items;
      await api(`/${resource.key}${record ? `/${record.id}` : ""}`, { method: record ? "PUT" : "POST", body: JSON.stringify(payload) });
      toast.success(`${humanize(resource.singular)} ${record ? "updated" : "created"} successfully.`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The record could not be saved.");
      if (err instanceof ApiError && err.fields) setFields(err.fields);
    } finally { setPending(false); }
  }
  return <DialogContent className={resource.key === "transactions" ? "max-w-2xl" : "max-w-xl"}>
    <DialogTitle>{record ? "Edit" : "New"} {resource.singular}</DialogTitle><DialogDescription>{record ? "Update the details below. Changes are shared with your team." : "A new connection starts with the details. Fields marked * are required."}</DialogDescription>
    {lookupError ? <div className="mt-5"><ErrorState error={lookupError} retry={() => setAttempt(n => n + 1)} /></div> : needsLookups && !lookups ? <Loading label="Loading available records..." /> : <form onSubmit={submit} className="mt-6">
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">{resource.fields.map(field => {
        const required = field.required && !(field.type === "password" && record);
        const value = values[field.key];
        const conversionLocked = resource.key === "leads" && ((field.key === "status" && record?.status === "CONVERTED") || (Boolean(record?.convertedAt) && ["ownerId", "customerId"].includes(field.key)));
        let options = field.lookup && lookups ? lookups[field.lookup] : [];
        if (field.lookup === "users") options = options.filter(option => option.active || option.id === value);
        if (field.lookup === "opportunities" && values.customerId) options = options.filter(option => option.customerId === values.customerId);
        return <div key={field.key} className={field.wide ? "sm:col-span-2" : ""}>
          <Label htmlFor={`field-${field.key}`}>{field.label}{required && <span className="ml-1 text-primary">*</span>}{field.type === "password" && record && <span className="ml-1 font-normal text-slate-400">(leave blank to keep)</span>}</Label>
          <div className="mt-1.5">
            {field.type === "product" ? <>
              <ProductSelect id={`field-${field.key}`} value={String(value ?? "")} products={lookups?.products ?? []} disabled={pending}
                onChange={productId => set(field.key, productId)} />
              {!record?.productId && Boolean(record?.interest) && <p className="mt-1 text-[10px] text-slate-500">Previous interest: {String(record?.interest)}. Select a catalog product to replace it; otherwise it is preserved.</p>}
            </> : field.type === "textarea" ? <textarea id={`field-${field.key}`} className="field min-h-20" maxLength={2000} value={String(value ?? "")} onChange={e => set(field.key, e.target.value)} placeholder={field.placeholder} /> :
              field.type === "checkbox" ? <label className="flex h-10 items-center gap-2 text-xs text-slate-500"><input id={`field-${field.key}`} type="checkbox" className="size-4 accent-blue-600" checked={Boolean(value)} onChange={e => set(field.key, e.target.checked)} />{Boolean(value) ? "Enabled" : "Disabled"}</label> :
              field.type === "select" || field.type === "reference" ? <select id={`field-${field.key}`} className="field" required={required} disabled={conversionLocked} value={String(value ?? "")} onChange={e => set(field.key, e.target.value)}>
                {field.type === "reference" && <option value="">{required ? "Select an option" : "None"}</option>}
                {field.type === "select" ? field.options?.filter(option => resource.key !== "leads" || field.key !== "status" || option !== "CONVERTED" || record?.status === "CONVERTED").map(option => <option key={option} value={option}>{option ? humanize(option) : "Unassigned"}</option>) : options.map(option => <option key={option.id} value={option.id}>{option.name}{option.active === false ? " (inactive)" : ""}</option>)}
              </select> :
                <Input id={`field-${field.key}`} type={field.type ?? "text"} required={required} min={field.min} max={field.max} step={field.step ?? (field.type === "number" ? 1 : undefined)} minLength={field.type === "password" ? 12 : undefined} maxLength={field.type === "password" ? 72 : field.type === "email" ? 254 : field.type === "tel" ? 30 : field.key === "address" || field.key === "interest" || field.key === "title" ? 2000 : 150} value={String(value ?? "")} onChange={e => set(field.key, e.target.value)} placeholder={field.placeholder} autoComplete={field.type === "password" ? "new-password" : undefined} />}
          </div>{fields[field.key]?.map(message => <p key={message} className="mt-1 text-xs text-red-600">{message}</p>)}
        </div>;
      })}</div>
      {resource.key === "transactions" && <section className="mt-6 border-t pt-5">
        <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Products <span className="text-primary">*</span></h3><Button type="button" variant="outline" size="sm" disabled={items.length >= 50} onClick={() => setItems(current => [...current, { productId: "", quantity: 1 }])}><Plus />Add item</Button></div>
        <div className="space-y-3">{items.map((item, index) => <div key={index} className="rounded-md border bg-slate-50/50 p-3">
          <div className="flex items-start gap-2"><div className="flex-1"><Label htmlFor={`product-${index}`}>Product</Label><select id={`product-${index}`} className="field mt-1" required value={item.productId} onChange={e => setItems(current => current.map((row, i) => i === index ? { ...row, productId: e.target.value } : row))}><option value="">Select a product</option>{lookups?.products.filter(p => p.active || savedItems(record).some(old => old.productId === p.id)).map(product => <option key={product.id} value={product.id} disabled={items.some((row, i) => i !== index && row.productId === product.id)}>{product.name} ({product.stock} in stock)</option>)}</select></div><div className="w-16 shrink-0"><Label htmlFor={`quantity-${index}`}>Qty</Label><Input id={`quantity-${index}`} className="mt-1 px-2" type="number" min={1} max={1000} required value={item.quantity || ""} onChange={e => setItems(current => current.map((row, i) => i === index ? { ...row, quantity: Number(e.target.value) } : row))} /></div><Button type="button" variant="ghost" size="icon" className="mt-6 shrink-0 text-slate-400 hover:text-red-500" aria-label={`Remove item ${index + 1}`} disabled={items.length === 1} onClick={() => setItems(current => current.filter((_, i) => i !== index))}><Trash2 /></Button></div>
          {item.productId && <div className="mt-2 flex justify-between text-[11px] text-slate-500"><span>{money(price(item.productId))} per unit</span><span className="font-medium text-slate-700">{money(price(item.productId) * item.quantity)}</span></div>}
        </div>)}</div>
        <div className="mt-4 flex justify-between rounded-md bg-blue-50 p-3 text-sm font-semibold"><span>Total (IDR)</span><span>{money(items.reduce((sum, item) => sum + price(item.productId) * item.quantity, 0))}</span></div>
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">Totals are verified by the server. Existing items retain their original price. Completed sales reduce stock; cancelling or deleting them restores it. Pending sales do not reserve stock.</p>
        {fields.items?.map(message => <p key={message} className="mt-1 text-xs text-red-600">{message}</p>)}
      </section>}
      {error && <div role="alert" className="mt-5 flex gap-2 rounded-md bg-red-50 p-3 text-sm text-red-600"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div>}
      <div className="mt-6 flex justify-end gap-2 border-t pt-5"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{record ? "Save changes" : `Create ${resource.singular}`}</Button></div>
    </form>}
  </DialogContent>;
}
