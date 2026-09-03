import { supabase } from "./authClient.js";

const LEARNING_STATE_TABLE = "user_learning_state";

function mergeById(localItems = [], cloudItems = [], limit = 500) {
  const items = new Map();
  for (const item of [...cloudItems, ...localItems]) {
    if (!item?.id) continue;
    const current = items.get(item.id);
    const itemTime = Date.parse(item.answeredAt ?? item.date ?? item.updatedAt ?? 0) || 0;
    const currentTime = Date.parse(current?.answeredAt ?? current?.date ?? current?.updatedAt ?? 0) || 0;
    if (!current || itemTime >= currentTime) items.set(item.id, item);
  }
  return [...items.values()]
    .sort((a, b) => (Date.parse(b.answeredAt ?? b.date ?? 0) || 0) - (Date.parse(a.answeredAt ?? a.date ?? 0) || 0))
    .slice(0, limit);
}

function chooseLatestRecord(localRecord, cloudRecord) {
  if (!localRecord) return cloudRecord;
  if (!cloudRecord) return localRecord;
  const recordTime = (record) => Date.parse(
    record.lastAt ?? record.reviewLastAt ?? record.lastAnsweredAt ?? record.lastCheckedAt ?? record.completedAt ?? record.lastOpenedAt ?? 0,
  ) || 0;
  const localTime = recordTime(localRecord);
  const cloudTime = recordTime(cloudRecord);
  return localTime >= cloudTime ? localRecord : cloudRecord;
}

function mergeRecordMap(localMap = {}, cloudMap = {}) {
  const merged = {};
  for (const key of new Set([...Object.keys(cloudMap), ...Object.keys(localMap)])) {
    merged[key] = chooseLatestRecord(localMap[key], cloudMap[key]);
  }
  return merged;
}

export function mergeLearningState(localProgress, cloudProgress) {
  if (!cloudProgress || typeof cloudProgress !== "object") return localProgress;
  const localDailyDate = localProgress.dailyStudy?.date ?? "";
  const cloudDailyDate = cloudProgress.dailyStudy?.date ?? "";
  const dailyStudy = localDailyDate >= cloudDailyDate ? localProgress.dailyStudy : cloudProgress.dailyStudy;
  return {
    ...cloudProgress,
    ...localProgress,
    attempts: mergeRecordMap(localProgress.attempts, cloudProgress.attempts),
    lessonProgress: mergeRecordMap(localProgress.lessonProgress, cloudProgress.lessonProgress),
    bookmarks: [...new Set([...(cloudProgress.bookmarks ?? []), ...(localProgress.bookmarks ?? [])])],
    history: mergeById(localProgress.history, cloudProgress.history, 500),
    sessions: mergeById(localProgress.sessions, cloudProgress.sessions, 30),
    dailyStudy,
    enabledPacks: [...new Set([...(cloudProgress.enabledPacks ?? []), ...(localProgress.enabledPacks ?? [])])],
  };
}

export async function loadUserLearningState(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from(LEARNING_STATE_TABLE)
    .select("progress, settings, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function saveUserLearningState(userId, progress, settings) {
  if (!supabase || !userId) return;
  const { error } = await supabase.from(LEARNING_STATE_TABLE).upsert({
    user_id: userId,
    progress,
    settings,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
}

export function getUserDisplayName(user) {
  const metadata = user?.user_metadata ?? {};
  return String(metadata.display_name ?? metadata.full_name ?? metadata.name ?? "").trim();
}

export function getUserAvatarUrl(user) {
  const metadata = user?.user_metadata ?? {};
  return String(metadata.avatar_url ?? metadata.picture ?? "").trim();
}

export function getLinkedProviders(user) {
  const providers = user?.app_metadata?.providers;
  return Array.isArray(providers) ? providers : [];
}
