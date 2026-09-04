const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const STRIPE_API_VERSION = "2026-02-25.clover";
const PREMIUM_COOKIE = "mememo_premium";
const PREMIUM_COOKIE_TTL_SECONDS = 300;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.hostname === "www.mememo-study.com") {
        url.hostname = "mememo-study.com";
        return Response.redirect(url.toString(), 308);
      }
      if (request.method === "GET" && url.pathname === "/runtime-config.js") {
        return runtimeConfigResponse(env);
      }
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);
      if (url.pathname.startsWith("/premium/")) return await handlePremiumAsset(request, env);
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      console.error(error);
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError
        ? error.message
        : "サーバー処理に失敗しました。時間をおいて再度お試しください。";
      return json({ error: message }, status);
    }
  },
};

function runtimeConfigResponse(env) {
  const config = JSON.stringify({
    supabaseUrl: env.SUPABASE_URL ?? "",
    supabaseAnonKey: env.SUPABASE_ANON_KEY ?? "",
  }).replace(/</g, "\\u003c");
  const headers = new Headers({
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
  return withSecurityHeaders(new Response(`window.__MEMEMO_CONFIG__ = ${config};\n`, { headers }));
}

async function handleApi(request, env, url) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  if (request.method === "POST" && url.pathname === "/api/support") {
    assertSameOrigin(request, env);
    return submitSupportMessage(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/admin/session") {
    return adminSession(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/admin/dashboard") {
    return adminDashboard(request, env);
  }
  const adminSupportMatch = url.pathname.match(/^\/api\/admin\/support\/([^/]+)$/);
  if (request.method === "PATCH" && adminSupportMatch) {
    assertSameOrigin(request, env);
    return updateAdminSupport(request, env, adminSupportMatch[1]);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/announcements") {
    assertSameOrigin(request, env);
    return createAdminAnnouncement(request, env);
  }
  const adminAnnouncementMatch = url.pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/);
  if (request.method === "PATCH" && adminAnnouncementMatch) {
    assertSameOrigin(request, env);
    return updateAdminAnnouncement(request, env, adminAnnouncementMatch[1]);
  }

  const questionMatch = url.pathname.match(/^\/api\/questions\/([^/]+)$/);
  if (request.method === "GET" && questionMatch) {
    return serveQuestions(request, env, questionMatch[1]);
  }
  if (request.method === "GET" && url.pathname === "/api/billing/status") {
    return billingStatus(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/billing/checkout") {
    assertSameOrigin(request, env);
    return createCheckout(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/billing/portal") {
    assertSameOrigin(request, env);
    return createPortal(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/stripe/webhook") {
    return handleStripeWebhook(request, env);
  }
  return json({ error: "Not found" }, 404);
}

const SUPPORT_LIMITS = Object.freeze({
  subject: 160,
  message: 4000,
  contact_email: 254,
  question_id: 160,
  question_pack_id: 160,
  question_exam_id: 160,
  question_prompt: 2000,
  page_url: 1000,
  user_agent: 500,
});

async function submitSupportMessage(request, env) {
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > 16 * 1024) throw new HttpError(413, "問い合わせ内容が大きすぎます。");
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 16 * 1024) {
    throw new HttpError(413, "問い合わせ内容が大きすぎます。");
  }

  let input;
  try {
    input = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "問い合わせ内容が不正です。");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(422, "問い合わせ内容が不正です。");
  }

  const token = bearerToken(request);
  const user = token ? await authenticateUser(token, env) : null;
  const actorKey = user?.id || request.headers.get("CF-Connecting-IP");
  if (!actorKey || !env.SUPPORT_RATE_LIMITER?.limit) {
    throw new HttpError(503, "問い合わせ機能を一時的に利用できません。");
  }
  const { success } = await env.SUPPORT_RATE_LIMITER.limit({ key: `support:${actorKey}` });
  if (!success) throw new HttpError(429, "送信回数が多すぎます。時間をおいてください。");

  const type = input.type === "contact" || input.type === "question_report" ? input.type : null;
  const requiredString = (name) => {
    const value = typeof input[name] === "string" ? input[name].trim() : "";
    if (!value || value.length > SUPPORT_LIMITS[name]) {
      throw new HttpError(422, "問い合わせ内容が不正です。");
    }
    return value;
  };
  const optionalString = (name) => {
    if (input[name] == null || input[name] === "") return null;
    const value = typeof input[name] === "string" ? input[name].trim() : "";
    if (!value || value.length > SUPPORT_LIMITS[name]) {
      throw new HttpError(422, "問い合わせ内容が不正です。");
    }
    return value;
  };
  if (!type) throw new HttpError(422, "問い合わせ種別が不正です。");

  const questionNumber = input.question_number == null
    ? null
    : Number.isInteger(input.question_number) && input.question_number >= 0 && input.question_number <= 10000
      ? input.question_number
      : undefined;
  if (questionNumber === undefined) throw new HttpError(422, "問題番号が不正です。");

  const payload = {
    type,
    subject: requiredString("subject"),
    message: requiredString("message"),
    contact_email: user?.email || optionalString("contact_email") || null,
    user_id: user?.id ?? null,
    question_id: optionalString("question_id"),
    question_pack_id: optionalString("question_pack_id"),
    question_exam_id: optionalString("question_exam_id"),
    question_number: questionNumber,
    question_prompt: optionalString("question_prompt"),
    page_url: optionalString("page_url"),
    user_agent: optionalString("user_agent"),
  };
  await serviceRest(env, "/rest/v1/support_messages", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  return json({ ok: true }, 201);
}

async function adminSession(request, env) {
  const token = requireBearerToken(request);
  const user = await authenticateUser(token, env);
  return json({ admin: isAdminUser(user, env) });
}

async function requireAdmin(request, env) {
  const token = requireBearerToken(request);
  const user = await authenticateUser(token, env);
  if (!isAdminUser(user, env)) throw new HttpError(403, "管理者権限がありません。");
  return user;
}

function parseCsvSet(value) {
  return new Set(String(value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean));
}

function isAdminUser(user, env) {
  const adminUserIds = parseCsvSet(env.ADMIN_USER_IDS);
  const adminEmails = parseCsvSet(env.ADMIN_EMAILS);
  const userId = String(user?.id ?? "").toLowerCase();
  const email = String(user?.email ?? "").toLowerCase();
  if (userId && adminUserIds.has(userId)) return true;
  const emailConfirmed = Boolean(user?.email_confirmed_at || user?.confirmed_at);
  return emailConfirmed && email && adminEmails.has(email);
}

function hasComplimentaryAccess(user, env) {
  const allowedUserIds = parseCsvSet(env.FULL_ACCESS_USER_IDS);
  const allowedEmails = parseCsvSet(env.FULL_ACCESS_EMAILS);
  const userId = String(user?.id ?? "").toLowerCase();
  const email = String(user?.email ?? "").toLowerCase();
  if (userId && allowedUserIds.has(userId)) return true;
  const emailConfirmed = Boolean(user?.email_confirmed_at || user?.confirmed_at);
  return emailConfirmed && email && allowedEmails.has(email);
}

async function adminDashboard(request, env) {
  const admin = await requireAdmin(request, env);
  const now = new Date();
  const jstParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type) => Number(jstParts.find((item) => item.type === type)?.value ?? 0);
  const startOfTodayJst = new Date(Date.UTC(part("year"), part("month") - 1, part("day")) - 9 * 60 * 60 * 1000);
  const activeSince = encodeURIComponent(startOfTodayJst.toISOString());
  const [
    usersPayload,
    subscriptions,
    learningStates,
    contacts,
    announcements,
    subscriptionCount,
    learningStateCount,
    activeTodayCount,
    openSupportCount,
    activeAnnouncementCount,
  ] = await Promise.all([
    serviceAuthUsers(env, 40),
    serviceRest(env, "/rest/v1/subscriptions?select=user_id,status,stripe_price_id,current_period_end,cancel_at_period_end,created_at,updated_at&order=updated_at.desc&limit=40"),
    serviceRest(env, "/rest/v1/user_learning_state?select=user_id,created_at,updated_at&order=updated_at.desc&limit=40"),
    serviceRest(env, "/rest/v1/support_messages?select=id,created_at,type,subject,message,contact_email,user_id,question_id,status&order=created_at.desc&limit=60"),
    serviceRest(env, "/rest/v1/announcements?select=id,title,body,link_url,is_active,published_at,created_at,updated_at&order=published_at.desc&limit=30"),
    serviceCount(env, "/rest/v1/subscriptions?select=user_id&status=in.(active,trialing)"),
    serviceCount(env, "/rest/v1/user_learning_state?select=user_id"),
    serviceCount(env, `/rest/v1/user_learning_state?select=user_id&updated_at=gte.${activeSince}`),
    serviceCount(env, "/rest/v1/support_messages?select=id&status=neq.closed"),
    serviceCount(env, "/rest/v1/announcements?select=id&is_active=eq.true"),
  ]);
  const users = (usersPayload.users ?? []).map((user) => ({
    id: user.id,
    email: user.email ?? "",
    displayName: user.user_metadata?.display_name ?? user.user_metadata?.full_name ?? "",
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
  }));
  return json({
    generatedAt: new Date().toISOString(),
    admin: { id: admin.id, email: admin.email ?? "" },
    metrics: {
      users: Number(usersPayload.total ?? users.length),
      activeSubscriptions: subscriptionCount,
      learningProfiles: learningStateCount,
      activeToday: activeTodayCount,
      openSupport: openSupportCount,
      activeAnnouncements: activeAnnouncementCount,
    },
    users,
    subscriptions,
    learningStates,
    contacts,
    announcements,
  });
}

async function updateAdminSupport(request, env, id) {
  await requireAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const allowedStatuses = new Set(["open", "reviewing", "closed"]);
  if (!allowedStatuses.has(body.status)) throw new HttpError(400, "問い合わせ状態が正しくありません。");
  await serviceRest(env, `/rest/v1/support_messages?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: body.status }),
  });
  return json({ ok: true, status: body.status });
}

function normalizeAnnouncementInput(body, { partial = false } = {}) {
  const result = {};
  if (!partial || Object.hasOwn(body, "title")) {
    const title = String(body.title ?? "").trim();
    if (!title || title.length > 120) throw new HttpError(400, "タイトルは120文字以内で入力してください。");
    result.title = title;
  }
  if (!partial || Object.hasOwn(body, "body")) {
    const announcementBody = String(body.body ?? "").trim();
    if (!announcementBody || announcementBody.length > 2000) throw new HttpError(400, "本文は2000文字以内で入力してください。");
    result.body = announcementBody;
  }
  if (!partial || Object.hasOwn(body, "linkUrl")) {
    const linkUrl = String(body.linkUrl ?? "").trim();
    if (linkUrl && !linkUrl.startsWith("/") && !/^https:\/\//i.test(linkUrl)) {
      throw new HttpError(400, "リンクはサイト内パスまたはHTTPS URLを指定してください。");
    }
    result.link_url = linkUrl || null;
  }
  if (Object.hasOwn(body, "isActive")) result.is_active = Boolean(body.isActive);
  return result;
}

async function createAdminAnnouncement(request, env) {
  const admin = await requireAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const values = normalizeAnnouncementInput(body);
  const rows = await serviceRest(env, "/rest/v1/announcements", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...values, is_active: true, created_by: admin.id }),
  });
  return json({ announcement: rows?.[0] ?? null }, 201);
}

async function updateAdminAnnouncement(request, env, id) {
  await requireAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const values = normalizeAnnouncementInput(body, { partial: true });
  if (Object.keys(values).length === 0) throw new HttpError(400, "更新内容がありません。");
  values.updated_at = new Date().toISOString();
  const rows = await serviceRest(env, `/rest/v1/announcements?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(values),
  });
  return json({ announcement: rows?.[0] ?? null });
}

async function serveQuestions(request, env, packId) {
  if (!/^(bookkeeping-2|bookkeeping-3|officer-kyouyou|officer-senmon)$/.test(packId)) {
    return json({ error: "Unknown question pack" }, 404);
  }
  const auth = await optionalMembership(request, env);
  const tier = auth.premium ? "premium" : "free";
  const assetUrl = new URL(`/${tier}/questions/${packId}.json`, request.url);
  const asset = await env.ASSETS.fetch(assetUrl);
  if (!asset.ok) return json({ error: "問題データが見つかりません。" }, 404);
  const headers = new Headers(asset.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Mememo-Tier", tier);
  if (auth.premium) headers.append("Set-Cookie", await createPremiumCookie(auth.user.id, env));
  return new Response(asset.body, { status: asset.status, headers });
}

async function billingStatus(request, env) {
  const token = bearerToken(request);
  if (!token) return json({ premium: false, status: "free", plan: null });
  const user = await authenticateUser(token, env);
  const subscription = await getSubscriptionForUser(user.id, token, env);
  const membership = membershipPayload(subscription, env, hasComplimentaryAccess(user, env));
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  if (membership.premium) headers.append("Set-Cookie", await createPremiumCookie(user.id, env));
  else headers.append("Set-Cookie", clearPremiumCookie());
  return json(membership, 200, headers);
}

async function createCheckout(request, env) {
  const token = requireBearerToken(request);
  const user = await authenticateUser(token, env);
  const body = await request.json().catch(() => ({}));
  const interval = body.interval === "year" ? "year" : body.interval === "month" ? "month" : null;
  if (!interval) return json({ error: "料金プランを選択してください。" }, 400);
  const priceId = interval === "year" ? env.STRIPE_YEARLY_PRICE_ID : env.STRIPE_MONTHLY_PRICE_ID;
  if (!priceId) return json({ error: "料金プランは現在準備中です。" }, 503);
  const existing = await getSubscriptionForUser(user.id, token, env);
  if (existing && ACTIVE_SUBSCRIPTION_STATUSES.has(existing.status)) {
    return json({ error: "すでに有料プランをご利用中です。" }, 409);
  }

  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${env.PUBLIC_SITE_URL}/?checkout=success`,
    cancel_url: `${env.PUBLIC_SITE_URL}/?checkout=cancelled`,
    client_reference_id: user.id,
    "metadata[supabase_user_id]": user.id,
    "subscription_data[metadata][supabase_user_id]": user.id,
    allow_promotion_codes: "true",
  });
  if (existing?.stripe_customer_id) params.set("customer", existing.stripe_customer_id);
  else if (user.email) params.set("customer_email", user.email);

  const session = await stripeRequest("/v1/checkout/sessions", env, { body: params });
  return json({ url: session.url });
}

async function createPortal(request, env) {
  const token = requireBearerToken(request);
  const user = await authenticateUser(token, env);
  const subscription = await getSubscriptionForUser(user.id, token, env);
  if (!subscription?.stripe_customer_id) return json({ error: "管理できる契約がありません。" }, 404);
  const params = new URLSearchParams({
    customer: subscription.stripe_customer_id,
    return_url: `${env.PUBLIC_SITE_URL}/`,
  });
  const session = await stripeRequest("/v1/billing_portal/sessions", env, { body: params });
  return json({ url: session.url });
}

async function handleStripeWebhook(request, env) {
  const payload = await request.text();
  await verifyStripeSignature(payload, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
  const event = JSON.parse(payload);
  const object = event.data?.object;

  if (event.type === "checkout.session.completed") {
    const userId = object.metadata?.supabase_user_id || object.client_reference_id;
    if (userId && object.customer) {
      await upsertSubscription(env, {
        user_id: userId,
        stripe_customer_id: String(object.customer),
        stripe_subscription_id: object.subscription ? String(object.subscription) : null,
        status: object.payment_status === "paid" ? "active" : "incomplete",
      });
    }
  } else if (event.type.startsWith("customer.subscription.")) {
    await syncSubscriptionObject(object, env);
  }
  return json({ received: true });
}

async function syncSubscriptionObject(subscription, env) {
  let userId = subscription.metadata?.supabase_user_id;
  if (!userId && subscription.customer) {
    const rows = await serviceRest(env, `/rest/v1/subscriptions?select=user_id&stripe_customer_id=eq.${encodeURIComponent(String(subscription.customer))}&limit=1`);
    userId = rows[0]?.user_id;
  }
  if (!userId) throw new Error("Stripe subscription is missing supabase_user_id metadata");
  const item = subscription.items?.data?.[0];
  await upsertSubscription(env, {
    user_id: userId,
    stripe_customer_id: String(subscription.customer),
    stripe_subscription_id: String(subscription.id),
    stripe_price_id: item?.price?.id ?? null,
    status: subscription.status,
    current_period_end: unixTimestampToIso(item?.current_period_end ?? subscription.current_period_end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  });
}

async function upsertSubscription(env, values) {
  const payload = { ...values, updated_at: new Date().toISOString() };
  await serviceRest(env, "/rest/v1/subscriptions?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(payload),
  });
}

async function optionalMembership(request, env) {
  const token = bearerToken(request);
  if (!token) return { premium: false, user: null, subscription: null };
  try {
    const user = await authenticateUser(token, env);
    const subscription = await getSubscriptionForUser(user.id, token, env);
    return {
      premium: hasComplimentaryAccess(user, env) || ACTIVE_SUBSCRIPTION_STATUSES.has(subscription?.status),
      user,
      subscription,
    };
  } catch {
    return { premium: false, user: null, subscription: null };
  }
}

async function authenticateUser(token, env) {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new HttpError(401, "ログインの有効期限が切れました。再度ログインしてください。");
  return response.json();
}

async function getSubscriptionForUser(userId, token, env) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/subscriptions?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Supabase subscription lookup failed: ${response.status}`);
  const rows = await response.json();
  return rows[0] ?? null;
}

async function serviceRest(env, path, options = {}) {
  const headers = supabaseServiceHeaders(env, options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${env.SUPABASE_URL}${path}`, { ...options, headers });
  if (!response.ok) throw new Error(`Supabase service request failed: ${response.status} ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

async function serviceAuthUsers(env, perPage = 40) {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=${perPage}`, {
    headers: supabaseServiceHeaders(env),
  });
  if (!response.ok) throw new Error(`Supabase admin user lookup failed: ${response.status}`);
  return response.json();
}

async function serviceCount(env, path) {
  const headers = supabaseServiceHeaders(env, {
    Prefer: "count=exact",
    Range: "0-0",
  });
  const response = await fetch(`${env.SUPABASE_URL}${path}`, { method: "GET", headers });
  if (!response.ok) throw new Error(`Supabase count failed: ${response.status}`);
  const contentRange = response.headers.get("Content-Range") ?? "";
  const count = Number(contentRange.split("/")[1]);
  return Number.isFinite(count) ? count : 0;
}

function supabaseServiceHeaders(env, initialHeaders = undefined) {
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  const headers = new Headers(initialHeaders);
  headers.set("apikey", serviceKey);
  // Supabase's newer sb_secret_* keys must not be sent as bearer JWTs.
  // Legacy service_role JWTs still require the Authorization header.
  if (!serviceKey.startsWith("sb_secret_")) {
    headers.set("Authorization", `Bearer ${serviceKey}`);
  }
  return headers;
}

async function stripeRequest(path, env, { body }) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body,
  });
  const payload = await response.json();
  if (!response.ok) throw new HttpError(502, payload.error?.message || "決済サービスとの通信に失敗しました。");
  return payload;
}

async function handlePremiumAsset(request, env) {
  const cookie = parseCookies(request.headers.get("Cookie"))[PREMIUM_COOKIE];
  const session = cookie ? await verifyPremiumCookie(cookie, env) : null;
  if (!session) return json({ error: "このコンテンツは有料プラン限定です。" }, 403);
  const asset = await env.ASSETS.fetch(request);
  if (!asset.ok) return asset;
  const headers = new Headers(asset.headers);
  headers.set("Cache-Control", "private, max-age=300");
  return withSecurityHeaders(new Response(asset.body, { status: asset.status, headers }));
}

function membershipPayload(subscription, env, complimentaryAccess = false) {
  const premium = complimentaryAccess || ACTIVE_SUBSCRIPTION_STATUSES.has(subscription?.status);
  const priceId = subscription?.stripe_price_id;
  const plan = priceId && priceId === env.STRIPE_YEARLY_PRICE_ID ? "year" : priceId && priceId === env.STRIPE_MONTHLY_PRICE_ID ? "month" : null;
  return {
    premium,
    status: complimentaryAccess && !ACTIVE_SUBSCRIPTION_STATUSES.has(subscription?.status) ? "complimentary" : subscription?.status ?? "free",
    plan: complimentaryAccess && !plan ? "full-access" : plan,
    complimentaryAccess,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
  };
}

async function createPremiumCookie(userId, env) {
  const value = base64UrlEncode(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + PREMIUM_COOKIE_TTL_SECONDS }));
  const signature = await hmacBase64Url(value, env.COOKIE_SIGNING_SECRET);
  return `${PREMIUM_COOKIE}=${value}.${signature}; Path=/premium/; Max-Age=${PREMIUM_COOKIE_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function clearPremiumCookie() {
  return `${PREMIUM_COOKIE}=; Path=/premium/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

async function verifyPremiumCookie(cookie, env) {
  const [value, signature] = cookie.split(".");
  if (!value || !signature) return null;
  const expected = await hmacBase64Url(value, env.COOKIE_SIGNING_SECRET);
  if (!timingSafeEqual(signature, expected)) return null;
  const payload = JSON.parse(base64UrlDecode(value));
  return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
}

async function verifyStripeSignature(payload, header, secret) {
  if (!header || !secret) throw new HttpError(400, "Webhook signature is missing");
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=")));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) throw new HttpError(400, "Webhook timestamp is invalid");
  const expected = await hmacHex(`${timestamp}.${payload}`, secret);
  if (!timingSafeEqual(parts.v1 ?? "", expected)) throw new HttpError(400, "Webhook signature is invalid");
}

async function hmacBytes(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function hmacHex(value, secret) {
  return [...await hmacBytes(value, secret)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacBase64Url(value, secret) {
  return base64UrlEncode(await hmacBytes(value, secret));
}

function base64UrlEncode(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return new TextDecoder().decode(Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)));
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function requireBearerToken(request) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, "ログインが必要です。");
  return token;
}

function assertSameOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || (origin !== env.PUBLIC_SITE_URL && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    throw new HttpError(403, "Invalid request origin");
  }
}

function parseCookies(header) {
  return Object.fromEntries((header ?? "").split(";").map((item) => item.trim().split(/=(.*)/s)).filter(([key]) => key));
}

function unixTimestampToIso(value) {
  return Number.isFinite(Number(value)) ? new Date(Number(value) * 1000).toISOString() : null;
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy", "default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cloudflareinsights.com; img-src 'self' data: blob: https://*.googleusercontent.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' https://static.cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(payload, status = 200, extraHeaders = undefined) {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return withSecurityHeaders(new Response(JSON.stringify(payload), { status, headers }));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
