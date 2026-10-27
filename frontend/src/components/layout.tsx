import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Activity, ChevronDown, ChevronRight, CircleHelp, ContactRound, Gem, LayoutDashboard, LogOut, Menu, Package, PanelLeftClose, Search, Settings2, ShoppingBag, Smartphone, Target, Users, X } from "lucide-react";
import { useAuth } from "@/auth";
import { cn, humanize, initials } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

const links = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/customers", label: "Customers", icon: Users },
  { path: "/contacts", label: "Contacts", icon: ContactRound },
  { path: "/leads", label: "Leads", icon: Target },
  { path: "/opportunities", label: "Opportunities", icon: Gem },
  { path: "/activities", label: "Activities", icon: Activity },
  { path: "/products", label: "Products", icon: Package },
  { path: "/transactions", label: "Sales transactions", icon: ShoppingBag },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const location = useLocation();
  const active = links.find(link => link.path === location.pathname)?.label ?? (location.pathname === "/users" ? "Team management" : "Workspace");
  return <div className="min-h-screen">
    <a href="#main-content" className="sr-only z-[70] rounded bg-white p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
    {open && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setOpen(false)} />}
    <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col bg-[#111c34] text-slate-300 transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex h-[80px] items-center gap-3 px-6"><span className="grid size-9 place-items-center rounded-lg bg-primary text-white shadow-lg shadow-blue-900/20"><Smartphone className="size-5" /></span><div><span className="text-[25px] font-bold leading-none tracking-tight text-white">nova<span className="text-blue-400">.</span></span><p className="mt-1 text-[8px] uppercase tracking-[.22em] text-slate-500">Retail CRM</p></div><button className="ml-auto lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X className="size-5" /></button></div>
      <div className="mx-4 mb-7 mt-1 flex items-center gap-3 rounded-md border border-white/10 bg-white/[.035] p-3"><span className="grid size-7 place-items-center rounded bg-blue-400/10 text-xs font-semibold text-blue-300">NR</span><div><p className="text-xs font-medium text-slate-200">Nova Retail</p><p className="mt-0.5 text-[9px] text-slate-500">Indonesia workspace</p></div><ChevronDown className="ml-auto size-3 text-slate-500" /></div>
      <nav className="flex-1 overflow-y-auto px-3" aria-label="Main navigation"><p className="eyebrow mb-3 px-3 text-slate-500">Workspace</p>
        {links.map(({ path, label, icon: Icon }, index) => <NavLink key={path} to={path} end={path === "/"} onClick={() => setOpen(false)} className={({ isActive }) => cn("mb-1 flex items-center gap-3 rounded-md px-3 py-2.5 text-[12px] font-medium transition-colors", isActive ? "bg-primary text-white shadow-md shadow-blue-950/20" : "text-slate-400 hover:bg-white/5 hover:text-white", index === 6 && "mt-5")}><Icon className="size-[17px]" />{label}</NavLink>)}
        {user?.role === "ADMIN" && <><p className="eyebrow mb-3 mt-7 px-3 text-slate-500">Administration</p><NavLink to="/users" onClick={() => setOpen(false)} className={({ isActive }) => cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-[12px] font-medium", isActive ? "bg-primary text-white" : "text-slate-400 hover:bg-white/5")}><Settings2 className="size-[17px]" />Team management</NavLink></>}
      </nav>
      <div className="flex items-center justify-between border-t border-white/5 px-6 py-4"><span className="text-[10px] text-slate-500">NOVA CRM <span className="ml-1 text-slate-600">v1.0</span></span><PanelLeftClose className="size-3.5 text-slate-600" /></div>
    </aside>
    <div className="lg:pl-[232px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b bg-white/95 px-5 backdrop-blur-md md:px-8">
        <div className="flex items-center gap-3"><Button aria-label="Open menu" variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}><Menu /></Button><span className="hidden text-xs text-slate-400 sm:inline">Workspace</span><ChevronRight className="hidden size-3 text-slate-300 sm:block" /><span className="text-xs font-medium text-slate-600">{active}</span></div>
        <div className="flex items-center gap-3 md:gap-5"><span className="hidden items-center gap-1.5 text-[10px] text-slate-500 md:flex"><span className="size-1.5 rounded-full bg-emerald-500" />Connected workspace</span><button aria-label="Open workspace guide" className="text-slate-400 hover:text-primary" onClick={() => setHelp(true)}><CircleHelp className="size-[18px]" /></button><div className="h-6 border-l" /><div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-full bg-blue-50 text-[10px] font-semibold text-primary">{initials(user?.name ?? "")}</span><div className="hidden sm:block"><p className="text-[11px] font-semibold">{user?.name}</p><p className="mt-0.5 text-[9px] text-slate-400">{humanize(user?.role ?? "")}</p></div></div><button onClick={logout} aria-label="Sign out" title="Sign out" className="text-slate-400 hover:text-red-500"><LogOut className="size-4" /></button></div>
      </header>
      <main id="main-content" className="mx-auto max-w-[1660px] px-5 py-7 md:px-8"><Outlet /></main>
      <footer className="mx-5 flex flex-wrap items-center justify-between gap-2 border-t py-5 text-[10px] text-slate-400 md:mx-8"><span>Nova Retail CRM &copy; {new Date().getFullYear()}</span><span>Designed for relationships. Built for growth.</span></footer>
    </div>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent><DialogTitle>Your workspace, at a glance</DialogTitle><DialogDescription>A simple workflow for a connected retail team.</DialogDescription><ol className="mt-6 space-y-5 text-sm">{[
      ["Build relationships", "Create customers and contacts. Capture new interest as a lead and assign a team member."],
      ["Move deals forward", "Create an opportunity, set its value and probability, and update the stage as the deal progresses."],
      ["Stay on top of follow-ups", "Schedule calls, meetings, and tasks in Activities. Mark them complete when finished."],
      ["Close the sale", "Create a sales transaction. Completed sales reduce stock and appear in dashboard revenue. Pending and cancelled sales do not."],
    ].map(([title, text], i) => <li className="flex gap-3" key={title}><span className="grid size-6 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-primary">{i + 1}</span><div><p className="font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div></li>)}</ol><p className="mt-6 rounded-md bg-slate-50 p-3 text-xs leading-5 text-muted-foreground">You are signed in as {humanize(user?.role ?? "")}. Sales can only view, create and edit their own CRM records, with contacts inherited from their customers. Dashboard, search and Copilot follow the same restrictions. Managers and Admins have company-wide access and can manage products and delete records. Only Admins manage the team.</p></DialogContent></Dialog>
  </div>;
}
