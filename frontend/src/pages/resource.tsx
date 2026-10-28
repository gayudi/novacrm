import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDownToLine, ArrowUpRight, ChevronLeft, ChevronRight, Eye, Filter, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Smartphone, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/auth";
import { api, type EntityRecord, type Lookup, type PageResult } from "@/lib/api";
import { getValue, type Column, type Resource } from "@/lib/resources";
import { cn, dateLabel, dateTimeLabel, humanize, initials, money } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Loading } from "@/components/feedback";
import { EntityForm, savedItems } from "@/components/entity-form";
import { LeadConversionAction, LeadConversionDialog } from "@/components/lead-conversion";

function CellValue({ value, format }: { value: unknown; format?: Column["format"] }) {
  if (value === undefined || value === null || value === "") return <span className="text-slate-300">&mdash;</span>;
  if (format === "badge") return <Badge value={String(value)} />;
  if (format === "money") return <span className="font-semibold tabular-nums text-slate-700">{money(String(value))}</span>;
  if (format === "date") return <>{dateLabel(String(value))}</>;
  if (format === "datetime") return <time dateTime={String(value)}>{dateTimeLabel(String(value))}</time>;
  if (format === "boolean") return <span className={cn("inline-flex items-center gap-1.5 text-[10px]", value ? "text-emerald-600" : "text-slate-400")}><span className="size-1.5 rounded-full bg-current" />{value ? "Active" : "Inactive"}</span>;
  if (format === "percent") return <div className="flex items-center gap-2"><span className="w-8 text-[11px]">{String(value)}%</span><span className="h-1 w-12 rounded-full bg-slate-100"><span className="block h-full rounded-full bg-blue-400" style={{ width: `${Number(value)}%` }} /></span></div>;
  if (format === "stock") return <span className={cn("text-xs", Number(value) < 10 ? "font-medium text-amber-600" : "text-slate-600")}>{String(value)} units{Number(value) < 10 && <span className="ml-2 text-[9px]">(low stock)</span>}</span>;
  return <>{String(value)}</>;
}

function Details({ resource, record, onConvert }: { resource: Resource; record: EntityRecord; onConvert: (lead: EntityRecord) => void }) {
  const displayFields = resource.fields.filter(f => f.type !== "password");
  const timestampLabel = resource.key === "leads" ? dateTimeLabel : dateLabel;
  const lineItems = savedItems(record);
  return <DialogContent className="max-w-2xl"><DialogTitle>{String(record[resource.primary])}</DialogTitle><DialogDescription>{humanize(resource.singular)} details &middot; Access follows your role and record ownership</DialogDescription>
    {resource.key === "leads" && <div className="mt-4 space-y-2">
      <LeadConversionAction lead={record} onConvert={onConvert} />
      {record.convertedAt ? <p className="text-xs text-slate-500">Dikonversi {dateTimeLabel(String(record.convertedAt))}. Hubungan asal disimpan sebagai riwayat.</p> : record.status === "CONVERTED" ? <p className="text-xs text-amber-700">Lead Converted lama belum memiliki opportunity terhubung. Periksa riwayat sebelum membuat opportunity baru.</p> : record.status !== "QUALIFIED" && <p className="text-xs text-slate-500">Ubah lead menjadi Qualified setelah kebutuhan pelanggan diperiksa untuk mengaktifkan konversi.</p>}
    </div>}
    {resource.key === "opportunities" && typeof getValue(record, "sourceLead.id") === "string" && <p className="mt-4 text-xs">Lead asal: <Link className="font-medium text-primary underline" to={`/leads?record=${encodeURIComponent(String(getValue(record, "sourceLead.id")))}`}>{String(getValue(record, "sourceLead.name"))}</Link></p>}
    <dl className="mt-6 grid gap-5 sm:grid-cols-2">{displayFields.map(field => {
      const relation = field.key.endsWith("Id") ? field.key.slice(0, -2) : "";
      const value = field.type === "product" ? getValue(record, "product.name") ?? record.interest
        : field.type === "reference" ? getValue(record, `${relation === "owner" ? "owner" : relation}.name`) : record[field.key];
      return <div key={field.key} className={field.wide ? "sm:col-span-2" : ""}><dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{field.label}</dt><dd className="mt-1.5 whitespace-pre-wrap break-words text-sm"><CellValue value={value} format={field.type === "datetime-local" ? resource.key === "transactions" ? "datetime" : "date" : field.type === "checkbox" ? "boolean" : field.key === "price" || field.key === "value" ? "money" : field.type === "select" ? "badge" : undefined} /></dd></div>;
    })}</dl>
    {lineItems.length > 0 && <div className="mt-6 border-t pt-4"><h3 className="mb-3 text-sm font-semibold">Purchased products</h3>{lineItems.map(item => {
      const raw = Array.isArray(record.items) ? record.items.find((row: unknown) => getValue(row, "productId") === item.productId) : undefined;
      return <div key={item.productId} className="flex justify-between gap-3 border-b py-3 text-xs"><div><p className="font-medium">{String(getValue(raw, "product.name") ?? item.productId)}</p><p className="mt-1 text-slate-400">{item.quantity} &times; {money(item.unitPrice)}</p></div><span className="font-semibold">{money(Number(item.unitPrice) * item.quantity)}</span></div>;
    })}<div className="mt-4 flex justify-between text-sm font-semibold"><span>Total</span><span>{money(String(record.total))}</span></div></div>}
    <p className="mt-6 border-t pt-4 text-[10px] text-slate-400">Created {timestampLabel(String(record.createdAt))} &middot; Last updated {timestampLabel(String(record.updatedAt))}</p>
  </DialogContent>;
}

export function ResourcePage({ resource }: { resource: Resource }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [query, setQuery] = useState(search);
  const [status, setStatus] = useState("");
  const [branch, setBranch] = useState("");
  const [salespersonId, setSalespersonId] = useState("");
  const [period, setPeriod] = useState("all");
  const [salespeople, setSalespeople] = useState<Lookup[]>([]);
  const [filterError, setFilterError] = useState("");
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PageResult>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<EntityRecord | "new" | null>(null);
  const [detail, setDetail] = useState<EntityRecord | null>(null);
  const [conversion, setConversion] = useState<EntityRecord | null>(null);
  const [deleting, setDeleting] = useState<EntityRecord | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const canWrite = Boolean(user) && user?.role !== "GUEST" && (user?.role !== "SALES" || !resource.restrictedWrite);
  const canDelete = user?.role === "ADMIN" || user?.role === "MANAGER";
  const isTransactions = resource.key === "transactions";
  const hasFilters = Boolean(query || status || (isTransactions && (branch || salespersonId || period !== "all")));
  const linkedRecord = params.get("record");
  useEffect(() => {
    if (!isTransactions) return;
    const controller = new AbortController();
    setFiltersLoading(true); setFilterError("");
    api<{ salespeople: Lookup[] }>("/transactions/filter-options", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setSalespeople(data.salespeople); })
      .catch(err => { if (!controller.signal.aborted) setFilterError(err instanceof Error ? err.message : "Daftar sales tidak dapat dimuat."); })
      .finally(() => { if (!controller.signal.aborted) setFiltersLoading(false); });
    return () => controller.abort();
  }, [isTransactions, revision]);
  useEffect(() => {
    if (!linkedRecord) return;
    const controller = new AbortController();
    api<EntityRecord>(`/${resource.key}/${encodeURIComponent(linkedRecord)}`, { signal: controller.signal })
      .then(record => { if (!controller.signal.aborted) setDetail(record); })
      .catch(error => { if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "Could not open this record."); });
    return () => controller.abort();
  }, [linkedRecord, resource.key]);
  useEffect(() => {
    const timeout = setTimeout(() => { setQuery(search); setPage(1); }, 300);
    return () => clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    if (params.get("new") === "1" && canWrite) {
      setEditor("new"); setParams(current => { current.delete("new"); return current; }, { replace: true });
    }
  }, [params, setParams, canWrite]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const qs = new URLSearchParams({ page: String(page), pageSize: "10", search: query });
    if (status) qs.set("status", status);
    if (isTransactions) {
      if (branch) qs.set("branch", branch);
      if (salespersonId) qs.set("salespersonId", salespersonId);
      qs.set("period", period);
    }
    api<PageResult>(`/${resource.key}?${qs}`, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      if (page > 1 && data.data.length === 0) setPage(Math.max(1, data.totalPages));
      else setResult(data);
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load records.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [resource.key, page, query, status, revision, isTransactions, branch, salespersonId, period]);
  const reload = useCallback(() => setRevision(n => n + 1), []);
  async function exportPage() {
    if (!result?.data.length || loading || error || exporting) return;
    setExporting(true);
    try {
      const { downloadResourceExcel } = await import("@/lib/excel-export");
      const filters = [
        query && `Search: ${query}`,
        status && `${resource.key === "opportunities" ? "Stage" : "Status"}: ${humanize(status)}`,
        isTransactions && branch && `Branch: ${humanize(branch)}`,
        isTransactions && salespersonId && `Salesperson: ${salespeople.find(person => person.id === salespersonId)?.name ?? salespersonId}`,
        isTransactions && period !== "all" && `Period: ${humanize(period)} (WIB)`,
      ].filter(Boolean).join(" | ");
      await downloadResourceExcel(resource, result, {
        preparedBy: user?.name ?? "CRM user",
        scope: user?.role === "SALES" && !["products", "users"].includes(resource.key) ? "Your permitted records only" : "All permitted records",
        filters: filters || "All records - no additional filters",
      });
      toast.success(`Excel ready: ${result.data.length} records from the current page.`);
    } catch (err) {
      toast.error(err instanceof Error ? `Excel export failed: ${err.message}` : "Excel export failed. Please try again.");
    } finally { setExporting(false); }
  }
  async function remove() {
    if (!deleting) return;
    setPendingDelete(true); setDeleteError("");
    try {
      await api(`/${resource.key}/${deleting.id}`, { method: "DELETE" });
      toast.success(`${humanize(resource.singular)} deleted.`); setDeleting(null); reload();
    } catch (err) { setDeleteError(err instanceof Error ? err.message : "Could not delete record."); }
    finally { setPendingDelete(false); }
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow mb-2 text-primary">{resource.key === "users" ? "Administration" : "Your connected workspace"}</p><div className="flex items-center gap-3"><h1 className="page-heading">{resource.title}</h1>{result && <span className="rounded-full border bg-white px-2.5 py-0.5 text-xs font-medium text-slate-500">{result.total}</span>}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{resource.description}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" className="h-9" onClick={() => void exportPage()} disabled={!result?.data.length || loading || Boolean(error) || exporting} title="Download the current page as a styled Excel workbook" aria-busy={exporting}>{exporting ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}{exporting ? "Preparing Excel..." : "Export Excel (page)"}</Button>{canWrite && <Button size="sm" className="h-9" onClick={() => setEditor("new")}><Plus />New {resource.singular}</Button>}</div></div>
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div className="flex flex-wrap items-center gap-3"><div className="relative w-full sm:w-64"><Search className="absolute left-3 top-2.5 size-4 text-slate-400" /><Input value={search} onChange={e => setSearch(e.target.value)} aria-label={`Search ${resource.title.toLowerCase()}`} placeholder={`Search ${resource.title.toLowerCase()}...`} className="h-9 border-slate-200 pl-9 pr-8 text-xs shadow-none" />{search && <button className="absolute right-2 top-2.5 text-slate-400" onClick={() => setSearch("")} aria-label="Clear search"><X className="size-4" /></button>}</div>{resource.statuses && <div className="flex h-9 items-center gap-2 rounded-md border px-3"><Filter className="size-3.5 text-slate-400" /><select aria-label="Filter by status" className="max-w-40 bg-transparent text-xs outline-none" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All {resource.key === "opportunities" ? "stages" : "statuses"}</option>{resource.statuses.map(s => <option key={s} value={s}>{humanize(s)}</option>)}</select></div>}</div><div className="flex items-center gap-3"><span className="hidden text-[10px] text-slate-400 md:block">{loading ? "Updating..." : `${result?.total ?? 0} records${hasFilters ? " matching filters" : " in your workspace"}`}</span><Button variant="ghost" size="icon" aria-label="Refresh records" onClick={reload} disabled={loading}><RefreshCw className={cn("text-slate-400", loading && "animate-spin")} /></Button></div></div>
      {isTransactions && <div className="space-y-3 border-b bg-slate-50/60 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5 text-xs font-medium text-slate-600">Kota / cabang
            <select aria-label="Filter kota" className="block h-9 w-full rounded-md border bg-white px-3 text-xs outline-primary" value={branch} onChange={e => { setBranch(e.target.value); setPage(1); }}>
              <option value="">Semua kota</option>
              {resource.fields.find(field => field.key === "branch")?.options?.filter(Boolean).map(city => <option key={city} value={city}>{humanize(city)}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-600">Nama sales
            <select aria-label="Filter nama sales" className="block h-9 w-full rounded-md border bg-white px-3 text-xs outline-primary disabled:opacity-50" value={salespersonId} disabled={filtersLoading || Boolean(filterError)} onChange={e => { setSalespersonId(e.target.value); setPage(1); }}>
              <option value="">{filtersLoading ? "Memuat sales..." : user?.role === "SALES" ? "Semua transaksi saya" : "Semua sales"}</option>
              {salespeople.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-600">Periode penjualan
            <select aria-label="Filter waktu" className="block h-9 w-full rounded-md border bg-white px-3 text-xs outline-primary" value={period} onChange={e => { setPeriod(e.target.value); setPage(1); }}>
              <option value="all">Semua waktu</option><option value="week">Minggu ini</option><option value="month">Bulan ini</option><option value="quarter">Kuartal ini</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] leading-5 text-slate-500">Tanggal penjualan dalam WIB. Minggu: Senin–Minggu. Kuartal kalender: Jan–Mar, Apr–Jun, Jul–Sep, Okt–Des.</p>
          {hasFilters && <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setQuery(""); setStatus(""); setBranch(""); setSalespersonId(""); setPeriod("all"); setPage(1); }}><X />Reset filter</Button>}
        </div>
        {filterError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-red-600"><span>Daftar sales tidak dapat dimuat: {filterError}</span><Button variant="outline" size="sm" onClick={reload}>Coba lagi</Button></div>}
      </div>}
      {error ? <div className="p-6"><ErrorState error={error} retry={reload} /></div> : loading ? <Loading label={`Loading ${resource.title.toLowerCase()}...`} /> : result?.data.length ? <>
        <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left">
          <thead className="table-head"><tr><th className="px-5 py-3.5">{resource.key === "transactions" ? "Invoice / customer" : resource.key === "activities" ? "Activity" : resource.key === "opportunities" ? "Opportunity / customer" : resource.singular}</th>{resource.columns.map(column => <th key={column.key} className="px-4 py-3.5">{column.label}</th>)}<th className="px-5 py-3.5 text-right">Actions</th></tr></thead>
          <tbody className="divide-y">{result.data.map((record, index) => <tr key={record.id} className="transition-colors hover:bg-slate-50/70">
            <td className="px-5 py-4"><button className="flex max-w-[280px] items-center gap-3 text-left" onClick={() => setDetail(record)}><span className={cn("grid size-9 shrink-0 place-items-center rounded-lg text-[10px] font-semibold", ["bg-blue-50 text-blue-600", "bg-violet-50 text-violet-600", "bg-cyan-50 text-cyan-600", "bg-amber-50 text-amber-600"][index % 4])}>{resource.key === "products" ? <Smartphone className="size-5" /> : resource.key === "transactions" ? <ArrowUpRight className="size-4" /> : initials(String(record[resource.primary]))}</span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-700 hover:text-primary">{String(record[resource.primary])}</span>{resource.secondary && <span className="mt-1 block truncate text-[10px] text-slate-400">{String(getValue(record, resource.secondary) ?? "No details added")}</span>}</span></button>
              {resource.key === "leads" && <div className="mt-2"><LeadConversionAction lead={record} onConvert={setConversion} /></div>}
            </td>
            {resource.columns.map(column => <td key={column.key} className="px-4 py-4 text-[11px] text-slate-500"><CellValue value={getValue(record, column.key)} format={column.format} /></td>)}
            <td className="px-4 py-4"><div className="flex justify-end gap-0.5">
              <Button variant="ghost" size="icon" className="size-8 text-slate-400 hover:text-blue-600" aria-label={`View ${String(record[resource.primary])}`} onClick={() => setDetail(record)}><Eye className="!size-3.5" /></Button>
              {canWrite && <Button variant="ghost" size="icon" className="size-8 text-slate-400 hover:text-blue-600" aria-label={`Edit ${String(record[resource.primary])}`} onClick={() => setEditor(record)}><Pencil className="!size-3.5" /></Button>}
              {canDelete && !(resource.key === "leads" && record.convertedAt) && !(resource.key === "opportunities" && record.sourceLead) && <Button variant="ghost" size="icon" className="size-8 text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label={`Delete ${String(record[resource.primary])}`} onClick={() => { setDeleting(record); setDeleteError(""); }}><Trash2 className="!size-3.5" /></Button>}
            </div></td>
          </tr>)}</tbody>
        </table></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4"><p className="text-[11px] text-slate-400">Showing <span className="font-medium text-slate-600">{(page - 1) * result.pageSize + 1}&ndash;{Math.min(page * result.pageSize, result.total)}</span> of <span className="font-medium text-slate-600">{result.total}</span> records</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft />Previous</Button><span className="px-2 text-[10px] text-slate-500">{page} / {result.totalPages}</span><Button variant="outline" size="sm" aria-label="Next page" disabled={page >= result.totalPages} onClick={() => setPage(p => p + 1)}>Next<ChevronRight /></Button></div></div>
      </> : <EmptyState title={hasFilters ? "No matching records" : `Your ${resource.title.toLowerCase()} start here`} description={hasFilters ? "Try a different search or clear the filters to see more results." : `Create your first ${resource.singular} using the button above.`} />}
    </Card>
    <div className="flex items-start gap-2 text-[10px] leading-5 text-slate-400"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" /><p>{resource.key === "users" ? "Account changes revoke existing sessions. Users with assigned records cannot be deleted; reassign their records or disable their account instead." : resource.key === "transactions" ? "Sales see only their own transactions with permitted customer and opportunity links. Completed transactions update stock and revenue; deleting them restores inventory." : resource.key === "products" ? "Catalogue updates are available to Admins and Managers. Products used in transactions cannot be deleted; set them inactive to stop new sales." : "Sales see and edit only their own records; contacts follow customer ownership. Managers and Admins have company-wide access. Cross-owner links are hidden from Sales until ownership is aligned."}</p></div>
    <Dialog open={editor !== null} onOpenChange={open => { if (!open) setEditor(null); }}>{editor !== null && <EntityForm key={editor === "new" ? "new" : editor.id} resource={resource} record={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); reload(); }} />}</Dialog>
    <Dialog open={detail !== null} onOpenChange={open => { if (!open) { setDetail(null); if (linkedRecord) setParams(current => { current.delete("record"); return current; }, { replace: true }); } }}>{detail && <Details resource={resource} record={detail} onConvert={lead => { setDetail(null); setConversion(lead); }} />}</Dialog>
    {conversion && <LeadConversionDialog lead={conversion} onClose={() => { setConversion(null); reload(); }} onConverted={id => { setConversion(null); navigate(`/opportunities?record=${encodeURIComponent(id)}`); }} />}
    <Dialog open={deleting !== null} onOpenChange={open => { if (!open && !pendingDelete) setDeleting(null); }}><DialogContent className="max-w-md"><div className="mb-4 grid size-11 place-items-center rounded-full bg-red-50 text-red-500"><Trash2 className="size-5" /></div><DialogTitle>Delete this {resource.singular}?</DialogTitle><DialogDescription><span className="font-medium text-slate-600">{String(deleting?.[resource.primary] ?? "")}</span> will be permanently deleted. {resource.key === "transactions" ? "Inventory from a completed sale will be restored." : resource.key === "customers" ? "Linked contacts will also be deleted. Customers with sales or opportunities cannot be deleted." : "This action cannot be undone."}</DialogDescription>{deleteError && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-600">{deleteError}</p>}<div className="mt-6 flex justify-end gap-2"><Button variant="outline" disabled={pendingDelete} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={pendingDelete} onClick={() => void remove()}>{pendingDelete && <Loader2 className="animate-spin" />}Delete {resource.singular}</Button></div></DialogContent></Dialog>
  </div>;
}
