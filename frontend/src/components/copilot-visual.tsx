import { ArrowDown } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/utils";

export type VisualRequest = {
  type: "bar" | "line" | "pie" | "flow";
  metric: "revenue_monthly" | "leads_monthly" | "lead_sources" | "lead_statuses" | "sales_branch" | "top_products" | "pipeline_stages" | "sales_process";
};
export type CopilotVisualData = VisualRequest & {
  title: string; description: string; unit: "IDR" | "lead" | "peluang";
  points: { label: string; value: number }[];
};
export const visualMetrics: { value: VisualRequest["metric"]; label: string }[] = [
  { value: "revenue_monthly", label: "Tren pendapatan (3 bulan)" },
  { value: "leads_monthly", label: "Tren lead baru (3 bulan)" },
  { value: "lead_sources", label: "Sumber lead (seluruh waktu)" },
  { value: "lead_statuses", label: "Status lead (seluruh waktu)" },
  { value: "sales_branch", label: "Pendapatan per cabang (bulan ini)" },
  { value: "top_products", label: "5 produk teratas (bulan ini)" },
  { value: "pipeline_stages", label: "Jumlah peluang per tahap" },
  { value: "sales_process", label: "Alur proses penjualan" },
];
const palette = ["#3970ee", "#8b6cef", "#35b9bb", "#d78817", "#df6580", "#64748b", "#d97706", "#528c49", "#a14ba5"];
const compact = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
const quantity = new Intl.NumberFormat("id-ID");

export function CopilotVisual({ visual }: { visual: CopilotVisualData }) {
  const valueLabel = (value: number) => visual.unit === "IDR" ? money(value) : `${quantity.format(value)} ${visual.unit}`;
  const empty = !visual.points.length || visual.points.every(point => point.value === 0);
  const invalidPie = visual.type === "pie" && visual.points.some(point => point.value < 0);
  const axes = [
    <CartesianGrid key="grid" strokeDasharray="3 3" vertical={false} />,
    <XAxis key="x" dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={12} height={60} tickFormatter={value => String(value).length > 15 ? `${String(value).slice(0, 13)}...` : String(value)} />,
    <YAxis key="y" width={65} tick={{ fontSize: 10 }} tickFormatter={value => compact.format(Number(value))} />,
    <Tooltip key="tooltip" formatter={value => [valueLabel(Number(value)), visual.unit === "IDR" ? "Pendapatan" : "Jumlah"]} />,
  ];
  return <section aria-label={visual.title} className="mt-4 min-w-0 rounded-xl border bg-slate-50/50 p-3">
    <h3 className="text-sm font-semibold text-slate-800">{visual.title}</h3>
    <p className="mt-2 break-words text-[11px] leading-5 text-slate-500">{visual.description}</p>
    {visual.type === "flow" ? <div aria-label="Diagram alur proses penjualan" className="mx-auto my-4 max-w-sm">
      <ol className="space-y-2">{visual.points.slice(0, -2).map((point, index) => <li key={point.label} className="text-center">
        {index > 0 && <ArrowDown aria-hidden="true" className="mx-auto mb-2 size-4 text-indigo-400" />}
        <div className="rounded-lg border border-indigo-200 bg-white px-3 py-2"><p className="text-xs font-medium">{point.label}</p><p className="mt-1 text-[10px] text-slate-500">{valueLabel(point.value)} saat ini</p></div>
      </li>)}</ol>
      <ArrowDown aria-hidden="true" className="mx-auto my-2 size-4 text-indigo-400" />
      <p className="mb-2 text-center text-[10px] text-slate-500">Kemungkinan hasil</p>
      <div className="grid grid-cols-2 gap-3">{visual.points.slice(-2).map(point => <div key={point.label} className="rounded-lg border bg-white p-3 text-center"><p className="text-xs font-semibold">{point.label}</p><p className="mt-1 text-[10px] text-slate-500">{valueLabel(point.value)} saat ini</p></div>)}</div>
    </div> : empty ? <p role="status" className="py-8 text-center text-xs text-slate-500">Belum ada data bernilai untuk grafik pada cakupan dan periode ini.</p>
      : invalidPie ? <p role="alert" className="py-4 text-xs text-red-700">Diagram lingkaran tidak mendukung nilai negatif. Lihat tabel atau pilih grafik batang.</p>
      : <div role="img" aria-label={`${visual.title}. Angka lengkap tersedia pada tabel data.`} className="mt-4 h-64 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          {visual.type === "pie" ? <PieChart>
            <Pie data={visual.points} dataKey="value" nameKey="label" outerRadius="80%" isAnimationActive={false}>{visual.points.map((point, index) => <Cell key={`${index}:${point.label}`} fill={palette[index % palette.length]} />)}</Pie>
            <Tooltip formatter={value => valueLabel(Number(value))} />
          </PieChart> : visual.type === "line" ? <LineChart data={visual.points} margin={{ top: 10, right: 32, bottom: 0, left: 0 }}>
            {axes}<Line type="linear" dataKey="value" name="Jumlah" stroke="#3970ee" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
          </LineChart> : <BarChart data={visual.points} margin={{ top: 10, right: 32, bottom: 0, left: 0 }}>
            {axes}<Bar dataKey="value" name="Jumlah" radius={[4, 4, 0, 0]} isAnimationActive={false}>{visual.points.map((point, index) => <Cell key={`${index}:${point.label}`} fill={palette[index % palette.length]} />)}</Bar>
          </BarChart>}
        </ResponsiveContainer>
      </div>}
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-[11px]">
      <caption className="mb-2 text-left font-medium text-slate-600">Data grafik - {visual.unit === "IDR" ? "rupiah (IDR)" : `jumlah ${visual.unit}`}</caption>
      <thead><tr className="border-b"><th className="py-2 pr-3">Kategori</th><th className="py-2 text-right">Nilai</th></tr></thead>
      <tbody>{visual.points.map((point, index) => <tr key={`${index}:${point.label}`} className="border-b last:border-0"><th scope="row" className="max-w-[180px] break-words py-2 pr-3 font-normal"><span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full" style={{ backgroundColor: palette[visual.type === "line" ? 0 : index % palette.length] }} />{point.label}</th><td className="py-2 text-right tabular-nums">{valueLabel(point.value)}</td></tr>)}</tbody>
    </table></div>
  </section>;
}
