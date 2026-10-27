import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "./ui/card";
import { EmptyState } from "./feedback";
import { humanize, money, shortMoney } from "@/lib/utils";

export type RetailInsightsData = {
  branchPerformance: { branch: string; sales: number; revenue: number }[];
  customerStatuses: { status: string; count: number }[];
  outcomes: { stage: string; count: number }[];
  activityTypes: { type: string; count: number }[];
};
const tooltipStyle = { borderRadius: 8, border: "1px solid #e8ecf3", fontSize: 11 };

function Distribution({ title, subtitle, rows }: { title: string; subtitle: string; rows: { name: string; count: number; color: string }[] }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return <Card className="p-5">
    <h2 className="text-[13px] font-semibold">{title}</h2><p className="mt-1 text-[10px] text-slate-400">{subtitle}</p>
    {total ? <>
      <div className="relative h-40" role="img" aria-label={rows.map(row => `${humanize(row.name)}: ${row.count}`).join(", ")}>
        <ResponsiveContainer width="100%" height="100%"><PieChart>
          <Pie data={rows} dataKey="count" nameKey="name" innerRadius={45} outerRadius={62} paddingAngle={3} strokeWidth={0}>
            {rows.map(row => <Cell key={row.name} fill={row.color} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [value, humanize(String(name))]} />
        </PieChart></ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-semibold">{total}</span><span className="text-[9px] text-slate-400">Total</span></div>
      </div>
      <div className="space-y-3">{rows.map(row => <div key={row.name} className="flex items-center gap-2 text-[10px]">
        <span className="size-2 rounded-full" style={{ backgroundColor: row.color }} /><span className="text-slate-500">{humanize(row.name)}</span><span className="ml-auto font-semibold">{row.count}</span>
      </div>)}</div>
    </> : <EmptyState title="No records yet" />}
  </Card>;
}

export function RetailInsights({ data }: { data: RetailInsightsData }) {
  const branchRows = data.branchPerformance.filter(b => b.branch !== "UNASSIGNED" || b.sales > 0).map(b => ({ ...b, name: humanize(b.branch) }));
  const won = data.outcomes.find(o => o.stage === "WON")?.count ?? 0;
  const lost = data.outcomes.find(o => o.stage === "LOST")?.count ?? 0;
  return <>
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      <Card className="p-5 md:col-span-2">
        <h2 className="text-[13px] font-semibold">Branch performance</h2><p className="mt-1 text-[10px] text-slate-400">Completed revenue across the last 3 months, including month to date</p>
        <div className="mt-4 h-[230px]" role="img" aria-label={branchRows.map(b => `${b.name}: ${money(b.revenue)}`).join(", ")}>
          <ResponsiveContainer width="100%" height="100%"><BarChart data={branchRows} layout="vertical" margin={{ left: 0, right: 12 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 5" stroke="#eef1f6" />
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#94a3b8" }} tickFormatter={shortMoney} />
            <YAxis type="category" dataKey="name" width={76} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#64748b" }} />
            <Tooltip contentStyle={tooltipStyle} formatter={value => [money(Number(value)), "Revenue"]} />
            <Bar dataKey="revenue" fill="#3970ee" radius={[0, 4, 4, 0]} maxBarSize={20} />
          </BarChart></ResponsiveContainer>
        </div>
        <p className="mt-3 text-[10px] text-slate-400">Unassigned includes older records without a branch; existing records are not relabelled.</p>
      </Card>
      <Distribution title="Customer lifecycle" subtitle="All customers, including your existing records" rows={data.customerStatuses.map(row => ({ name: row.status, count: row.count, color: row.status === "ACTIVE" ? "#35b9bb" : "#c5cfdf" }))} />
      <Distribution title="Opportunity outcomes" subtitle={won + lost ? `${(won / (won + lost) * 100).toFixed(1)}% win rate on closed deals` : "Open, won and lost deals"} rows={data.outcomes.map(row => ({ name: row.stage, count: row.count, color: row.stage === "WON" ? "#35b9bb" : row.stage === "LOST" ? "#ef859c" : "#8b6cef" }))} />
    </div>
    <Card className="p-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-[13px] font-semibold">Customer conversations</h2><p className="text-[10px] text-slate-400">Activities created in the last 3 months</p></div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">{data.activityTypes.map(row => <div key={row.type} className="rounded-md border bg-slate-50/60 p-3"><p className="text-[10px] text-slate-500">{humanize(row.type)}</p><p className="mt-1 text-lg font-semibold">{row.count.toLocaleString()}</p></div>)}</div>
    </Card>
  </>;
}
