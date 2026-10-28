import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Gem, Mail, MessageCircle, Phone, Plus, RefreshCw, ShoppingBag, Smartphone, Store, Target, TrendingUp, Users, Video } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { cn, dateLabel, humanize, initials, money, shortMoney } from "@/lib/utils";
import { useAuth } from "@/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Loading } from "@/components/feedback";
import { RetailInsights, type RetailInsightsData } from "@/components/retail-insights";

type Dashboard = RetailInsightsData & {
  scope: "own" | "company"; totalCustomers: number; totalLeads: number; totalOpportunities: number;
  revenueThisMonth: number; revenueLastMonth: number; pipelineValue: number; completedSalesThisMonth: number;
  monthly: { month: string; revenue: number; sales: number }[];
  weekly: { week: string; revenue: number; sales: number }[];
  sampleData: { periodStart: string; periodEnd: string; counts: Record<string, number> } | null;
  leadSources: { source: string; count: number }[];
  pipeline: { stage: string; count: number; value: number }[];
  topProducts: { id: string; name: string; brand: string; units: number; revenue: number }[];
  topSalespeople: { id: string; name: string; sales: number; revenue: number }[];
  recentActivities: { id: string; subject: string; type: string; status: string; dueAt: string; owner: { name: string }; customer: { name: string } | null }[];
};
const palette = ["#3970ee", "#8b6cef", "#35b9bb", "#ffba62", "#ef859c", "#9aa9c3", "#ea8b55", "#65a659", "#ba6cbe"];
const stageOrder = ["PROSPECTING", "QUALIFIED", "QUALIFICATION", "NEEDS_ANALYSIS", "PROPOSAL", "NEGOTIATION"];
const chartTooltip = { borderRadius: 8, border: "1px solid #e8ecf3", boxShadow: "0 6px 20px #111c3410", fontSize: 11 };

function SectionHeader({ title, subtitle, link, to }: { title: string; subtitle?: string; link?: string; to?: string }) {
  return <div className="flex items-start justify-between gap-2 px-5 pt-5"><div><h2 className="text-[13px] font-semibold">{title}</h2>{subtitle && <p className="mt-1 text-[10px] text-slate-400">{subtitle}</p>}</div>{to && <Link to={to} className="flex items-center gap-1 text-[10px] font-medium text-primary hover:underline">{link ?? "View all"}<ChevronRight className="size-3" /></Link>}</div>;
}

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Dashboard>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await api<Dashboard>("/dashboard")); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load dashboard."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  if (!data && loading) return <Loading label="Preparing your business overview..." />;
  if (error) return <ErrorState error={error} retry={() => void load()} />;
  if (!data) return null;
  const growth = data.revenueLastMonth > 0 ? ((data.revenueThisMonth - data.revenueLastMonth) / data.revenueLastMonth) * 100 : null;
  const maxPipeline = Math.max(...data.pipeline.filter(s => stageOrder.includes(s.stage)).map(s => s.value), 1);
  const icons: Record<string, typeof Phone> = { CALL: Phone, EMAIL: Mail, WHATSAPP: MessageCircle, STORE_VISIT: Store, MEETING: Video, TASK: CheckCircle2, FOLLOW_UP: Clock3 };
  const visibleStages = stageOrder.filter(stage => !["QUALIFICATION", "NEEDS_ANALYSIS"].includes(stage) || data.pipeline.some(row => row.stage === stage && row.count > 0));
  const stats = [
    { label: "Total customers", value: data.totalCustomers.toLocaleString(), icon: Users, tint: "bg-blue-50 text-blue-600", caption: `${data.customerStatuses.find(s => s.status === "INACTIVE")?.count ?? 0} inactive / reactivation prospects`, to: "/customers" },
    { label: "Total leads", value: data.totalLeads.toLocaleString(), icon: Target, tint: "bg-violet-50 text-violet-600", caption: "Your next opportunities", to: "/leads" },
    { label: "Total opportunities", value: data.totalOpportunities.toLocaleString(), icon: Gem, tint: "bg-cyan-50 text-cyan-600", caption: "Across all pipeline stages", to: "/opportunities" },
    { label: "Revenue this month", value: shortMoney(data.revenueThisMonth), icon: CircleDollarSign, tint: "bg-emerald-50 text-emerald-600", caption: `${data.completedSalesThisMonth} completed transactions`, to: "/transactions" },
    { label: "Revenue last month", value: shortMoney(data.revenueLastMonth), icon: CalendarDays, tint: "bg-amber-50 text-amber-600", caption: "Previous calendar month", to: "/transactions" },
    { label: "Pipeline value", value: shortMoney(data.pipelineValue), icon: TrendingUp, tint: "bg-indigo-50 text-indigo-600", caption: "Open opportunities only", to: "/opportunities" },
  ];
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2"><span className="eyebrow text-primary">Executive dashboard</span><span className="rounded bg-blue-50 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-blue-500">Live overview</span></div><h1 className="page-heading">A little clarity. A lot of possibility.</h1><p className="mt-2 text-xs text-muted-foreground">Welcome back, {user?.name.split(" ")[0]}. Here&apos;s how your retail business is doing.</p></div><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Refresh dashboard" onClick={() => void load()} disabled={loading}><RefreshCw className={cn(loading && "animate-spin")} /></Button>{user?.role !== "GUEST" && <Button asChild size="sm" className="h-9"><Link to="/leads?new=1"><Plus />New lead</Link></Button>}</div></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-[11px] text-slate-500"><span className="size-1.5 rounded-full bg-emerald-500" />{data.scope === "own" ? "Your records and sales only" : "Company-wide business overview"}</div><div className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-[10px] font-medium text-slate-600"><CalendarDays className="size-3.5 text-slate-400" />{month}<span className="ml-1 border-l pl-2 text-[9px] text-slate-400">UTC</span></div></div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-6">{stats.map(stat => <Link key={stat.label} to={stat.to} className="group min-w-0"><Card className="h-full p-4 transition-shadow hover:border-blue-200 hover:shadow-md"><div className="flex items-center justify-between"><span className={cn("grid size-8 place-items-center rounded-lg", stat.tint)}><stat.icon className="size-4" /></span><ArrowUpRight className="size-3.5 text-slate-300 transition-colors group-hover:text-primary" /></div><p className="mt-4 text-[10px] font-medium text-slate-500">{stat.label}</p><p className="mt-1.5 truncate text-[24px] font-semibold leading-tight tracking-tight" title={stat.label.includes("Revenue") || stat.label === "Pipeline value" ? money(stat.label === "Pipeline value" ? data.pipelineValue : stat.label === "Revenue this month" ? data.revenueThisMonth : data.revenueLastMonth) : undefined}>{stat.value}</p><p className="mt-3 text-[9px] text-slate-400">{stat.caption}</p></Card></Link>)}</div>
    <div className="grid gap-5 xl:grid-cols-[1.8fr_1fr]">
      <Card><SectionHeader title="Revenue overview" subtitle="Last 3 months - current month is month to date" /><div className="flex flex-wrap items-end gap-3 px-5 pt-4"><p className="text-2xl font-semibold tracking-tight">{money(data.revenueThisMonth)}</p>{growth !== null && <span className={cn("mb-1 inline-flex items-center text-[10px] font-medium", growth >= 0 ? "text-emerald-600" : "text-red-500")}>{growth >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{Math.abs(growth).toFixed(1)}%<span className="ml-1 font-normal text-slate-400">MTD vs full last month</span></span>}</div>
        <div className="h-[245px] w-full px-3 pb-3 pt-5" role="img" aria-label={`Monthly revenue chart. This month ${money(data.revenueThisMonth)}, last month ${money(data.revenueLastMonth)}.`}><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.monthly} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}><defs><linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3970ee" stopOpacity={0.19} /><stop offset="95%" stopColor="#3970ee" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#eef1f6" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} dy={8} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} tickFormatter={v => `${Number(v) / 1e6}M`} width={47} /><Tooltip contentStyle={chartTooltip} formatter={value => [money(Number(value)), "Revenue"]} /><Area type="monotone" dataKey="revenue" stroke="#3970ee" strokeWidth={2.5} fill="url(#revenueGradient)" activeDot={{ r: 5, stroke: "white", strokeWidth: 3 }} /></AreaChart></ResponsiveContainer></div>
      </Card>
      <Card><SectionHeader title="Lead sources" subtitle="Where your customer journeys begin" />{data.leadSources.length ? <><div className="relative mx-auto h-[190px] max-w-xs" role="img" aria-label={`${data.totalLeads} leads by source`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.leadSources} dataKey="count" nameKey="source" innerRadius={57} outerRadius={76} paddingAngle={4} strokeWidth={0}>{data.leadSources.map((source, i) => <Cell key={source.source} fill={palette[i % palette.length]} />)}</Pie><Tooltip contentStyle={chartTooltip} formatter={(value, name) => [value, humanize(String(name))]} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-[27px] font-semibold tracking-tight">{data.totalLeads}</span><span className="text-[9px] text-slate-400">Total leads</span></div></div><div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 pb-5">{data.leadSources.map((source, i) => <div key={source.source} className="flex items-center gap-2 text-[10px]"><span className="size-2 rounded-sm" style={{ backgroundColor: palette[i % palette.length] }} /><span className="text-slate-500">{humanize(source.source)}</span><span className="ml-auto font-semibold">{source.count}</span></div>)}</div></> : <EmptyState title="No lead sources yet" description="Create your first lead to start tracking acquisition." />}</Card>
    </div>
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr_1fr]">
      <Card><SectionHeader title="Sales trend" subtitle="Weekly completed sales - first / last weeks may be partial" /><div className="h-[220px] px-2 pb-4 pt-5" role="img" aria-label="Weekly completed sales count over the last three months"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.weekly} margin={{ left: -20, right: 10 }}><CartesianGrid vertical={false} strokeDasharray="3 5" stroke="#eef1f6" /><XAxis dataKey="week" tickFormatter={v => new Date(String(v)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} minTickGap={20} axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} dy={5} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} /><Tooltip labelFormatter={value => `Week of ${dateLabel(String(value))}`} cursor={{ fill: "#f6f8fc" }} contentStyle={chartTooltip} formatter={value => [value, "Sales"]} /><Bar dataKey="sales" radius={[4, 4, 0, 0]} maxBarSize={27}>{data.weekly.map((week, i) => <Cell key={week.week} fill={i === data.weekly.length - 1 ? "#3970ee" : "#cbdcff"} />)}</Bar></BarChart></ResponsiveContainer></div></Card>
      <Card><SectionHeader title="Open sales pipeline" subtitle="Unweighted value by stage" to="/opportunities" /><div className="space-y-5 px-5 py-6">{visibleStages.map((stage, i) => {
        const row = data.pipeline.find(s => s.stage === stage);
        return <div key={stage}><div className="mb-2 flex justify-between text-[10px]"><span className="text-slate-500">{humanize(stage)} <span className="ml-1 text-slate-400">({row?.count ?? 0})</span></span><span className="font-medium">{shortMoney(row?.value ?? 0)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${(row?.value ?? 0) / maxPipeline * 100}%`, backgroundColor: palette[i] }} /></div></div>;
      })}</div></Card>
      <Card><SectionHeader title="Top salespeople" subtitle="This month's revenue leaders" /><div className="px-5 py-3">{data.topSalespeople.length ? data.topSalespeople.map((person, i) => <div key={person.id} className="flex items-center gap-3 border-b py-3 last:border-0"><span className="w-2 text-[10px] text-slate-400">{i + 1}</span><span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[9px] font-semibold", ["bg-blue-50 text-blue-600", "bg-violet-50 text-violet-600", "bg-cyan-50 text-cyan-600", "bg-amber-50 text-amber-600"][i])}>{initials(person.name)}</span><div className="min-w-0"><p className="truncate text-[11px] font-medium">{person.name}</p><p className="mt-1 text-[9px] text-slate-400">{person.sales} sales closed</p></div><span className="ml-auto text-[11px] font-semibold">{shortMoney(person.revenue)}</span></div>) : <EmptyState title="A fresh start" description="Completed transactions will appear here." />}</div></Card>
    </div>
    <RetailInsights data={data} />
    {data.sampleData && <p className="rounded-lg border border-blue-100 bg-blue-50/40 px-4 py-3 text-[11px] leading-5 text-slate-500">Historical sample: {dateLabel(data.sampleData.periodStart)} to {dateLabel(data.sampleData.periodEnd)}. Reports combine this batch with your existing records; no previous data was replaced.</p>}
    <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
      <Card className="overflow-hidden"><SectionHeader title="Top-selling products" subtitle="Your best performers this month, ranked by revenue" to="/products" /><div className="mt-5 overflow-x-auto">{data.topProducts.length ? <table className="w-full whitespace-nowrap"><thead className="table-head"><tr><th className="px-5 py-3 text-[9px]">Product</th><th className="px-3 py-3 text-[9px]">Units sold</th><th className="px-5 py-3 text-right text-[9px]">Revenue</th></tr></thead><tbody>{data.topProducts.map((product, i) => <tr key={product.id} className="border-t"><td className="px-5 py-3"><div className="flex items-center gap-3"><span className={cn("grid size-9 place-items-center rounded-lg", ["bg-slate-100", "bg-blue-50", "bg-violet-50", "bg-cyan-50", "bg-amber-50"][i])}><Smartphone className="size-5 text-slate-500" /></span><div><p className="text-[11px] font-medium">{product.name}</p><p className="mt-1 text-[9px] text-slate-400">{product.brand}</p></div></div></td><td className="px-3 text-[11px] text-slate-500">{product.units} units</td><td className="px-5 text-right text-[11px] font-semibold">{money(product.revenue)}</td></tr>)}</tbody></table> : <EmptyState title="Your next best seller is waiting" description="Complete a transaction to see top products here." />}</div></Card>
      <Card><SectionHeader title="Recent activities" subtitle="The latest updates from your team" to="/activities" /><div className="px-5 pb-2 pt-3">{data.recentActivities.length ? data.recentActivities.map((activity, i) => {
        const Icon = icons[activity.type] ?? Activity;
        return <div key={activity.id} className="relative flex gap-3 py-3">{i < data.recentActivities.length - 1 && <span className="absolute bottom-[-12px] left-3.5 top-11 border-l border-dashed" />}<span className={cn("z-10 grid size-7 shrink-0 place-items-center rounded-full", activity.status === "COMPLETED" ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-500")}><Icon className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-1"><p className="text-[11px] font-medium">{activity.subject}</p><span className="text-[9px] text-slate-400">{dateLabel(activity.dueAt)}</span></div><p className="mt-1.5 text-[9px] text-slate-400">{activity.owner.name}{activity.customer ? ` · ${activity.customer.name}` : ""}</p><Badge value={activity.status} className="mt-2 px-2 py-0.5 text-[8px]" /></div></div>;
      }) : <EmptyState title="No activities yet" description="Schedule a follow-up to keep the conversation going." />}</div></Card>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50/40 px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-full bg-blue-100/70 text-blue-500"><ShoppingBag className="size-4" /></span><div><p className="text-xs font-medium">Every great sale starts with a great conversation.</p><p className="mt-1 text-[10px] text-slate-500">Keep your pipeline moving with a timely follow-up.</p></div></div><Link to="/activities?new=1" className="flex items-center gap-2 text-[11px] font-semibold text-primary">Schedule activity<ArrowRight className="size-3.5" /></Link></div>
  </div>;
}
