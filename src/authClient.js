import { createClient } from "@supabase/supabase-js";

const runtimeConfig = typeof window === "undefined" ? {} : window.__MEMEMO_CONFIG__ ?? {};
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || runtimeConfig.supabaseUrl;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || runtimeConfig.supabaseAnonKey;
let oauthProvidersPromise;

export const authConfigReady = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = authConfigReady
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null;

export function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

export function getEnabledOAuthProviders() {
  if (!authConfigReady) return Promise.resolve([]);
  if (!oauthProvidersPromise) {
    oauthProvidersPromise = fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey },
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Auth settings request failed: ${response.status}`);
        return response.json();
      })
      .then((settings) => ["google", "apple"].filter((provider) => settings?.external?.[provider] === true))
      .catch(() => []);
  }
  return oauthProvidersPromise;
}
