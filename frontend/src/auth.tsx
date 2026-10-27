import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, ApiError, session, type User } from "@/lib/api";
import { ErrorState, Loading } from "@/components/feedback";
import { useMatch } from "react-router-dom";

type AuthContextValue = { user: User | null; login: (email: string, password: string) => Promise<void>; logout: () => void };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const isCopilot = Boolean(useMatch("/copilot"));
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const restore = useCallback(async () => {
    setLoading(true); setError("");
    try { if (session.get()) setUser(await api<User>("/auth/me")); }
    catch (err) {
      if (err instanceof ApiError && err.status === 401) session.clear();
      else setError(err instanceof Error ? err.message : "Could not restore your session.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void restore(); }, [restore]);
  useEffect(() => {
    const expired = () => { setUser(null); toast.error(isCopilot ? "Sesi Anda berakhir. Silakan masuk kembali." : "Your session expired. Please sign in again."); };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, [isCopilot]);
  async function login(email: string, password: string) {
    const response = await api<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    session.set(response.token); setUser(response.user);
  }
  function logout() { session.clear(); setUser(null); }
  if (loading) return <div className="grid min-h-screen place-items-center"><Loading label={isCopilot ? "Memuat ruang kerja Anda..." : undefined} /></div>;
  if (error) return <div className="mx-auto mt-24 max-w-lg"><ErrorState error={isCopilot ? "Sesi tidak dapat dipulihkan. Periksa koneksi ke server lalu coba lagi." : error} retry={() => void restore()} retryLabel={isCopilot ? "Coba lagi" : undefined} /></div>;
  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
