import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const latestOfficerExamIds = new Set([
  "r7-1-kyouyou",
  "r7-2-kyouyou",
  "r7-1-senmon",
  "r7-2-senmon",
]);
const freeQuestionsPerPack = 12;
const questionSources = [
  { packId: "bookkeeping-2", source: "public/bookkeeping/level2/questions.json" },
  { packId: "bookkeeping-3", source: "public/bookkeeping/level3/questions.json" },
  { packId: "officer-kyouyou", source: "public/officer/kyouyou/questions.json", officer: true },
  { packId: "officer-senmon", source: "public/officer/senmon/questions.json", officer: true },
];

function hasUnavailableCopyrightText(question) {
  const text = [
    question.transcription?.rawText,
    question.transcription?.text,
    question.transcription?.markdown,
  ].filter(Boolean).join("\n");
  return /著作権の関係[^。\n]*(掲載できません|掲載できない)/.test(text);
}

function isProductionOfficerQuestion(question) {
  return latestOfficerExamIds.has(question.examId) &&
    Number.isInteger(question.answer) &&
    !hasUnavailableCopyrightText(question);
}

function rewriteProtectedImages(question, prefix) {
  const rewrite = (image) => typeof image === "string" && image.startsWith("/officer/")
    ? `/${prefix}${image}`
    : image;
  return {
    ...question,
    image: rewrite(question.image),
    images: Array.isArray(question.images) ? question.images.map(rewrite) : question.images,
    imageResource: question.imageResource
      ? { ...question.imageResource, path: rewrite(question.imageResource.path) }
      : question.imageResource,
  };
}

function premiumApiDev() {
  return {
    name: "mememo-premium-api-dev",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url, "http://localhost");
        const devAdminEnabled = process.env.MEMEMO_DEV_ADMIN === "1" || process.env.VITE_MEMEMO_DEV_ADMIN === "1";
        if (!devAdminEnabled && ["/api/admin/session", "/api/admin/dashboard"].includes(url.pathname)) {
          response.statusCode = 401;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: "Authentication required" }));
          return;
        }
        if (devAdminEnabled && url.pathname === "/api/admin/session") {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ admin: true }));
          return;
        }
        if (devAdminEnabled && url.pathname === "/api/admin/dashboard") {
          const now = new Date();
          const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
          const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({
            generatedAt: now.toISOString(),
            admin: { id: "dev-admin", email: "admin@example.com" },
            metrics: { users: 128, activeSubscriptions: 24, learningProfiles: 91, activeToday: 37, openSupport: 3, activeAnnouncements: 1 },
            users: [
              { id: "user-1", email: "learner@example.com", displayName: "学習ユーザー", createdAt: yesterday, lastSignInAt: hourAgo, emailConfirmed: true },
              { id: "user-2", email: "new@example.com", displayName: "", createdAt: hourAgo, lastSignInAt: null, emailConfirmed: false },
            ],
            subscriptions: [
              { user_id: "user-1", status: "active", stripe_price_id: "price_month", current_period_end: now.toISOString(), cancel_at_period_end: false, updated_at: hourAgo },
            ],
            learningStates: [
              { user_id: "user-1", created_at: yesterday, updated_at: hourAgo },
              { user_id: "user-2", created_at: hourAgo, updated_at: hourAgo },
            ],
            contacts: [
              { id: "contact-1", created_at: hourAgo, type: "contact", subject: "教材について", message: "教材の進め方を確認したいです。", contact_email: "learner@example.com", user_id: "user-1", question_id: null, status: "open" },
              { id: "contact-2", created_at: yesterday, type: "question_report", subject: "問題報告", message: "選択肢を確認してください。", contact_email: "new@example.com", user_id: "user-2", question_id: "sample-12", status: "reviewing" },
            ],
            announcements: [
              { id: "announcement-1", title: "新しい教材を追加しました", body: "簿記2級の教材を公開しました。", link_url: null, is_active: true, published_at: yesterday, created_at: yesterday, updated_at: yesterday },
            ],
          }));
          return;
        }
        if (devAdminEnabled && url.pathname.startsWith("/api/admin/") && ["PATCH", "POST"].includes(request.method ?? "")) {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ ok: true }));
          return;
        }
        const match = url.pathname.match(/^\/api\/questions\/([^/]+)$/);
        if (match) {
          const source = questionSources.find((item) => item.packId === match[1]);
          if (!source) {
            response.statusCode = 404;
            response.end(JSON.stringify({ error: "Unknown question pack" }));
            return;
          }
          const all = JSON.parse(await readFile(resolve(process.cwd(), source.source), "utf8"));
          const usable = source.officer ? all.filter(isProductionOfficerQuestion) : all;
          const premium = process.env.MEMEMO_DEV_PREMIUM === "1" || process.env.VITE_MEMEMO_DEV_FULL_ACCESS === "1";
          const selected = premium ? usable : usable.slice(0, freeQuestionsPerPack);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify(selected.map((question) => rewriteProtectedImages(question, premium ? "premium" : "free"))));
          return;
        }
        if (url.pathname === "/api/billing/status") {
          const premium = process.env.MEMEMO_DEV_PREMIUM === "1";
          const complimentaryAccess = process.env.VITE_MEMEMO_DEV_FULL_ACCESS === "1";
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ premium: premium || complimentaryAccess, status: complimentaryAccess ? "complimentary" : premium ? "active" : "free", plan: complimentaryAccess ? "full-access" : premium ? "development" : null, complimentaryAccess }));
          return;
        }
        if (url.pathname.startsWith("/premium/officer/") || url.pathname.startsWith("/free/officer/")) {
          request.url = url.pathname.replace(/^\/(premium|free)/, "") + url.search;
        }
        next();
      });
    },
  };
}

function copyProductionPublicAssets() {
  return {
    name: "copy-production-public-assets",
    apply: "build",
    async writeBundle() {
      const root = process.cwd();
      const outputDir = resolve(root, "dist");
      for (const source of questionSources) {
        const questions = JSON.parse(await readFile(resolve(root, source.source), "utf8"));
        const productionQuestions = source.officer ? questions.filter(isProductionOfficerQuestion) : questions;
        const freeQuestions = productionQuestions.slice(0, freeQuestionsPerPack);
        for (const [tier, selected] of [["premium", productionQuestions], ["free", freeQuestions]]) {
          const rewritten = selected.map((question) => rewriteProtectedImages(question, tier));
          const outputPath = resolve(outputDir, tier, "questions", `${source.packId}.json`);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, `${JSON.stringify(rewritten, null, 2)}\n`);
          if (!source.officer) continue;
          const referencedImages = new Set(selected.flatMap((question) => [question.image, ...(question.images ?? [])]).filter(Boolean));
          for (const image of referencedImages) {
            if (!image.startsWith("/officer/")) continue;
            const relativePath = image.replace(/^\//, "");
            const sourcePath = resolve(root, "public", relativePath);
            const outputImagePath = resolve(outputDir, tier, relativePath);
            await mkdir(dirname(outputImagePath), { recursive: true });
            await copyFile(sourcePath, outputImagePath);
          }
        }
      }

      for (const relativePath of [
        "privacy.html",
        "terms.html",
        "commercial-transactions.html",
        "runtime-config.js",
        "robots.txt",
        "_headers",
      ]) {
        const sourcePath = resolve(root, "public", relativePath);
        const outputPath = resolve(outputDir, relativePath);
        await mkdir(dirname(outputPath), { recursive: true });
        await copyFile(sourcePath, outputPath);
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  publicDir: command === "build" ? false : "public",
  plugins: [react(), premiumApiDev(), copyProductionPublicAssets()],
  server: {
    watch: {
      ignored: ["**/data/**", "**/ios/**", "**/public/**/pages/**", "**/public/**/crops/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@supabase")) return "supabase";
          if (id.includes("node_modules/katex")) return "katex";
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("node_modules/react")) return "react-vendor";
          return undefined;
        },
      },
    },
  },
}));
