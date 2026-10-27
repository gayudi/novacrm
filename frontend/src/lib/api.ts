export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string[]>) { super(message); }
}
const tokenKey = "nova-session";
export const session = {
  get: () => sessionStorage.getItem(tokenKey),
  set: (token: string) => sessionStorage.setItem(tokenKey, token),
  clear: () => sessionStorage.removeItem(tokenKey),
};

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = session.get();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new ApiError(response.status, "The server returned an invalid response. Check that the API is running."); }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/login")) {
      session.clear();
      window.dispatchEvent(new Event("session-expired"));
    }
    const payload = body as { message?: string; errors?: { fieldErrors?: Record<string, string[]> } };
    throw new ApiError(response.status, payload.message ?? "The request could not be completed.", payload.errors?.fieldErrors);
  }
  return body as T;
}

export type User = { id: string; name: string; email: string; role: "ADMIN" | "MANAGER" | "SALES" };
export type EntityRecord = { id: string; [key: string]: unknown };
export type PageResult = { data: EntityRecord[]; total: number; page: number; pageSize: number; totalPages: number };
export type Lookup = { id: string; name: string; price?: string; stock?: number; active?: boolean; customerId?: string };
export type Lookups = { customers: Lookup[]; users: Lookup[]; products: Lookup[]; opportunities: Lookup[] };
