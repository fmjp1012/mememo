import { expect, test } from "@playwright/test";

const isRemote = Boolean(process.env.E2E_BASE_URL);

function watchRuntimeErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => errors.push(`Request failed: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function mockAuthProviders(page, external = { email: true, google: false, apple: false }) {
  if (isRemote) return;
  await page.route("**/rest/v1/announcements?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "[]",
  }));
  await page.route("**/auth/v1/settings", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ external, disable_signup: false }),
  }));
}

async function enabledProductionProviders(page) {
  if (!isRemote) return [];
  return page.evaluate(async () => {
    const config = window.__MEMEMO_CONFIG__;
    const response = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: config.supabaseAnonKey },
    });
    const settings = await response.json();
    return ["google", "apple"].filter((provider) => settings?.external?.[provider] === true);
  });
}

test("トップページと主要導線が表示され、実行時エラーがない", async ({ page }) => {
  const runtimeErrors = watchRuntimeErrors(page);
  await mockAuthProviders(page);

  await page.goto("/");
  await expect(page).toHaveTitle(/Mememo/);
  await expect(page.getByRole("heading", { name: "今日やること" })).toBeVisible();
  await expect(page.getByRole("button", { name: "今日の学習を始める" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "1日の新規カード上限" })).toBeVisible();

  await page.getByRole("button", { name: "教材", exact: true }).click();
  await expect(page.getByRole("heading", { name: /教材/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "問題", exact: true }).click();
  await expect(page.getByRole("main")).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("無効なOAuthプロバイダーを表示せず、メールログインを維持する", async ({ page }) => {
  const runtimeErrors = watchRuntimeErrors(page);
  await mockAuthProviders(page);

  await page.goto("/");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("メールアドレス")).toBeVisible();
  await expect(page.getByLabel("パスワード", { exact: true })).toBeVisible();

  const enabledProviders = await enabledProductionProviders(page);
  for (const provider of ["google", "apple"]) {
    const label = provider === "google" ? "Google" : "Apple";
    if (enabledProviders.includes(provider)) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: label })).toHaveCount(0);
    }
  }
  expect(runtimeErrors).toEqual([]);
});

test("有効なGoogle OAuthだけを表示し、認証エンドポイントへ遷移する", async ({ page }) => {
  test.skip(isRemote, "本番の外部OAuth画面へはE2Eから遷移しない");
  const runtimeErrors = watchRuntimeErrors(page);
  await mockAuthProviders(page, { email: true, google: true, apple: false });
  await page.route("https://test.supabase.co/auth/v1/authorize?**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>OAuth handoff</title><h1>OAuth handoff</h1>",
  }));

  await page.goto("/");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("button", { name: "Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apple" })).toHaveCount(0);
  await page.getByRole("button", { name: "Google" }).click();
  await expect(page).toHaveURL(/test\.supabase\.co\/auth\/v1\/authorize\?.*provider=google/);
  await expect(page.getByRole("heading", { name: "OAuth handoff" })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("未ログインの管理画面を保護する", async ({ page }) => {
  const runtimeErrors = watchRuntimeErrors(page);
  await mockAuthProviders(page);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "管理者ログインが必要です" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "ログイン", exact: true })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("公開問題APIと未認証管理APIの契約を守る", async ({ request }) => {
  const questionsResponse = await request.get("/api/questions/bookkeeping-2");
  expect(questionsResponse.ok()).toBeTruthy();
  const questions = await questionsResponse.json();
  expect(Array.isArray(questions)).toBeTruthy();
  expect(questions.length).toBeGreaterThan(0);
  expect(questions.length).toBeLessThanOrEqual(12);

  const adminResponse = await request.get("/api/admin/session");
  expect(adminResponse.status()).toBe(401);
  await expect(adminResponse.json()).resolves.toMatchObject({ error: expect.any(String) });
});
