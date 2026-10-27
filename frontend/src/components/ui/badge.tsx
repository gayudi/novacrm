import type { HTMLAttributes } from "react";
import { cn, humanize } from "@/lib/utils";

const colors: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700", INACTIVE: "bg-slate-100 text-slate-500",
  COMPLETED: "bg-emerald-50 text-emerald-700", WON: "bg-emerald-50 text-emerald-700", QUALIFIED: "bg-emerald-50 text-emerald-700",
  CONVERTED: "bg-emerald-50 text-emerald-700", VIP: "bg-violet-50 text-violet-700", ADMIN: "bg-violet-50 text-violet-700",
  NEW: "bg-blue-50 text-blue-700", PROPOSAL: "bg-blue-50 text-blue-700", REGULAR: "bg-blue-50 text-blue-700",
  CONTACTED: "bg-cyan-50 text-cyan-700", MANAGER: "bg-cyan-50 text-cyan-700", CORPORATE: "bg-cyan-50 text-cyan-700",
  PENDING: "bg-amber-50 text-amber-700", NEGOTIATION: "bg-amber-50 text-amber-700", PLANNED: "bg-amber-50 text-amber-700",
  LOST: "bg-red-50 text-red-600", CANCELLED: "bg-slate-100 text-slate-500",
};
export function Badge({ value, className, ...props }: HTMLAttributes<HTMLSpanElement> & { value: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold", colors[value] ?? "bg-indigo-50 text-indigo-600", className)} {...props}><span className="size-1.5 rounded-full bg-current opacity-65" />{humanize(value)}</span>;
}
