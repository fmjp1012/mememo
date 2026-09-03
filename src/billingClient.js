import { supabase } from "./authClient.js";

async function getAccessToken() {
  if (!supabase) return "";
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? "";
}

async function apiRequest(path, options = {}) {
  const accessToken = options.accessToken ?? await getAccessToken();
  const headers = new Headers(options.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "処理に失敗しました。時間をおいて再度お試しください。");
  return payload;
}

export async function getMembership(accessToken = "") {
  if (import.meta.env.DEV && import.meta.env.VITE_MEMEMO_DEV_FULL_ACCESS === "1") {
    return { premium: true, status: "complimentary", plan: "full-access", complimentaryAccess: true };
  }
  if (import.meta.env.DEV && import.meta.env.VITE_MEMEMO_DEV_PREMIUM === "1") {
    return { premium: true, status: "active", plan: "development", complimentaryAccess: false };
  }
  if (!accessToken) return { premium: false, status: "free", plan: null, complimentaryAccess: false };
  return apiRequest("/api/billing/status", { accessToken });
}

export async function createCheckout(interval) {
  return apiRequest("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ interval }),
  });
}

export async function createBillingPortal() {
  return apiRequest("/api/billing/portal", {
    method: "POST",
    body: JSON.stringify({}),
  });
}
