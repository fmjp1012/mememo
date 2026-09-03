import { supabase } from "./authClient.js";

async function getAccessToken() {
  if (!supabase) return "";
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? "";
}

async function adminRequest(path, options = {}) {
  const accessToken = options.accessToken ?? await getAccessToken();
  if (!accessToken && import.meta.env.DEV && import.meta.env.VITE_MEMEMO_DEV_ADMIN === "1") {
    // The Vite development middleware supplies a local-only mock admin session.
  } else if (!accessToken) {
    throw new Error("ログインが必要です。");
  }
  const headers = new Headers(options.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "管理画面のデータを取得できませんでした。");
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function checkAdminAccess(accessToken = "") {
  return adminRequest("/api/admin/session", { accessToken });
}

export function loadAdminDashboard() {
  return adminRequest("/api/admin/dashboard");
}

export function updateSupportStatus(id, status) {
  return adminRequest(`/api/admin/support/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function createAnnouncement(values) {
  return adminRequest("/api/admin/announcements", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function updateAnnouncement(id, values) {
  return adminRequest(`/api/admin/announcements/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(values),
  });
}

export async function loadPublicAnnouncements() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, body, link_url, published_at")
    .eq("is_active", true)
    .order("published_at", { ascending: false })
    .limit(3);
  if (error) return [];
  return data ?? [];
}
