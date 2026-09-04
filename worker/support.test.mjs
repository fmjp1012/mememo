import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

const baseEnv = {
  PUBLIC_SITE_URL: "https://mememo-study.com",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-test",
};

function supportRequest(body) {
  return new Request("https://mememo-study.com/api/support", {
    method: "POST",
    headers: {
      Origin: "https://mememo-study.com",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.10",
    },
    body: JSON.stringify(body),
  });
}

test("support submissions are rate limited and server-authored", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let stored;
  globalThis.fetch = async (_url, init) => {
    stored = JSON.parse(init.body);
    return new Response(null, { status: 201 });
  };
  const response = await worker.fetch(
    supportRequest({
      type: "contact",
      subject: "Help",
      message: "Please help",
      user_id: "forged-user",
    }),
    { ...baseEnv, SUPPORT_RATE_LIMITER: { limit: async () => ({ success: true }) } }
  );
  assert.equal(response.status, 201);
  assert.equal(stored.user_id, null);
  assert.equal(stored.subject, "Help");
});

test("support submissions fail closed when the rate limiter denies", async () => {
  const response = await worker.fetch(
    supportRequest({ type: "contact", subject: "Help", message: "Please help" }),
    { ...baseEnv, SUPPORT_RATE_LIMITER: { limit: async () => ({ success: false }) } }
  );
  assert.equal(response.status, 429);
});

test("support submissions fail closed without a limiter binding", async () => {
  const response = await worker.fetch(
    supportRequest({ type: "contact", subject: "Help", message: "Please help" }),
    baseEnv
  );
  assert.equal(response.status, 503);
});
