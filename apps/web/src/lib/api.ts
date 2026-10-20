import type { ApiErrorBody } from "@reel/shared";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "") + "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: ApiErrorBody["issues"] = [],
  ) {
    super(message);
  }

  /** Field path → message, for showing validation errors next to inputs. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.issues ?? []).map((i) => [i.path, i.message]));
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined || isForm ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the API. Is `pnpm dev` running?");
  }
  if (response.status === 401 && !path.startsWith("/auth/") && typeof window !== "undefined" && window.location.pathname !== "/login") {
    // A full load, not a client-side push: the session is gone and every query and stream must restart.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new ApiError(401, "Signed out");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    // nginx answers some errors (401, 429, 502) with HTML.
    data = undefined;
  }
  if (!response.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(response.status, err.message ?? response.statusText, err.issues);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T = void>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const details = (error.issues ?? []).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
    return details.length ? `${error.message}: ${details.join("; ")}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
