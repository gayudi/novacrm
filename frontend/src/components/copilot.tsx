import { useEffect, useRef, useState } from "react";
import { Link, useMatch } from "react-router-dom";
import { ArrowLeft, ArrowUp, Check, ChevronRight, Loader2, LockKeyhole, LogOut, Plus, Search, ShieldCheck, Sparkles, Square, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/auth";
import { api, ApiError, type User } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { CopilotVisual, visualMetrics, type VisualRequest, type CopilotVisualData } from "./copilot-visual";
import { CopilotAnswer } from "./copilot-answer";

const tasks = [
  { id: "customer_summary", label: "Ringkasan pelanggan", entity: "customers", prompt: "Ringkas pelanggan ini dan sarankan tindakan berikutnya." },
  { id: "lead_summary", label: "Ringkasan lead", entity: "leads", prompt: "Ringkas lead ini dan sarankan tindak lanjut yang praktis." },
  { id: "opportunity_summary", label: "Ringkasan peluang", entity: "opportunities", prompt: "Berikan briefing peluang ini: kesimpulan utama, angka penting, hal yang perlu diperhatikan, dan tindak lanjut konkret berdasarkan bukti." },
  { id: "customer_360", label: "Pelanggan 360", entity: "customers", prompt: "Berikan tinjauan menyeluruh tentang pembelian, interaksi, dan peluang pelanggan ini." },
  { id: "pipeline_review", label: "Tinjauan peluang penjualan", entity: null, prompt: "Tinjau peluang penjualan yang dapat saya akses dan prioritaskan tindakan berikutnya." },
  { id: "sales_forecast", label: "Perkiraan penjualan", entity: null, prompt: "Perkirakan penjualan berdasarkan pendapatan dan nilai peluang tertimbang. Jelaskan asumsinya." },
  { id: "risk_analysis", label: "Analisis risiko", entity: null, prompt: "Identifikasi risiko terbesar dalam data CRM saya dan sarankan cara mengatasinya." },
  { id: "executive_summary", label: "Ringkasan eksekutif", entity: null, prompt: "Berikan briefing eksekutif tentang kinerja, makna tren, prioritas keputusan, dan langkah berikutnya. Bedakan fakta, interpretasi, dan keterbatasan data." },
  { id: "latest_leads", label: "Lead terbaru", entity: null, prompt: "Tampilkan 10 lead terakhir beserta tanggal dan jam dibuat dalam WIB." },
  { id: "salesperson_ranking", label: "Peringkat sales", entity: null, prompt: "Siapa sales dengan omzet tertinggi bulan ini? Tampilkan peringkat berdasarkan omzet transaksi selesai." },
  { id: "visualization", label: "Grafik dan diagram", entity: null, prompt: "Buat visualisasi sesuai pengaturan di atas dan jelaskan temuan utamanya." },
] as const;
type Action = typeof tasks[number]["id"];
type RecordChoice = { id: string; name: string };
type Reply = {
  action?: Action;
  answerSource?: "database" | "ai";
  visualization?: CopilotVisualData;
  answer: string; truncated: boolean; scope: "own" | "company"; asOf: string; contextBytes: number;
  sources: { ref: string; resource: string; id: string; label: string; createdAt?: string; updatedAt?: string }[];
};
type Turn = { id: number; question: string; label: string; reply?: Reply; error?: string };
const timestamp = (value: string) => `${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(value))} WIB`;
function copilotError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Sesi berakhir. Silakan masuk kembali.";
    if (error.status === 403) return "Anda tidak memiliki izin untuk mengakses data ini.";
    if (error.status === 500) return "Terjadi kesalahan di server. Silakan coba lagi.";
    if (error.message === "Please check the submitted fields.") return "Periksa kembali isian yang dikirim.";
    if (error.message === "Too many requests. Please try again shortly.") return "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.";
    if (error.message === "The server returned an invalid response. Check that the API is running.") return "Respons server tidak valid. Pastikan API berjalan.";
    return error.message;
  }
  return "Tidak dapat menghubungi server. Periksa koneksi dan coba lagi.";
}

function openWorkspaceTab(path: string) {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin) {
    toast.error("Hanya halaman dalam ruang kerja ini yang dapat dibuka.");
    return;
  }
  // The new tab inherits sessionStorage at creation; detach its opener before navigation completes.
  const tab = window.open(url.href, "_blank");
  if (!tab) {
    toast.error("Browser memblokir tab baru. Izinkan pop-up untuk CRM ini lalu coba lagi.");
    return;
  }
  tab.opener = null;
}

export function CopilotLauncher() {
  const copilotRoute = useMatch("/copilot");
  if (copilotRoute) return null;
  return <button type="button" onClick={() => openWorkspaceTab("/copilot")} aria-label="Buka Copilot di tab baru" title="Buka Copilot di tab baru" className="fixed bottom-5 right-5 z-40 flex h-14 items-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-4 text-white shadow-xl shadow-indigo-500/25 transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"><Sparkles className="size-6" /><span className="text-sm font-semibold">Copilot</span></button>;
}

export function CopilotPage() {
  const { user } = useAuth();
  return <CopilotWorkspace key={user ? `${user.id}:${user.role}` : "guest"} user={user} />;
}

function CopilotWorkspace({ user }: { user: User | null }) {
  const { logout } = useAuth();
  const [action, setAction] = useState<Action>("executive_summary");
  const [visual, setVisual] = useState<VisualRequest>({ type: "line", metric: "revenue_monthly" });
  const task = tasks.find(item => item.id === action)!;
  const [prompt, setPrompt] = useState<string>(task.prompt);
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<RecordChoice[]>([]);
  const [selected, setSelected] = useState<RecordChoice>();
  const [recordError, setRecordError] = useState("");
  const [finding, setFinding] = useState(false);
  const [status, setStatus] = useState<{ configured: boolean }>();
  const [statusError, setStatusError] = useState("");
  const [retry, setRetry] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const latestAnswer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    const previousLanguage = document.documentElement.lang;
    document.documentElement.lang = "id";
    document.title = "Nova Copilot | Asisten CRM";
    return () => { document.title = previousTitle; document.documentElement.lang = previousLanguage; active.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setStatus(undefined); setStatusError("");
    api<{ configured: boolean }>("/copilot/status", { signal: controller.signal }).then(setStatus).catch(error => {
      if (!controller.signal.aborted) setStatusError(copilotError(error));
    });
    return () => controller.abort();
  }, [user, retry]);
  useEffect(() => {
    if (!user || !task.entity) return;
    const controller = new AbortController();
    setFinding(true); setRecordError(""); setRecords([]);
    const timer = setTimeout(() => {
      api<{ records: RecordChoice[] }>(`/copilot/records?entity=${task.entity}&search=${encodeURIComponent(search)}`, { signal: controller.signal })
        .then(result => setRecords(result.records))
        .catch(error => { if (!controller.signal.aborted) setRecordError(copilotError(error)); })
        .finally(() => { if (!controller.signal.aborted) setFinding(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [user, task.entity, search, retry]);
  useEffect(() => {
    if (!busy && turns.at(-1)?.reply) latestAnswer.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    else bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns, busy]);

  function choose(id: Action) {
    const next = tasks.find(item => item.id === id)!;
    setAction(id); setPrompt(next.prompt); setSearch(""); setSelected(undefined);
  }
  function reset() {
    active.current?.abort(); active.current = null;
    setBusy(false); setTurns([]); setPrompt(task.prompt);
  }
  async function send() {
    if (busy || !status?.configured || !prompt.trim() || (task.entity && !selected)) return;
    const controller = new AbortController();
    active.current = controller;
    const id = ++sequence.current;
    const question = prompt.trim();
    setTurns(previous => [...previous, { id, question, label: `${task.label}${selected ? ` / ${selected.name}` : ""}` }]);
    setBusy(true); setPrompt("");
    try {
      const reply = await api<Reply>("/copilot/chat", { method: "POST", signal: controller.signal, body: JSON.stringify({ action, prompt: question, ...(task.entity && selected ? { recordId: selected.id } : {}), ...(action === "visualization" ? { visualization: visual } : {}) }) });
      setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, reply, label: reply.action && reply.action !== action ? tasks.find(item => item.id === reply.action)?.label ?? turn.label : turn.label } : turn));
    } catch (error) {
      const message = controller.signal.aborted ? "Permintaan dibatalkan." : copilotError(error);
      setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, error: message } : turn));
      if (active.current === controller) setPrompt(question);
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }

  return <main lang="id" aria-label="Ruang kerja Copilot" className="flex h-[100dvh] w-full flex-col bg-white">
        <header className="flex shrink-0 items-center gap-3 border-b px-5 py-4">
          <Button asChild size="icon" variant="ghost"><Link to="/" aria-label="Kembali ke CRM" title="Kembali ke CRM"><ArrowLeft /></Link></Button>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-100 via-indigo-100 to-fuchsia-100 text-indigo-600"><Sparkles className="size-5" /></span>
          <div className="min-w-0 flex-1"><h1 className="text-sm font-semibold text-slate-800">Nova Copilot</h1><p className="mt-0.5 truncate text-[10px] text-slate-500">{user ? `${user.name} / ${{ ADMIN: "Administrator", MANAGER: "Manajer", SALES: "Staf penjualan" }[user.role]}` : "Asisten AI untuk bisnis ritel Anda"}</p></div>
          <Button size="icon" variant="ghost" aria-label="Percakapan baru" title="Percakapan baru" onClick={reset}><Plus /></Button>
          {user && <Button size="icon" variant="ghost" aria-label="Keluar dari Copilot" title="Keluar dari tab ini" onClick={logout}><LogOut /></Button>}
        </header>
        {!user ? <div className="grid flex-1 place-content-center gap-4 px-8 text-center"><LockKeyhole className="mx-auto size-9 text-indigo-500" /><h2 className="text-lg font-semibold">Bantuan untuk ruang kerja Anda.</h2><p className="max-w-sm text-sm leading-6 text-slate-500">Masuk untuk menanyakan pelanggan, meninjau peluang, dan merencanakan langkah berikutnya. Data CRM hanya tersedia setelah Anda masuk.</p><Button asChild><Link to="/login?next=copilot">Masuk ke Copilot</Link></Button></div> : <>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-indigo-50/60 px-5 py-2.5 text-[10px] text-indigo-700"><span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" />{user.role === "SALES" ? "Hanya data Anda" : "Data seluruh perusahaan"}</span><span>Asisten hanya-baca</span></div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto max-w-3xl space-y-5 px-5 py-6">
              <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-indigo-500">Data lebih jelas. Langkah lebih tepat.</p><h2 className="mt-2 text-xl font-semibold tracking-tight">Apa yang bisa saya bantu?</h2><p className="mt-2 text-xs leading-5 text-slate-500">Saya menjawab dalam Bahasa Indonesia berdasarkan data yang boleh Anda akses. Coba &ldquo;10 lead terakhir&rdquo;, &ldquo;buat grafik garis pendapatan&rdquo;, &ldquo;diagram lingkaran sumber lead&rdquo;, atau &ldquo;diagram alur proses penjualan&rdquo; tanpa memilih data individual.</p></div>
              <div className="grid grid-cols-2 gap-2" aria-label="Kemampuan Copilot">{tasks.map(item => <button key={item.id} disabled={busy} onClick={() => choose(item.id)} aria-pressed={action === item.id} className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left text-[11px] transition disabled:opacity-50", action === item.id ? "border-indigo-300 bg-indigo-50 font-semibold text-indigo-700" : "border-slate-200 text-slate-600 hover:border-indigo-200 hover:bg-slate-50")}>{item.label}{action === item.id ? <Check className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0 text-slate-300" />}</button>)}</div>
              {action === "visualization" && <section aria-label="Pengaturan visualisasi" className="space-y-3 rounded-xl border bg-slate-50 p-3">
                <label className="block text-xs font-medium">Jenis visual<select aria-label="Jenis visual" disabled={busy} value={visual.type} onChange={event => {
                  const type = event.target.value as VisualRequest["type"];
                  setVisual({ type, metric: type === "flow" ? "sales_process" : visual.metric === "sales_process" ? "revenue_monthly" : visual.metric });
                }} className="mt-1 block w-full rounded border bg-white p-2">
                  <option value="bar">Grafik batang</option><option value="line">Grafik garis</option><option value="pie">Diagram lingkaran</option><option value="flow">Diagram alur</option>
                </select></label>
                <label className="block text-xs font-medium">Topik data<select aria-label="Topik data" disabled={busy || visual.type === "flow"} value={visual.metric} onChange={event => setVisual({ ...visual, metric: event.target.value as VisualRequest["metric"] })} className="mt-1 block w-full rounded border bg-white p-2">
                  {visualMetrics.filter(metric => (metric.value === "sales_process") === (visual.type === "flow")).map(metric => <option key={metric.value} value={metric.value}>{metric.label}</option>)}
                </select></label>
                <p className="text-[10px] leading-5 text-slate-500">Pengaturan ini menentukan grafik. Periode menggunakan kalender UTC, tanpa filter tambahan dari pertanyaan. Untuk perintah langsung lewat teks, gunakan Ringkasan eksekutif. Diagram alur adalah contoh proses, bukan riwayat perpindahan peluang.</p>
              </section>}
              {statusError ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{statusError}<Button variant="outline" size="sm" className="mt-2" onClick={() => setRetry(value => value + 1)}>Coba sambungkan lagi</Button></div> : !status ? <p role="status" className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="size-3 animate-spin" />Memeriksa ketersediaan Copilot...</p> : !status.configured && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><p className="font-semibold">Azure OpenAI perlu dikonfigurasi</p><p className="mt-1">Minta administrator menjalankan panduan penyiapan Azure atau mengisi variabel server berikut:</p><ul className="mt-2 space-y-1 break-all font-mono text-[10px]">{["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_KEY", "AZURE_OPENAI_DEPLOYMENT"].map(name => <li key={name}>{name}</li>)}</ul><p className="mt-2">Untuk pratinjau lokal, simpan konfigurasi lalu pilih Periksa lagi. Untuk Docker, buat ulang kontainer backend. Jangan masukkan kunci API ke percakapan ini.</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setRetry(value => value + 1)}>Periksa lagi</Button></div>}
              {task.entity && <section className="rounded-xl border bg-slate-50/60 p-3" aria-label="Pilihan data">
                <label htmlFor="copilot-record-search" className="text-xs font-medium">Pilih {task.entity === "opportunities" ? "peluang" : task.entity === "customers" ? "pelanggan" : "lead"}</label>
                <div className="relative mt-2"><Search className="absolute left-3 top-3 size-3.5 text-slate-400" /><input id="copilot-record-search" maxLength={100} disabled={busy} value={search} onChange={event => { setSearch(event.target.value); setSelected(undefined); }} placeholder="Cari data sesuai hak akses..." className="h-9 w-full rounded-md border bg-white pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-indigo-300" /></div>
                {selected ? <div className="mt-2 flex items-center gap-2 rounded-md bg-indigo-100 p-2 text-xs text-indigo-800"><Check className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 break-words">{selected.name}</span><button aria-label="Hapus pilihan data" disabled={busy} onClick={() => setSelected(undefined)}><X className="size-4" /></button></div>
                  : finding ? <p role="status" className="mt-3 text-xs text-slate-500">Mencari...</p>
                  : recordError ? <div role="alert" className="mt-3 text-xs text-red-600">{recordError}<button className="ml-2 underline" onClick={() => setRetry(value => value + 1)}>Coba lagi</button></div>
                  : records.length ? <ul className="mt-2 max-h-40 overflow-y-auto">{records.map(record => <li key={record.id}><button disabled={busy} className="w-full rounded px-2 py-2 text-left text-xs hover:bg-indigo-50 focus:bg-indigo-50" onClick={() => setSelected(record)}>{record.name}</button></li>)}</ul>
                  : <p className="mt-3 text-xs text-slate-500">Tidak ada data yang cocok dalam hak akses Anda.</p>}
                <p className="mt-2 text-[10px] text-slate-400">Maksimal 8 hasil. Gunakan pencarian untuk mempersempit pilihan.</p>
              </section>}
              <div role="log" aria-label="Percakapan Copilot" aria-live="polite" className="space-y-5">{turns.map(turn => <article key={turn.id} className="space-y-3">
                <div className="ml-6 rounded-xl rounded-br-sm bg-indigo-50 p-4"><p className="mb-1 text-[10px] font-medium text-indigo-500">{turn.reply?.action === "latest_leads" ? "Lead terbaru" : turn.reply?.action === "visualization" ? "Grafik dan diagram" : turn.label}</p><p className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-700">{turn.question}</p></div>
                {turn.reply ? <div ref={turn.id === turns.at(-1)?.id ? latestAnswer : undefined} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="h-1 bg-gradient-to-r from-cyan-300 via-indigo-400 to-violet-300" />
                  <div className="px-4 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                      <div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><Sparkles className="size-4" /></span><div><p className="text-xs font-semibold text-slate-800">Nova Copilot</p><p className="mt-0.5 text-[10px] text-slate-400">{turn.reply.answerSource === "database" ? "Peringkat sales · Hasil perhitungan" : "Ringkasan & rekomendasi"}</p></div></div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-100 bg-slate-50 px-2.5 py-1 text-[9px] font-medium text-slate-500"><ShieldCheck className="size-3" />{turn.reply.answerSource === "database" ? "Dihitung langsung dari CRM" : "Berdasarkan data CRM"}</span>
                    </div>
                    <CopilotAnswer answer={turn.reply.answer} />
                  {turn.reply.visualization && <CopilotVisual visual={turn.reply.visualization} />}
                  {turn.reply.truncated && <p className="mt-3 text-xs text-amber-700">Jawaban mencapai batas panjang. Ajukan pertanyaan lebih spesifik untuk mendapatkan detail.</p>}
                  {turn.reply.sources.length > 0 && <div className="mt-4 border-t pt-3"><p className="mb-2 text-[10px] font-semibold text-slate-500">Sumber data{turn.reply.action === "latest_leads" && " / Terbaru berdasarkan waktu dibuat"}</p><div className="flex flex-wrap gap-1.5">{turn.reply.sources.map(source => <button key={source.ref} type="button" onClick={() => openWorkspaceTab(`/${source.resource}?record=${encodeURIComponent(source.id)}`)} className="max-w-full rounded border bg-slate-50 px-2 py-1 text-left text-[10px] text-indigo-600 hover:bg-indigo-50" title={`Buka ${source.label} di tab baru`}><span className="block truncate">{source.ref} &middot; {source.label}</span>{source.createdAt && <span className="mt-1 block">Dibuat {timestamp(source.createdAt)}</span>}{source.updatedAt && <span className="block text-slate-500">Diperbarui {timestamp(source.updatedAt)}</span>}</button>)}</div></div>}
                  <p className="mt-3 text-[9px] text-slate-400">Data diambil {timestamp(turn.reply.asOf)} &middot; {(turn.reply.contextBytes / 1024).toLocaleString("id-ID", { maximumFractionDigits: 1 })} KB konteks &middot; {turn.reply.scope === "own" ? "Hanya data Anda" : "Data perusahaan"}</p>
                  </div>
                </div> : turn.error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700">{turn.error} Pertanyaan Anda siap diedit dan dikirim ulang.</p> : <p role="status" className="flex items-center gap-2 py-3 text-xs text-indigo-600"><Loader2 className="size-4 animate-spin" />Meninjau data CRM sesuai hak akses Anda...</p>}
              </article>)}</div><div ref={bottom} />
            </div>
          </div>
          <div className="shrink-0 border-t bg-white px-5 pb-4 pt-3"><form onSubmit={event => { event.preventDefault(); void send(); }} className="mx-auto max-w-3xl">
            <label htmlFor="copilot-question" className="text-[10px] font-medium text-slate-500">{task.label}{selected ? ` / ${selected.name}` : ""}</label>
            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/50 p-2 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100"><textarea id="copilot-question" maxLength={600} rows={2} value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder="Tanyakan tentang tugas yang dipilih..." className="w-full resize-none bg-transparent px-2 py-1 text-xs leading-5 outline-none disabled:opacity-60" /><div className="flex items-center justify-between pl-2"><span className="text-[9px] text-slate-400">{prompt.length}/600 &middot; Shift+Enter untuk baris baru</span>{busy ? <Button type="button" size="icon" variant="outline" aria-label="Hentikan jawaban" onClick={() => active.current?.abort()}><Square className="!size-3" /></Button> : <Button type="submit" size="icon" aria-label="Kirim pesan" disabled={!status?.configured || !prompt.trim() || Boolean(task.entity && !selected)} className="h-8 w-8 rounded-lg bg-indigo-600 hover:bg-indigo-700"><ArrowUp /></Button>}</div></div>
            <p className="mt-2 text-center text-[9px] leading-4 text-slate-400">Setiap pertanyaan mengambil data terbaru. Pesan sebelumnya tidak dikirim ke AI.<br />AI bisa keliru. Periksa keputusan penting. Percakapan dihapus saat keluar atau memuat ulang halaman.</p>
          </form></div>
        </>}
  </main>;
}
