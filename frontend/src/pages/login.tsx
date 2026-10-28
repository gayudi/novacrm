import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { ArrowRight, BarChart3, Check, Eye, EyeOff, Loader2, ShieldCheck, Smartphone, Users } from "lucide-react";
import { useAuth } from "@/auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPage() {
  const { user, login, loginAsGuest } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [guestPending, setGuestPending] = useState(false);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState<{ demo: boolean; adminEmail?: string }>();
  const [configError, setConfigError] = useState("");
  useEffect(() => {
    api<{ demo: boolean; adminEmail?: string }>("/auth/config").then(setDemo).catch(err => setConfigError(err instanceof Error ? err.message : "Could not connect to the server."));
  }, []);
  if (user) return <Navigate to={params.get("next") === "copilot" ? "/copilot" : "/"} replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || guestPending) return;
    setPending(true); setError("");
    try { await login(email, password); }
    catch (err) { setError(err instanceof Error ? err.message : "Sign-in failed."); }
    finally { setPending(false); }
  }
  async function enterAsGuest() {
    if (pending || guestPending) return;
    setGuestPending(true); setError("");
    try { await loginAsGuest(); }
    catch (err) { setError(err instanceof Error ? err.message : "Guest sign-in failed."); }
    finally { setGuestPending(false); }
  }
  return <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#101b33] p-12 text-white lg:flex xl:p-16">
      <div className="absolute -right-32 top-20 size-[500px] rounded-full border border-white/5 bg-blue-500/5" /><div className="absolute -bottom-52 -left-24 size-[650px] rounded-full border border-white/5" />
      <div className="relative flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-primary"><Smartphone className="size-6" /></span><span className="text-2xl font-bold tracking-tight">nova<span className="text-blue-400">.</span></span><span className="ml-3 border-l border-white/15 pl-4 text-[10px] uppercase tracking-[.2em] text-slate-400">Retail CRM</span></div>
      <div className="relative my-16 max-w-lg">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1.5 text-xs text-blue-200"><span className="size-1.5 rounded-full bg-blue-400" /> Your next chapter in retail</div>
        <h1 className="text-5xl font-semibold leading-[1.15] tracking-tight">Great connections.<br /><span className="text-blue-400">Even greater sales.</span></h1>
        <p className="mt-6 max-w-sm text-base leading-7 text-slate-400">Bring your customers, conversations, and sales together in one beautifully simple workspace.</p>
        <div className="mt-10 space-y-4">{[
          [Users, "Know every customer, beyond the purchase"],
          [BarChart3, "Turn your pipeline into real performance"],
          [ShieldCheck, "Keep your team connected and in control"],
        ].map(([Icon, text]) => {
          const Component = Icon as typeof Users;
          return <div key={String(text)} className="flex items-center gap-3 text-sm text-slate-300"><Component className="size-4 text-blue-400" />{String(text)}</div>;
        })}</div>
        <div className="mt-12 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-400"><Check className="size-5" /></span><div><p className="text-sm font-medium">Made for smartphone retail</p><p className="mt-1 text-xs text-slate-400">From the first hello to the next upgrade.</p></div></div>
      </div>
      <p className="relative text-xs text-slate-500">Nova Retail CRM &copy; {new Date().getFullYear()} &middot; A smarter way to sell.</p>
    </aside>
    <main className="flex items-center justify-center bg-white px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-10 flex items-center gap-2 lg:hidden"><Smartphone className="text-primary" /><span className="text-2xl font-bold">nova.</span></div>
        <div className="mb-8"><p className="eyebrow mb-3 text-primary">Your workspace awaits</p><h2 className="text-3xl font-bold tracking-tight">Welcome back</h2><p className="mt-3 text-sm text-muted-foreground">Sign in to keep your business moving forward.</p></div>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="email">Work email</Label><Input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="h-11" /></div>
          <div className="space-y-2"><Label htmlFor="password">Password</Label><div className="relative"><Input id="password" type={visible ? "text" : "password"} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" className="h-11 pr-11" /><button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)} className="absolute right-3 top-3 text-slate-400">{visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button></div></div>
          {(error || configError) && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error || configError}</p>}
          <Button type="submit" className="h-11 w-full" disabled={pending || guestPending}>{pending ? <Loader2 className="animate-spin" /> : <>Sign in to your workspace<ArrowRight /></>}</Button>
        </form>
        <div className="mt-5 border-t pt-5">
          <Button type="button" variant="outline" className="h-11 w-full" disabled={pending || guestPending} onClick={() => void enterAsGuest()}>{guestPending ? <Loader2 className="animate-spin" /> : <Eye />}Login as a guest</Button>
          <p className="mt-2 text-center text-xs leading-5 text-slate-500">Explore all CRM business data and Copilot. Read-only access: no adding, editing, deleting, or converting records.</p>
        </div>
        <p className="mt-5 text-center text-xs text-slate-400">Need access? Contact your workspace administrator.</p>
        {demo?.demo && <div className="mt-10 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
          <p className="text-xs font-semibold text-slate-700">Explore the demo workspace</p><p className="mt-1 text-xs leading-5 text-slate-500">Choose a role to fill in the default demo credentials.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">{[
            { role: "Admin", email: demo.adminEmail ?? "admin@nova.example", password: "AdminDemo2026!" },
            { role: "Manager", email: "manager@nova.example", password: "ManagerDemo2026!" },
            { role: "Sales", email: "sales@nova.example", password: "SalesDemo2026!" },
          ].map(account => <Button key={account.role} type="button" variant="outline" size="sm" onClick={() => { setEmail(account.email); setPassword(account.password); setError(""); }}>{account.role}</Button>)}</div>
          <p className="mt-3 text-[10px] leading-4 text-slate-400">Custom passwords configured by your administrator override these defaults.</p>
        </div>}
        <div className="mt-8 flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><ShieldCheck className="size-3.5" /> Role-based access &middot; Secure JWT authentication</div>
      </div>
    </main>
  </div>;
}
