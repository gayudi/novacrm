import { AlertCircle, Loader2, Inbox } from "lucide-react";
import { Button } from "./ui/button";

export function Loading({ label = "Loading your workspace..." }: { label?: string }) {
  return <div role="status" className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin text-primary" />{label}</div>;
}
export function ErrorState({ error, retry, retryLabel = "Try again" }: { error: string; retry: () => void; retryLabel?: string }) {
  return <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-red-100 bg-red-50/50 p-8 text-center"><AlertCircle className="size-6 text-red-500" /><p className="text-sm text-red-700">{error}</p><Button variant="outline" onClick={retry}>{retryLabel}</Button></div>;
}
export function EmptyState({ title = "Nothing here yet", description = "New records will appear here." }: { title?: string; description?: string }) {
  return <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center"><div className="mb-2 rounded-full bg-slate-100 p-3"><Inbox className="size-6 text-slate-400" /></div><p className="text-sm font-semibold">{title}</p><p className="max-w-sm text-xs text-muted-foreground">{description}</p></div>;
}
