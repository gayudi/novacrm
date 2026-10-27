import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./auth";
import { Layout } from "./components/layout";
import { CopilotLauncher, CopilotPage } from "./components/copilot";
import { Button } from "./components/ui/button";
import { DashboardPage } from "./pages/dashboard";
import { LoginPage } from "./pages/login";
import { ResourcePage } from "./pages/resource";
import { resources } from "./lib/resources";
import "./index.css";

function Protected() {
  const { user } = useAuth();
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
function AdminOnly() {
  const { user } = useAuth();
  return user?.role === "ADMIN" ? <Outlet /> : <Navigate to="/" replace />;
}
function NotFound() {
  return <div className="grid min-h-[50vh] place-content-center text-center"><p className="text-6xl font-bold text-blue-100">404</p><h1 className="mt-4 text-xl font-semibold">This page is off the map.</h1><p className="mt-2 text-sm text-slate-500">Let&apos;s get you back to your workspace.</p><Button asChild className="mx-auto mt-6"><Link to="/">Back to overview</Link></Button></div>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><BrowserRouter><AuthProvider><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/copilot" element={<CopilotPage />} />
    <Route element={<Protected />}><Route element={<Layout />}>
      <Route index element={<DashboardPage />} />
      {resources.filter(resource => resource.key !== "users").map(resource => <Route key={resource.key} path={resource.key} element={<ResourcePage key={resource.key} resource={resource} />} />)}
      <Route element={<AdminOnly />}>{resources.filter(resource => resource.key === "users").map(resource => <Route key={resource.key} path={resource.key} element={<ResourcePage resource={resource} />} />)}</Route>
      <Route path="*" element={<NotFound />} />
    </Route></Route>
  </Routes><CopilotLauncher /></AuthProvider><Toaster richColors closeButton position="top-right" /></BrowserRouter></React.StrictMode>,
);
