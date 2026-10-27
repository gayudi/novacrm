import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type EntityRecord, type PageResult } from "@/lib/api";
import { getValue } from "@/lib/resources";
import { humanize } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { ErrorState, Loading } from "./feedback";

export function LeadConversionAction({ lead, onConvert }: { lead: EntityRecord; onConvert: (lead: EntityRecord) => void }) {
  const opportunityId = getValue(lead, "convertedOpportunity.id");
  if (typeof opportunityId === "string") return <Button asChild variant="outline" size="sm"><Link to={`/opportunities?record=${encodeURIComponent(opportunityId)}`}><ArrowUpRight />Lihat opportunity</Link></Button>;
  if (lead.convertedAt) return null;
  if (lead.status !== "QUALIFIED" && lead.status !== "CONVERTED") return null;
  return <Button variant="outline" size="sm" onClick={() => onConvert(lead)} aria-label={`Konversi ${String(lead.name)}`}><ArrowUpRight />{lead.status === "CONVERTED" ? "Konversi lead lama" : "Convert to Opportunity"}</Button>;
}

export function LeadConversionDialog({ lead, onClose, onConverted }: {
  lead: EntityRecord; onClose: () => void; onConverted: (opportunityId: string) => void;
}) {
  const legacy = lead.status === "CONVERTED";
  const [mode, setMode] = useState(lead.customerId ? "existing" : "new");
  const [customerId, setCustomerId] = useState(String(lead.customerId ?? ""));
  const [customerName, setCustomerName] = useState(String(getValue(lead, "customer.name") ?? ""));
  const [city, setCity] = useState(lead.branch ? humanize(String(lead.branch)) : "");
  const [name, setName] = useState(`${lead.interest || "Penawaran"} - ${lead.name}`.slice(0, 150));
  const [value, setValue] = useState("");
  const [probability, setProbability] = useState("20");
  const [closeDate, setCloseDate] = useState("");
  const [confirmLegacy, setConfirmLegacy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<PageResult>();
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (mode !== "existing") return;
    const controller = new AbortController();
    setLoading(true); setLookupError("");
    const qs = new URLSearchParams({ search: query, page: String(page), pageSize: "5" });
    api<PageResult>(`/leads/${encodeURIComponent(lead.id)}/conversion-customers?${qs}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setCustomers(data); })
      .catch(err => { if (!controller.signal.aborted) setLookupError(err instanceof Error ? err.message : "Customer tidak dapat dimuat."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [lead.id, mode, query, page, attempt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (mode === "existing" && !customerId) { setError("Pilih customer terlebih dahulu."); return; }
    setPending(true);
    try {
      const result = await api<{ opportunity: { id: string } }>(`/leads/${encodeURIComponent(lead.id)}/convert`, {
        method: "POST",
        body: JSON.stringify({
          expectedUpdatedAt: lead.updatedAt, confirmLegacy,
          customer: mode === "existing" ? { mode, customerId } : { mode, city },
          opportunity: { name, value: Number(value), probability: Number(probability), expectedCloseDate: new Date(closeDate).toISOString() },
        }),
      });
      toast.success("Lead berhasil dikonversi. Opportunity siap ditindaklanjuti.");
      onConverted(result.opportunity.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Konversi gagal. Periksa data dan coba lagi."); }
    finally { setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent className="max-w-2xl" onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
      <DialogTitle>{legacy ? "Konversi lead lama" : "Convert to Opportunity"}</DialogTitle>
      <DialogDescription>Periksa customer dan lengkapi penawaran. Satu lead hanya dapat dikonversi sekali.</DialogDescription>
      <form onSubmit={submit} className="mt-5 space-y-5">
        <fieldset disabled={pending} className="min-w-0 space-y-5">
          <div className="rounded-lg bg-blue-50 p-3 text-xs leading-6 text-slate-600">
            <p className="font-semibold text-slate-800">{String(lead.name)}</p>
            <p className="break-words">{String(lead.phone)}{lead.email ? ` · ${lead.email}` : ""}</p>
            <p>Sales: {String(getValue(lead, "owner.name") ?? "—")} · Cabang: {lead.branch ? humanize(String(lead.branch)) : "Belum diisi"}</p>
            <p className="break-words">Minat: {String(lead.interest ?? "Belum diisi")}</p>
            <p>Sales, cabang, dan catatan disalin dari lead. Tahap awal opportunity: Qualified.</p>
          </div>
          {legacy && <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <input type="checkbox" required checked={confirmLegacy} onChange={e => setConfirmLegacy(e.target.checked)} className="mt-1 size-4 shrink-0 accent-blue-600" />
            Saya sudah memeriksa riwayat lead ini dan memastikan belum ada opportunity yang sama. Proses ini membuat opportunity baru, bukan menautkan opportunity lama.
          </label>}
          <div><Label htmlFor="conversion-customer-mode">Customer</Label>
            <select id="conversion-customer-mode" className="field mt-1.5" value={mode} onChange={e => setMode(e.target.value)}>
              <option value="existing">Pilih customer yang sudah ada</option><option value="new">Buat customer dari lead</option>
            </select>
          </div>
          {mode === "new" ? <div className="space-y-2">
            <p className="text-xs leading-5 text-slate-500">Nama, email, telepon, cabang, sales, dan catatan customer disalin dari lead. Periksa customer yang sudah ada untuk menghindari duplikasi. Kota berikut adalah alamat customer, bukan otomatis kota cabang.</p>
            <Label htmlFor="conversion-city">Kota customer *</Label>
            <Input id="conversion-city" value={city} onChange={e => setCity(e.target.value)} required minLength={2} maxLength={150} />
          </div> : <div className="space-y-3">
            <p className="text-xs text-slate-500">Hanya customer dengan sales pemilik yang sama. Customer yang dipilih tidak akan diubah.</p>
            {customerId && <p className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-800">Customer terpilih: <strong>{customerName}</strong></p>}
            <Input aria-label="Cari customer untuk konversi" placeholder="Cari nama, email, atau telepon..." value={search} onChange={e => setSearch(e.target.value)} />
            {lookupError ? <ErrorState error={lookupError} retry={() => setAttempt(n => n + 1)} /> : loading ? <Loading label="Memuat customer..." /> : <div className="space-y-2">
              {customers?.data.map(customer => <label key={customer.id} className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs">
                <input type="radio" name="conversion-customer" checked={customerId === customer.id} onChange={() => { setCustomerId(customer.id); setCustomerName(String(customer.name)); }} className="mt-1 accent-blue-600" />
                <span className="min-w-0 break-words"><strong>{String(customer.name)}</strong>{customer.status === "INACTIVE" ? " (Inactive)" : ""}<span className="block text-slate-500">{String(customer.phone)} · {String(customer.city)}{customer.email ? ` · ${customer.email}` : ""}</span></span>
              </label>)}
              {customers?.total === 0 && <p className="text-xs text-slate-500">Tidak ada customer yang cocok.</p>}
              {customers && customers.totalPages > 1 && <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(n => n - 1)}>Sebelumnya</Button>
                <span className="text-xs">{page} / {customers.totalPages}</span>
                <Button type="button" variant="outline" size="sm" disabled={page >= customers.totalPages} onClick={() => setPage(n => n + 1)}>Berikutnya</Button>
              </div>}
            </div>}
          </div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="conversion-name">Nama opportunity *</Label><Input id="conversion-name" className="mt-1.5" required minLength={2} maxLength={150} value={name} onChange={e => setName(e.target.value)} /></div>
            <div><Label htmlFor="conversion-value">Nilai penawaran (IDR) *</Label><Input id="conversion-value" className="mt-1.5" type="number" min={0} max={1e12} step={0.01} required value={value} onChange={e => setValue(e.target.value)} /></div>
            <div><Label htmlFor="conversion-probability">Probabilitas (%) *</Label><Input id="conversion-probability" className="mt-1.5" type="number" min={0} max={100} step={1} required value={probability} onChange={e => setProbability(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label htmlFor="conversion-close">Perkiraan closing *</Label><Input id="conversion-close" className="mt-1.5" type="datetime-local" required value={closeDate} onChange={e => setCloseDate(e.target.value)} /><p className="mt-1 text-[10px] text-slate-500">Zona waktu perangkat: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Disimpan sebagai waktu absolut.</p></div>
          </div>
        </fieldset>
        {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Batal</Button><Button type="submit" disabled={pending || (legacy && !confirmLegacy) || (mode === "existing" && (loading || Boolean(lookupError) || !customerId))}>{pending && <Loader2 className="animate-spin" />}Konversi & buka opportunity</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
