import { useEffect, useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  ArrowLeft,
  AlertCircle,
  BarChart3,
  BookOpen,
  Brain,
  Calculator,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cloud,
  CloudOff,
  CreditCard,
  Crown,
  Database,
  FileText,
  Flag,
  GraduationCap,
  History,
  Keyboard,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Megaphone,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Shield,
  Shuffle,
  Sparkles,
  Target,
  TimerReset,
  Trophy,
  User,
  Users,
  X,
} from "lucide-react";
import {
  checkAdminAccess,
  createAnnouncement,
  loadAdminDashboard,
  loadPublicAnnouncements,
  updateAnnouncement,
  updateSupportStatus,
} from "./adminClient.js";
import { authConfigReady, getAuthRedirectUrl, getEnabledOAuthProviders, supabase } from "./authClient.js";
import { createBillingPortal, createCheckout, getMembership } from "./billingClient.js";
import {
  bookkeepingPackIds,
  defaultEnabledPacks,
  getPack,
  loadQuestionBank,
  officerCandidatePackIds,
  questionBank,
  visibleLearningPacks,
} from "./learningContent.js";
import { submitSupportMessage } from "./supportClient.js";
import { getCourseLessons, getMaterialLesson, materialCourses, materialLessons } from "./materials.js";
import {
  getLinkedProviders,
  getUserAvatarUrl,
  getUserDisplayName,
  loadUserLearningState,
  mergeLearningState,
  saveUserLearningState,
} from "./userDataClient.js";

const STORAGE_KEY = "mememo-progress-v1";
const SETTINGS_STORAGE_KEY = "mememo-settings-v1";
const DEFAULT_PACK_ID = "bookkeeping-2";
const DEFAULT_EXAM_ID = "all";
const PACK_CATALOG_VERSION = 3;
const ENTRY_TRACKS = {
  bookkeeping: {
    path: "/",
    packIds: bookkeepingPackIds,
    defaultPackId: "bookkeeping-2",
  },
  officer: {
    path: "/officer",
    packIds: officerCandidatePackIds,
    defaultPackId: "officer-candidate",
  },
};
const POLISHED_ITPASS_EXAM_IDS = new Set(["2026r08", "2025r07", "2024r06"]);
const choiceShortcutKeys = ["1", "2", "3", "4", "5", "6", "7", "8"];
const nextShortcutKey = "n";
const previousShortcutKey = "p";
const reviewIntervalsInDays = [0, 1, 3, 7, 14, 30, 60, 120];
const DEFAULT_DAILY_NEW_QUESTION_LIMIT = 12;
const UNLIMITED_DAILY_NEW_QUESTIONS = "unlimited";
const dailyNewQuestionLimitOptions = [5, 10, 12, 20, 30, 50, 100, UNLIMITED_DAILY_NEW_QUESTIONS];
const reviewRatingOptions = [
  { id: "again", label: "もう一度", intervalLabel: "1分" },
  { id: "hard", label: "難しい", intervalLabel: "1日" },
  { id: "good", label: "できた", intervalLabel: "3日" },
  { id: "easy", label: "簡単", intervalLabel: "7日" },
];

const mockProfiles = {
  "bookkeeping-2": { label: "日商簿記2級 基礎確認", minutes: 90, questions: 30 },
  "bookkeeping-3": { label: "日商簿記3級 基礎確認", minutes: 60, questions: 30 },
  "officer-candidate": { label: "幹部候補生 一般教養・専門択一", minutes: 200, questions: null },
  "officer-kyouyou": { label: "一般教養 本試験", minutes: 180, questions: null },
  "officer-senmon": { label: "専門択一 本試験", minutes: 110, questions: null },
};

const modeOptions = [
  {
    id: "random",
    title: "通常演習",
    description: "条件内の問題を出題",
    icon: Brain,
  },
  {
    id: "mock",
    title: "模試演習",
    description: "時間制限と一括採点",
    icon: TimerReset,
  },
  {
    id: "weak",
    title: "復習",
    description: "ミスと低定着",
    icon: Target,
  },
];

const orderOptions = [
  {
    id: "ordered",
    title: "問題番号順",
    description: "データセットの並びで進める",
    icon: ListChecks,
  },
  {
    id: "random",
    title: "ランダム",
    description: "条件内から順不同で出題",
    icon: Shuffle,
  },
];

const emptyProgress = {
  packCatalogVersion: PACK_CATALOG_VERSION,
  attempts: {},
  bookmarks: [],
  history: [],
  sessions: [],
  dailyStudy: { date: "", completedQuestionIds: [], newQuestionIds: [] },
  lessonProgress: {},
  enabledPacks: defaultEnabledPacks,
};

function getEntryTrackFromLocation() {
  return window.location.pathname.startsWith("/officer") ? "officer" : "bookkeeping";
}

function getEntryTrackPackIds(track) {
  return ENTRY_TRACKS[track]?.packIds ?? ENTRY_TRACKS.bookkeeping.packIds;
}

function getFreshProgress() {
  return {
    ...emptyProgress,
    enabledPacks: [...getEntryTrackPackIds(getEntryTrackFromLocation())],
  };
}

function normalizeEnabledPacks(enabledPacks) {
  const validPackIds = new Set([...bookkeepingPackIds, ...officerCandidatePackIds]);
  const normalized = [];
  for (const packId of enabledPacks) {
    if (packId === "officer-candidate") {
      normalized.push("officer-kyouyou", "officer-senmon");
    } else if (validPackIds.has(packId)) {
      normalized.push(packId);
    }
  }
  return [...new Set(normalized)].filter((packId) => validPackIds.has(packId));
}

function getPackMemberIds(packId) {
  if (packId === "officer-candidate") return officerCandidatePackIds;
  return [packId];
}

function isVisiblePackEnabled(pack, enabledPackSet) {
  const memberIds = pack.memberPackIds ?? [pack.id];
  return memberIds.every((packId) => enabledPackSet.has(packId));
}

function questionMatchesPackSelection(question, packId) {
  if (packId === "all") return true;
  if (packId === "officer-candidate") return isOfficerQuestion(question);
  return question.packId === packId;
}

function getQuestionPackFilterId(question) {
  return isOfficerQuestion(question) ? "officer-candidate" : question.packId;
}

function loadProgress() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return getFreshProgress();
    const parsed = JSON.parse(stored);
    const enabledPacks = normalizeEnabledPacks(Array.isArray(parsed.enabledPacks) ? parsed.enabledPacks : []);
    const previousVersion = parsed.packCatalogVersion ?? 1;
    const officerActivity = (parsed.history ?? []).some((item) => officerCandidatePackIds.includes(item.packId)) ||
      Object.keys(parsed.attempts ?? {}).some((id) => /officer|kyouyou|senmon|r\d-\d-(?:kyouyou|senmon)/i.test(id));
    const wasMixedDefault = [...bookkeepingPackIds, ...officerCandidatePackIds]
      .every((packId) => enabledPacks.includes(packId));
    let migratedEnabledPacks = previousVersion < 2
      ? normalizeEnabledPacks([...enabledPacks, ...bookkeepingPackIds])
      : enabledPacks;
    if (previousVersion < 3 && wasMixedDefault && !officerActivity) {
      migratedEnabledPacks = [...bookkeepingPackIds];
    }
    return {
      ...emptyProgress,
      ...parsed,
      packCatalogVersion: PACK_CATALOG_VERSION,
      enabledPacks: migratedEnabledPacks.length > 0 ? migratedEnabledPacks : getFreshProgress().enabledPacks,
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      attempts: parsed.attempts && typeof parsed.attempts === "object" ? parsed.attempts : {},
      lessonProgress: parsed.lessonProgress && typeof parsed.lessonProgress === "object" ? parsed.lessonProgress : {},
    };
  } catch {
    return getFreshProgress();
  }
}

function saveProgress(progress) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function getDefaultSettings(progress) {
  const entryTrack = getEntryTrackFromLocation();
  return {
    enabledPacks: progress.enabledPacks,
    packId: ENTRY_TRACKS[entryTrack].defaultPackId,
    examId: DEFAULT_EXAM_ID,
    subject: "すべて",
    category: "すべて",
    mode: "random",
    order: "ordered",
    dailyNewQuestionLimit: DEFAULT_DAILY_NEW_QUESTION_LIMIT,
  };
}

function normalizeDailyNewQuestionLimit(value) {
  if (value === UNLIMITED_DAILY_NEW_QUESTIONS) return value;
  const parsed = Number(value);
  return dailyNewQuestionLimitOptions.includes(parsed) ? parsed : DEFAULT_DAILY_NEW_QUESTION_LIMIT;
}

function loadSettings(progress) {
  const defaults = getDefaultSettings(progress);
  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) return defaults;
    const parsed = JSON.parse(stored);
    const storedSettings = { ...parsed };
    delete storedSettings.mockQuestionCount;
    delete storedSettings.mockDurationMinutes;
    const packId = officerCandidatePackIds.includes(parsed.packId) ? "officer-candidate" : parsed.packId;
    const validPackIds = new Set(["all", ...visibleLearningPacks.map((pack) => pack.id)]);
    return {
      ...defaults,
      ...storedSettings,
      enabledPacks: progress.enabledPacks,
      packId: validPackIds.has(packId) ? packId : defaults.packId,
      mode: parsed.mode === "weak" ? "weak" : "random",
      order: parsed.order === "ordered" ? "ordered" : "random",
      dailyNewQuestionLimit: normalizeDailyNewQuestionLimit(parsed.dailyNewQuestionLimit),
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings) {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function sanitizeSyncedSettings(remoteSettings, progress, fallbackSettings) {
  if (!remoteSettings || typeof remoteSettings !== "object") return fallbackSettings;
  const validPackIds = new Set(["all", ...visibleLearningPacks.map((pack) => pack.id)]);
  const remotePackId = officerCandidatePackIds.includes(remoteSettings.packId)
    ? "officer-candidate"
    : remoteSettings.packId;
  return {
    ...fallbackSettings,
    ...remoteSettings,
    enabledPacks: progress.enabledPacks,
    packId: validPackIds.has(remotePackId) ? remotePackId : fallbackSettings.packId,
    mode: remoteSettings.mode === "weak" ? "weak" : "random",
    order: remoteSettings.order === "random" ? "random" : "ordered",
    dailyNewQuestionLimit: normalizeDailyNewQuestionLimit(remoteSettings.dailyNewQuestionLimit),
  };
}

function shuffle(items) {
  return [...items]
    .map((item) => ({ item, rank: Math.random() }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

function orderQuestions(items) {
  const positions = new Map(questionBank.map((question, index) => [question.id, index]));
  return [...items].sort((a, b) => (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0));
}

function filterQuestions(settings, searchTerm = "") {
  const enabled = new Set(settings.enabledPacks);
  const normalizedSearch = searchTerm.trim().toLowerCase();
  return questionBank.filter((question) => {
    const packEnabled = enabled.has(question.packId);
    const packMatch = questionMatchesPackSelection(question, settings.packId);
    const examMatch = settings.examId === "all" || question.examId === settings.examId;
    const subjectMatch = settings.subject === "すべて" || getFilterSubject(question) === settings.subject;
    const categoryMatch = settings.category === "すべて" || getFilterCategory(question) === settings.category;
    const searchMatch = !normalizedSearch || question.searchText.includes(normalizedSearch);
    return packEnabled && packMatch && examMatch && subjectMatch && categoryMatch && searchMatch;
  });
}

function isOfficerQuestion(question) {
  return question.packId?.startsWith("officer-");
}

function isQuestionUnavailable(question) {
  return Boolean(question?.isCopyrightUnavailable || question?.unavailableReason);
}

function isAnswerableMockQuestion(question) {
  return !isQuestionUnavailable(question) && Array.isArray(question?.choices) && question.choices.length > 0;
}

function getFilterSubject(question) {
  return question.subject;
}

function getFilterCategory(question) {
  return question.category;
}

function getQuizHeader(question) {
  if (isOfficerQuestion(question)) {
    const title = Number.isInteger(question.questionNumber) ? `問${question.questionNumber}` : question.prompt;
    const meta = [
      question.examTitle,
      question.subject,
      question.category,
    ];
    return {
      title: title || question.prompt,
      meta: uniqueCompactLabels(meta),
    };
  }

  const title = Number.isInteger(question.questionNumber) ? `問${question.questionNumber}` : question.prompt;
  const meta = [
    question.packLabel,
    question.examTitle,
    question.subject,
    question.category,
    formatDifficultyLabel(question.difficulty),
  ];
  return {
    title,
    meta: uniqueCompactLabels(meta),
  };
}

function formatDifficultyLabel(value) {
  if (!value) return "";
  if (value.includes("AI推定解答")) return "";
  if (value === "公式公開問題") return "";
  return value;
}

function uniqueCompactLabels(values) {
  const labels = [];
  for (const value of values) {
    const label = String(value || "").trim();
    if (!label || labels.includes(label)) continue;
    labels.push(label);
  }
  return labels;
}

function buildQuiz(settings, progress) {
  const filtered = filterQuestions(settings);
  let source = filtered;

  if (settings.mode === "weak") {
    source = filtered.filter((question) => {
      const attempt = progress.attempts[question.id];
      return isReviewAttemptDue(attempt);
    });
  }

  if (source.length === 0) return [];

  if (settings.order === "ordered") {
    return orderQuestions(source);
  }

  if (settings.mode === "weak") {
    return [...source]
      .sort((a, b) => {
        const left = progress.attempts[a.id] ?? { wrong: 0, correct: 0, total: 0 };
        const right = progress.attempts[b.id] ?? { wrong: 0, correct: 0, total: 0 };
        return getReviewSortValue(right) - getReviewSortValue(left) ||
          right.wrong - left.wrong ||
          left.correct / Math.max(1, left.total) - right.correct / Math.max(1, right.total);
      });
  }

  if (settings.mode === "mock") {
    return shuffle(source);
  }

  const weighted = [...source].sort((a, b) => {
    const left = dueWeight(a, progress);
    const right = dueWeight(b, progress);
    return right - left;
  });
  return weighted;
}

function getFirstMatchingExamId(settings) {
  const match = questionBank.find((question) => {
    const packEnabled = settings.enabledPacks.includes(question.packId);
    const packMatch = questionMatchesPackSelection(question, settings.packId);
    const subjectMatch = settings.subject === "すべて" || getFilterSubject(question) === settings.subject;
    const categoryMatch = settings.category === "すべて" || getFilterCategory(question) === settings.category;
    return packEnabled && packMatch && subjectMatch && categoryMatch && question.examId;
  });
  return match?.examId ?? settings.examId;
}

function normalizePracticeSettings(settings) {
  if (settings.mode !== "random" || !isOfficerPackSelection(settings.packId) || settings.examId !== "all") {
    return settings;
  }
  return {
    ...settings,
    examId: getFirstMatchingExamId(settings),
    order: "ordered",
  };
}

function dueWeight(question, progress) {
  const attempt = progress.attempts[question.id];
  if (!attempt) return 3 + Math.random();
  const accuracy = attempt.correct / Math.max(1, attempt.total);
  return attempt.wrong * 1.6 + (1 - accuracy) * 1.2 + Math.random() * 0.8 - attempt.correct * 0.08;
}

function summarize(progress) {
  const attempts = Object.values(progress.attempts);
  const total = attempts.reduce((sum, item) => sum + item.total, 0);
  const correct = attempts.reduce((sum, item) => sum + item.correct, 0);
  const graded = attempts.reduce((sum, item) => sum + item.correct + item.wrong, 0);
  const rate = graded > 0 ? Math.round((correct / graded) * 100) : 0;
  const mastered = attempts.filter((item) => {
    const itemGraded = item.correct + item.wrong;
    return itemGraded >= 2 && item.correct / itemGraded >= 0.8;
  }).length;
  return { total, correct, rate, mastered };
}

function packStats(progress) {
  return visibleLearningPacks.map((pack) => {
    const memberPackIds = new Set(pack.memberPackIds ?? [pack.id]);
    const questions = questionBank.filter((question) => memberPackIds.has(question.packId));
    const attempts = questions.map((question) => progress.attempts[question.id]).filter(Boolean);
    const total = attempts.reduce((sum, item) => sum + item.total, 0);
    const correct = attempts.reduce((sum, item) => sum + item.correct, 0);
    const graded = attempts.reduce((sum, item) => sum + item.correct + item.wrong, 0);
    const mastered = attempts.filter((item) => {
      const itemGraded = item.correct + item.wrong;
      return itemGraded >= 2 && item.correct / itemGraded >= 0.8;
    }).length;
    const rate = graded > 0 ? Math.round((correct / graded) * 100) : 0;
    return { ...pack, questionCount: questions.length, total, correct, mastered, rate };
  });
}

function mockPackStats() {
  return ["bookkeeping-2", "bookkeeping-3", "officer-kyouyou", "officer-senmon"].map((packId) => {
    const pack = getPack(packId);
    const questions = questionBank.filter((question) => question.packId === packId);
    return { ...pack, questionCount: questions.length };
  }).filter((pack) => pack.id && pack.questionCount > 0);
}

function bucketStats(progress) {
  const buckets = new Map();
  for (const question of questionBank) {
    const key = `${question.packLabel} ${question.subject} ${question.category}`;
    const current = buckets.get(key) ?? {
      key,
      packLabel: question.packLabel,
      subject: question.subject,
      category: question.category,
      total: 0,
      correct: 0,
      wrong: 0,
    };
    const result = progress.attempts[question.id];
    current.total += result?.total ?? 0;
    current.correct += result?.correct ?? 0;
    current.wrong += result?.wrong ?? 0;
    buckets.set(key, current);
  }
  return [...buckets.values()]
    .filter((item) => item.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || b.total - a.total)
    .slice(0, 10);
}

function getAttemptAccuracy(attempt) {
  if (!attempt) return null;
  const graded = attempt.correct + attempt.wrong;
  if (graded === 0) return null;
  return Math.round((attempt.correct / graded) * 100);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function endOfToday() {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return today.getTime();
}

function formatReviewDueLabel(dueAt) {
  if (!dueAt) return "今日";
  const dueTime = new Date(dueAt).getTime();
  if (Number.isNaN(dueTime)) return "今日";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dueTime);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays <= -1) return `${Math.abs(diffDays)}日遅れ`;
  if (diffDays === 0) return "今日";
  if (diffDays === 1) return "明日";
  return `${diffDays}日後`;
}

function isReviewAttemptDue(attempt) {
  if (!attempt || (attempt.wrong ?? 0) <= 0) return false;
  const dueTime = attempt.reviewDueAt ? new Date(attempt.reviewDueAt).getTime() : 0;
  return !dueTime || dueTime <= endOfToday();
}

function getReviewSortValue(attempt) {
  if (!attempt) return 0;
  const dueTime = attempt.reviewDueAt ? new Date(attempt.reviewDueAt).getTime() : 0;
  const overdueDays = dueTime ? Math.max(0, (Date.now() - dueTime) / 86_400_000) : 0;
  return overdueDays * 4 + (attempt.lastResult === "wrong" ? 8 : 0) + (attempt.wrong ?? 0) * 2 - (attempt.reviewLevel ?? 0);
}

function updateAttemptForAnswer(previous = {}, correct, answeredAt) {
  const next = {
    total: (previous.total ?? 0) + 1,
    correct: (previous.correct ?? 0) + (correct === true ? 1 : 0),
    wrong: (previous.wrong ?? 0) + (correct === false ? 1 : 0),
    ungraded: (previous.ungraded ?? 0) + (correct === null ? 1 : 0),
    lastResult: correct === null ? "ungraded" : correct ? "correct" : "wrong",
    lastAt: answeredAt,
    reviewLevel: previous.reviewLevel ?? 0,
    reviewDueAt: previous.reviewDueAt,
    reviewLastAt: previous.reviewLastAt,
  };

  if (correct === false) {
    return {
      ...next,
      reviewLevel: 0,
      reviewDueAt: answeredAt,
      reviewLastAt: answeredAt,
    };
  }

  if (correct === true && ((previous.wrong ?? 0) > 0 || previous.reviewDueAt)) {
    const reviewLevel = Math.min((previous.reviewLevel ?? 0) + 1, reviewIntervalsInDays.length - 1);
    return {
      ...next,
      reviewLevel,
      reviewDueAt: addDays(new Date(answeredAt), reviewIntervalsInDays[reviewLevel]).toISOString(),
      reviewLastAt: answeredAt,
    };
  }

  return next;
}

function getQuestionById(questionId) {
  return questionBank.find((question) => question.id === questionId);
}

function buildHistoryEntries(progress) {
  const storedHistory = Array.isArray(progress.history) ? progress.history : [];
  if (storedHistory.length > 0) {
    return storedHistory
      .map((entry) => {
        const question = getQuestionById(entry.questionId);
        return question ? { ...entry, question } : null;
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.answeredAt).getTime() - new Date(a.answeredAt).getTime());
  }

  return Object.entries(progress.attempts)
    .map(([questionId, attempt]) => {
      const question = getQuestionById(questionId);
      if (!question || !attempt.lastAt) return null;
      return {
        id: `legacy-${questionId}`,
        questionId,
        question,
        correct: attempt.lastResult === "correct" ? true : attempt.lastResult === "wrong" ? false : null,
        answeredAt: attempt.lastAt,
        selectedLabel: "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.answeredAt).getTime() - new Date(a.answeredAt).getTime());
}

function buildReviewCandidates(progress) {
  return questionBank
    .map((question) => {
      const attempt = progress.attempts[question.id];
      const accuracy = getAttemptAccuracy(attempt);
      const wrong = attempt?.wrong ?? 0;
      const reasons = [];

      if (!isReviewAttemptDue(attempt)) return null;
      reasons.push(formatReviewDueLabel(attempt.reviewDueAt));
      if (attempt?.lastResult === "wrong") reasons.push("直近ミス");
      reasons.push(`ミス${wrong}回`);
      if (accuracy !== null && accuracy < 70) reasons.push(`正答率${accuracy}%`);

      return {
        question,
        attempt,
        accuracy,
        reasons,
        dueLabel: formatReviewDueLabel(attempt.reviewDueAt),
        reviewLevel: attempt.reviewLevel ?? 0,
        priority: getReviewSortValue(attempt) + (accuracy === null ? 0 : Math.max(0, 70 - accuracy) / 10),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority || (b.attempt?.wrong ?? 0) - (a.attempt?.wrong ?? 0));
}

function getDayOffset(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getStudyStreak(progress) {
  const days = new Set((progress.history ?? []).map((entry) => {
    const date = new Date(entry.answeredAt);
    return Number.isNaN(date.getTime()) ? null : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }).filter(Boolean));
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`)) cursor.setDate(cursor.getDate() - 1);
  while (days.has(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function buildDailyStudyPlan(progress, settings) {
  const enabled = new Set(settings.enabledPacks);
  const todayKey = getLocalDateKey();
  const completedToday = new Set(
    progress.dailyStudy?.date === todayKey && Array.isArray(progress.dailyStudy.completedQuestionIds)
      ? progress.dailyStudy.completedQuestionIds
      : [],
  );
  const storedNewQuestionIds = progress.dailyStudy?.date === todayKey && Array.isArray(progress.dailyStudy.newQuestionIds)
    ? progress.dailyStudy.newQuestionIds
    : [];
  const inferredLegacyNewQuestionIds = storedNewQuestionIds.length === 0
    ? [...completedToday].filter((questionId) => {
        const attempt = progress.attempts[questionId];
        return attempt?.total === 1 && getLocalDateKey(new Date(attempt.lastAt)) === todayKey;
      })
    : [];
  const dailyNewQuestionIds = new Set([...storedNewQuestionIds, ...inferredLegacyNewQuestionIds]);
  const dueQuestions = buildReviewCandidates(progress)
    .filter((item) => enabled.has(item.question.packId) && !completedToday.has(item.question.id))
    .map((item) => item.question);
  const dueIds = new Set(dueQuestions.map((question) => question.id));
  const newQuestions = orderQuestions(questionBank.filter((question) =>
    enabled.has(question.packId) &&
    !dueIds.has(question.id) &&
    !completedToday.has(question.id) &&
    !progress.attempts[question.id] &&
    !isQuestionUnavailable(question)
  ));
  const configuredLimit = normalizeDailyNewQuestionLimit(settings.dailyNewQuestionLimit);
  const remainingNewQuestionLimit = configuredLimit === UNLIMITED_DAILY_NEW_QUESTIONS
    ? Number.POSITIVE_INFINITY
    : Math.max(0, configuredLimit - dailyNewQuestionIds.size);
  const selectedNew = Number.isFinite(remainingNewQuestionLimit)
    ? newQuestions.slice(0, remainingNewQuestionLimit)
    : newQuestions;
  const queue = [...dueQuestions, ...selectedNew];
  const forecast = [1, 2, 3].map((day) => ({
    day,
    count: Object.values(progress.attempts).filter((attempt) => getDayOffset(attempt.reviewDueAt) === day).length,
  }));
  return {
    queue,
    reviewCount: dueQuestions.length,
    newCount: selectedNew.length,
    newQuestionIds: selectedNew.map((question) => question.id),
    newQuestionLimit: configuredLimit,
    estimatedMinutes: queue.length === 0 ? 0 : Math.max(1, Math.ceil(queue.length * 0.65)),
    streak: getStudyStreak(progress),
    forecast,
  };
}

function applyReviewRating(previous = {}, rating, ratedAt) {
  const intervalDays = rating === "hard" ? 1 : rating === "good" ? 3 : rating === "easy" ? 7 : 0;
  const dueAt = rating === "again"
    ? new Date(new Date(ratedAt).getTime() + 60_000)
    : addDays(new Date(ratedAt), intervalDays);
  const currentLevel = previous.reviewLevel ?? 0;
  const reviewLevel = rating === "again"
    ? 0
    : rating === "hard"
      ? Math.max(1, currentLevel)
      : rating === "good"
        ? Math.max(2, currentLevel + 1)
        : Math.max(3, currentLevel + 2);
  return {
    ...previous,
    reviewLevel: Math.min(reviewLevel, reviewIntervalsInDays.length - 1),
    reviewDueAt: dueAt.toISOString(),
    reviewLastAt: ratedAt,
    reviewRating: rating,
  };
}

function getMockProfile(settings) {
  if (settings.packId !== "all" && mockProfiles[settings.packId]) return mockProfiles[settings.packId];
  if (settings.enabledPacks.length === 1 && mockProfiles[settings.enabledPacks[0]]) return mockProfiles[settings.enabledPacks[0]];
  return { label: "選択条件の模試", minutes: 120, questions: null };
}

function getMockQuestionLimit(settings, sourceCount) {
  const profile = getMockProfile(settings);
  return Math.min(profile.questions ?? sourceCount, sourceCount);
}

function getMockDurationMinutes(settings) {
  return getMockProfile(settings).minutes;
}

function createActiveQuiz(questions, options = {}) {
  return {
    questions,
    index: 0,
    selectedChoice: null,
    status: questions.length > 0 ? "answering" : "empty",
    answers: [],
    selections: {},
    examMode: options.examMode ?? false,
    guidedPractice: options.guidedPractice ?? false,
    dailyMode: options.dailyMode ?? false,
    dailyNewQuestionIds: options.dailyNewQuestionIds ?? [],
    startedAt: options.startedAt ?? null,
    durationSeconds: options.durationSeconds ?? null,
    submittedAt: null,
  };
}

function createQuizForSettings(settings, progress) {
  const normalizedSettings = normalizePracticeSettings(settings);
  const questions = buildQuiz(normalizedSettings, progress);
  if (normalizedSettings.mode !== "mock") {
    const guidedPractice = normalizedSettings.mode === "random" &&
      normalizedSettings.examId !== "all" &&
      questions.some(isOfficerQuestion);
    return createActiveQuiz(guidedPractice ? orderQuestions(questions) : questions, { guidedPractice });
  }
  const limit = getMockQuestionLimit(normalizedSettings, questions.length);
  return createActiveQuiz(questions.slice(0, limit), {
    examMode: true,
    startedAt: Date.now(),
    durationSeconds: getMockDurationMinutes(normalizedSettings) * 60,
  });
}

function getInitialAppState() {
  const progress = loadProgress();
  const settings = loadSettings(progress);
  return {
    progress,
    settings,
    quiz: createQuizForSettings(settings, progress),
  };
}

function resolveSettings(current, partial) {
  const next = { ...current, ...partial };
  if (partial.packId || partial.enabledPacks) {
    next.examId = "all";
    next.subject = "すべて";
    next.category = "すべて";
  }
  if (partial.examId) {
    next.subject = "すべて";
    next.category = "すべて";
  }
  if (partial.subject) {
    if (isOfficerPackSelection(next.packId)) {
      next.examId = "all";
    }
    next.category = "すべて";
  }
  return next;
}

function isOfficerPackSelection(packId) {
  return packId === "officer-candidate" || officerCandidatePackIds.includes(packId);
}

function isOfficerKyouyouPart1EnglishQuestion(question) {
  if (question.packId !== "officer-kyouyou" || question.category !== "その1") return false;
  const sourceText = [
    question.prompt,
    question.transcription?.rawText,
    question.transcription?.text,
    question.transcription?.markdown,
    ...(question.choices ?? []),
  ].filter(Boolean).join("\n");
  return /英文|英語|和文の意味|文法・語法|語句の同意|共通の語|会話文|問いかけに対する.*返答/.test(sourceText);
}

function getOfficerSelectionGroupInfo(question) {
  if (question.packId === "officer-kyouyou" && question.category === "その1") {
    if (isOfficerKyouyouPart1EnglishQuestion(question)) {
      return {
        key: "part1-english",
        title: "その1 英語",
        baseCategory: "その1",
        rule: { kind: "required", label: "必答", target: null, note: "英語問題は必答" },
      };
    }
    return {
      key: "part1-select",
      title: "その1 選択",
      baseCategory: "その1",
      rule: { kind: "select", label: "選択", target: 16, note: "英語必答を除いて選択" },
    };
  }
  return {
    key: question.category || question.subject || "group",
    title: question.category || question.subject || "区分",
    baseCategory: question.category || question.subject || "区分",
    rule: getOfficerSelectionRule(question),
  };
}

function getOfficerSelectionRule(question) {
  if (!isOfficerQuestion(question)) return null;
  if (question.packId === "officer-kyouyou") {
    if (question.category === "その2") {
      return { kind: "required", label: "必答", target: null, note: "全問" };
    }
    return { kind: "select", label: "選択", target: 16, note: "26問中16問" };
  }
  if (question.packId === "officer-senmon") {
    return { kind: "select", label: "選択", target: 20, note: `${question.category}から20問` };
  }
  return null;
}

function buildOfficerSelectionGroups(questions, selections = {}) {
  const groups = [];
  const groupIndex = new Map();
  questions.forEach((question, index) => {
    if (!isOfficerQuestion(question)) return;
    const groupInfo = getOfficerSelectionGroupInfo(question);
    const key = `${question.packId}:${question.examId ?? ""}:${groupInfo.key}`;
    if (!groupIndex.has(key)) {
      groupIndex.set(key, groups.length);
      groups.push({
        key,
        packId: question.packId,
        examId: question.examId ?? "",
        baseCategory: groupInfo.baseCategory,
        title: groupInfo.title,
        subtitle: "",
        rule: groupInfo.rule,
        items: [],
      });
    }
    const group = groups[groupIndex.get(key)];
    group.items.push({
      question,
      index,
      answered: Number.isInteger(selections?.[question.id]),
    });
  });
  return groups.map((group) => {
    const answerableItems = group.items.filter((item) => isAnswerableMockQuestion(item.question));
    const answered = group.items.filter((item) => item.answered && isAnswerableMockQuestion(item.question)).length;
    const englishRequiredCount = groups.find((candidate) =>
      candidate.packId === group.packId &&
      candidate.examId === group.examId &&
      candidate.baseCategory === "その1" &&
      candidate.rule?.kind === "required"
    )?.items.filter((item) => isAnswerableMockQuestion(item.question)).length ?? 0;
    const adjustedRule = group.packId === "officer-kyouyou" &&
      group.baseCategory === "その1" &&
      group.rule?.kind === "select"
      ? {
          ...group.rule,
          target: Math.min(answerableItems.length, Math.max(0, (group.rule.target ?? 0) - englishRequiredCount)),
          note: englishRequiredCount > 0
            ? `英語${englishRequiredCount}問は必答、残りから${Math.max(0, (group.rule.target ?? 0) - englishRequiredCount)}問選択`
            : group.rule.note,
        }
      : group.rule;
    return {
      ...group,
      rule: adjustedRule,
      answered,
      answerableCount: answerableItems.length,
    };
  });
}

function getMockRequiredAnswerCount(questions) {
  const officerGroups = buildOfficerSelectionGroups(questions);
  if (officerGroups.length > 0) {
    return officerGroups.reduce((total, group) => total + (group.rule?.target ?? group.answerableCount), 0);
  }
  return questions.filter(isAnswerableMockQuestion).length;
}

function getOfficerSelectionState(questions, selections, question) {
  if (!isOfficerQuestion(question)) return null;
  const groups = buildOfficerSelectionGroups(questions, selections);
  return groups.find((group) => group.items.some((item) => item.question.id === question.id)) ?? null;
}

function canSelectMockChoice(quiz, question) {
  if (!quiz.examMode || !isOfficerQuestion(question)) return true;
  if (!isAnswerableMockQuestion(question)) return false;
  if (Number.isInteger(quiz.selections?.[question.id])) return true;
  const group = getOfficerSelectionState(quiz.questions, quiz.selections, question);
  const target = group?.rule?.target;
  return !target || group.answered < target;
}

function getAnsweredQuizStatus(quiz, question) {
  if (!question || !Number.isInteger(quiz.selections?.[question.id])) return "answering";
  const answer = [...quiz.answers].reverse().find((item) => item.questionId === question.id);
  if (!answer) return "answering";
  if (answer.correct === true) return "correct";
  if (answer.correct === false) return "incorrect";
  return "ungraded";
}

function getQuestionNavLabel(question, fallbackIndex) {
  if (Number.isInteger(question.questionNumber)) return question.questionNumber;
  return fallbackIndex + 1;
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

function App() {
  const [initial] = useState(getInitialAppState);
  const [settings, setSettings] = useState(initial.settings);
  const [progress, setProgress] = useState(initial.progress);
  const [quiz, setQuiz] = useState(initial.quiz);
  const [landingTrack, setLandingTrack] = useState(getEntryTrackFromLocation);
  const [activeView, setActiveView] = useState(() => window.location.pathname === "/admin" ? "admin" : "landing");
  const [activeMaterialLessonId, setActiveMaterialLessonId] = useState(null);
  const [materialCheckpointChoice, setMaterialCheckpointChoice] = useState(null);
  const [materialCheckpointResult, setMaterialCheckpointResult] = useState(null);
  const [isBankLoading, setIsBankLoading] = useState(questionBank.length === 0);
  const [bankVersion, setBankVersion] = useState(0);
  const [bankError, setBankError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [mockCountdown, setMockCountdown] = useState(null);
  const [practiceSidebarHidden, setPracticeSidebarHidden] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authSession, setAuthSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(authConfigReady);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState("signin");
  const [cloudSync, setCloudSync] = useState({ status: "idle", updatedAt: null, error: "" });
  const [cloudReady, setCloudReady] = useState(false);
  const [adminAccess, setAdminAccess] = useState("idle");
  const [announcements, setAnnouncements] = useState([]);
  const [dismissedAnnouncementId, setDismissedAnnouncementId] = useState(null);
  const [supportDialog, setSupportDialog] = useState(null);
  const [membership, setMembership] = useState({ premium: false, status: "free", plan: null });
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState(() => new URLSearchParams(window.location.search).get("checkout"));

  useEffect(() => {
    if (!supabase) return undefined;
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setAuthSession(data.session ?? null);
      setAuthUser(data.session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthSession(session ?? null);
      setAuthUser(session?.user ?? null);
      setAuthLoading(false);
      if (event === "SIGNED_IN") setAuthDialogOpen(false);
      if (event === "PASSWORD_RECOVERY") {
        setAuthDialogMode("update-password");
        setAuthDialogOpen(true);
      }
      if (event === "SIGNED_OUT") {
        setCloudReady(false);
        setCloudSync({ status: "idle", updatedAt: null, error: "" });
        setAdminAccess("denied");
        setActiveView((current) => ["account", "admin"].includes(current) ? "landing" : current);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const devAdmin = import.meta.env.DEV && import.meta.env.VITE_MEMEMO_DEV_ADMIN === "1";
    if (authLoading) return undefined;
    const accessToken = authSession?.access_token ?? "";
    if (!accessToken && !devAdmin) {
      setAdminAccess("denied");
      return undefined;
    }
    let cancelled = false;
    setAdminAccess("checking");
    checkAdminAccess(accessToken)
      .then((result) => {
        if (!cancelled) setAdminAccess(result.admin ? "granted" : "denied");
      })
      .catch(() => {
        if (!cancelled) setAdminAccess("denied");
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, authSession?.access_token]);

  useEffect(() => {
    let cancelled = false;
    loadPublicAnnouncements().then((items) => {
      if (!cancelled) setAnnouncements(items);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!authUser?.id) {
      setCloudReady(false);
      return undefined;
    }
    let cancelled = false;
    setCloudReady(false);
    setCloudSync({ status: "loading", updatedAt: null, error: "" });
    loadUserLearningState(authUser.id)
      .then((remoteState) => {
        if (cancelled) return;
        setProgress((localProgress) => {
          const mergedProgress = mergeLearningState(localProgress, remoteState?.progress);
          setSettings((localSettings) => sanitizeSyncedSettings(remoteState?.settings, mergedProgress, localSettings));
          return mergedProgress;
        });
        setCloudReady(true);
        setCloudSync({
          status: "synced",
          updatedAt: remoteState?.updated_at ?? new Date().toISOString(),
          error: "",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setCloudReady(false);
        setCloudSync({
          status: "error",
          updatedAt: null,
          error: error instanceof Error ? error.message : "学習データを読み込めませんでした。",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [authUser?.id]);

  useEffect(() => {
    if (!cloudReady || !authUser?.id) return undefined;
    const timer = window.setTimeout(() => {
      setCloudSync((current) => ({ ...current, status: "saving", error: "" }));
      saveUserLearningState(authUser.id, progress, settings)
        .then(() => setCloudSync({ status: "synced", updatedAt: new Date().toISOString(), error: "" }))
        .catch((error) => setCloudSync((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : "学習データを保存できませんでした。",
        })));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [authUser?.id, cloudReady, progress, settings]);

  useEffect(() => {
    const handlePopState = () => {
      setLandingTrack(getEntryTrackFromLocation());
      setActiveView(window.location.pathname === "/admin" ? "admin" : "landing");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (activeView !== "admin" && window.location.pathname === "/admin") {
      window.history.replaceState({}, "", "/");
    }
  }, [activeView]);

  useEffect(() => {
    const isOfficerTrack = landingTrack === "officer";
    document.title = isOfficerTrack
      ? "一般幹部候補生等採用試験の問題演習 | Mememo"
      : "日商簿記2級・3級の問題演習 | Mememo";
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.setAttribute(
        "content",
        isOfficerTrack
          ? "防衛省・自衛隊が公開している一般幹部候補生等採用試験の一般教養・専門択一を演習できます。"
          : "日商簿記2級・3級を、2026年度の出題区分を参照したオリジナル問題で演習できます。",
      );
    }
  }, [landingTrack]);

  useEffect(() => {
    if (!authConfigReady) return;
    const contact = new URLSearchParams(window.location.search).get("contact");
    if (contact === "commerce") setSupportDialog({ type: "contact", question: null });
  }, []);

  useEffect(() => {
    if (authLoading) return undefined;
    let cancelled = false;
    const accessToken = authSession?.access_token ?? "";
    setIsBankLoading(true);
    setBankError("");
    Promise.all([
      getMembership(accessToken),
      loadQuestionBank({ accessToken, force: true }),
    ])
      .then(([nextMembership]) => {
        if (cancelled) return;
        setMembership(nextMembership);
        setBankVersion((version) => version + 1);
        setIsBankLoading(false);
        setQuiz(createQuizForSettings(settings, progress));
      })
      .catch((error) => {
        if (cancelled) return;
        setBankError(error instanceof Error ? error.message : "問題データの読み込みに失敗しました。");
        setIsBankLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, authSession?.access_token]);

  useEffect(() => {
    if (checkoutNotice !== "success" || !authSession?.access_token) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        const nextMembership = await getMembership(authSession.access_token);
        setMembership(nextMembership);
        if (nextMembership.premium) {
          await loadQuestionBank({ accessToken: authSession.access_token, force: true });
          setBankVersion((version) => version + 1);
          setQuiz(createQuizForSettings(settings, progress));
        }
      } catch {
        // The webhook can take a moment; the next page load retries safely.
      }
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [checkoutNotice, authSession?.access_token]);

  useEffect(() => {
    if (quiz.startedAt) setNow(Date.now());
  }, [quiz.startedAt]);

  useEffect(() => {
    if (!quiz.examMode || quiz.status !== "answering") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quiz.examMode, quiz.status, quiz.startedAt]);

  useEffect(() => {
    if (mockCountdown === null) return undefined;
    if (mockCountdown <= 0) {
      setMockCountdown(null);
      startQuiz({ mode: "mock" });
      return undefined;
    }
    const timer = window.setTimeout(() => setMockCountdown((value) => Math.max(0, (value ?? 0) - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [mockCountdown]);

  const enabledPackSet = useMemo(() => new Set(settings.enabledPacks), [settings.enabledPacks]);
  const activePackStats = useMemo(() => packStats(progress), [progress, bankVersion]);
  const availableMockPacks = useMemo(() => mockPackStats(), [bankVersion]);
  const summary = useMemo(() => summarize(progress), [progress]);
  const statsByBucket = useMemo(() => bucketStats(progress), [progress, bankVersion]);
  const historyEntries = useMemo(() => buildHistoryEntries(progress), [progress, bankVersion]);
  const reviewCandidates = useMemo(() => buildReviewCandidates(progress), [progress, bankVersion]);
  const dailyPlan = useMemo(
    () => buildDailyStudyPlan(progress, settings),
    [progress, settings.enabledPacks, settings.dailyNewQuestionLimit, bankVersion],
  );
  const recommendedLesson = useMemo(
    () => materialLessons.find((lesson) => !["understood", "mastered"].includes(progress.lessonProgress?.[lesson.id]?.status)) ?? materialLessons[0],
    [progress.lessonProgress],
  );
  const activeMaterialLesson = activeMaterialLessonId ? getMaterialLesson(activeMaterialLessonId) : null;
  const mockSecondsRemaining = useMemo(() => {
    if (!quiz.examMode || !quiz.startedAt || !quiz.durationSeconds) return null;
    const elapsed = Math.floor((now - quiz.startedAt) / 1000);
    return Math.max(0, quiz.durationSeconds - elapsed);
  }, [now, quiz.examMode, quiz.startedAt, quiz.durationSeconds]);
  const examOptions = useMemo(() => {
    const scoped = questionBank.filter((question) => {
      const packEnabled = enabledPackSet.has(question.packId);
      const packMatch = questionMatchesPackSelection(question, settings.packId);
      const subjectMatch = settings.subject === "すべて" || getFilterSubject(question) === settings.subject;
      return packEnabled && packMatch && subjectMatch && question.examId && question.examTitle;
    });
    const byId = new Map();
    for (const question of scoped) {
      if (!byId.has(question.examId)) {
        byId.set(question.examId, {
          id: question.examId,
          title: question.examTitle,
          count: 0,
        });
      }
      byId.get(question.examId).count += 1;
    }
    return [{ id: "all", title: "すべての試験回", count: scoped.length }, ...byId.values()];
  }, [enabledPackSet, settings.packId, settings.subject, bankVersion]);

  const availableSubjects = useMemo(() => {
    const scoped = questionBank.filter((question) => {
      const packEnabled = enabledPackSet.has(question.packId);
      const packMatch = questionMatchesPackSelection(question, settings.packId);
      return packEnabled && packMatch;
    });
    return ["すべて", ...Array.from(new Set(scoped.map(getFilterSubject)))];
  }, [enabledPackSet, settings.packId, bankVersion]);

  const categories = useMemo(() => {
    const scoped = questionBank.filter((question) => {
      const packEnabled = enabledPackSet.has(question.packId);
      const packMatch = questionMatchesPackSelection(question, settings.packId);
      const examMatch = settings.examId === "all" || question.examId === settings.examId;
      const subjectMatch = settings.subject === "すべて" || getFilterSubject(question) === settings.subject;
      return packEnabled && packMatch && examMatch && subjectMatch;
    });
    return ["すべて", ...Array.from(new Set(scoped.map(getFilterCategory).filter((item) => item !== "すべて")))];
  }, [enabledPackSet, settings.packId, settings.examId, settings.subject, bankVersion]);

  const categoryOptions = useMemo(() => {
    const scoped = questionBank.filter((question) => {
      const packEnabled = enabledPackSet.has(question.packId);
      const packMatch = questionMatchesPackSelection(question, settings.packId);
      const examMatch = settings.examId === "all" || question.examId === settings.examId;
      const subjectMatch = settings.subject === "すべて" || getFilterSubject(question) === settings.subject;
      return packEnabled && packMatch && examMatch && subjectMatch;
    });
    return categories.map((item) => ({
      value: item,
      label: item,
      detail: item === "すべて"
        ? `${scoped.length}問`
        : `${scoped.filter((question) => getFilterCategory(question) === item).length}問`,
    }));
  }, [categories, enabledPackSet, settings.packId, settings.examId, settings.subject, bankVersion]);

  function updateSettings(partial) {
    const resolvedSettings = resolveSettings(settings, partial);
    const nextSettings = activeView === "quiz" ? normalizePracticeSettings(resolvedSettings) : resolvedSettings;
    setSettings(nextSettings);
    if (nextSettings.mode === "mock" && activeView === "mock") return;
    setQuiz(createQuizForSettings(nextSettings, progress));
  }

  function togglePack(packId) {
    const selected = new Set(settings.enabledPacks);
    const memberPackIds = getPackMemberIds(packId);
    const selectedPackEnabled = memberPackIds.every((memberPackId) => selected.has(memberPackId));
    if (selectedPackEnabled && selected.size > memberPackIds.length) {
      memberPackIds.forEach((memberPackId) => selected.delete(memberPackId));
    } else {
      memberPackIds.forEach((memberPackId) => selected.add(memberPackId));
    }
    const nextEnabled = [...selected];
    const nextSettings = {
      ...settings,
      enabledPacks: nextEnabled,
      packId:
        settings.packId !== "all" &&
        !getPackMemberIds(settings.packId).some((memberPackId) => selected.has(memberPackId))
          ? "all"
          : settings.packId,
      examId: "all",
      subject: "すべて",
      category: "すべて",
    };
    setSettings(nextSettings);
    setProgress((current) => ({ ...current, enabledPacks: nextEnabled }));
    setQuiz(createQuizForSettings(nextSettings, progress));
  }

  function startQuiz(overrides = {}) {
    const nextSettings = normalizePracticeSettings({ ...settings, ...overrides });
    setSettings(nextSettings);
    setQuiz(createQuizForSettings(nextSettings, progress));
    setActiveView("quiz");
  }

  function changeLandingTrack(track) {
    if (!ENTRY_TRACKS[track] || track === landingTrack) return;
    window.history.pushState({}, "", ENTRY_TRACKS[track].path);
    setLandingTrack(track);
    setActiveView("landing");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openPractice(packId = null) {
    const selectedPackId = typeof packId === "string" ? packId : null;
    const nextEnabledSet = new Set(settings.enabledPacks);
    if (selectedPackId) {
      getPackMemberIds(selectedPackId).forEach((memberPackId) => nextEnabledSet.add(memberPackId));
    }
    const nextEnabled = [...nextEnabledSet];
    const nextSettings = normalizePracticeSettings({
      ...settings,
      enabledPacks: nextEnabled,
      ...(selectedPackId ? { packId: selectedPackId, examId: "all", subject: "すべて", category: "すべて" } : {}),
      mode: membership.premium && settings.mode === "weak" ? "weak" : "random",
    });
    setSettings(nextSettings);
    if (nextEnabled.length !== settings.enabledPacks.length) {
      setProgress((current) => ({ ...current, enabledPacks: nextEnabled }));
    }
    setQuiz(createQuizForSettings(nextSettings, progress));
    setPracticeSidebarHidden(window.matchMedia("(max-width: 640px)").matches);
    setActiveView("quiz");
  }

  function startTodayStudy() {
    if (dailyPlan.queue.length === 0) return;
    setPracticeSidebarHidden(true);
    setQuiz(createActiveQuiz(dailyPlan.queue, {
      dailyMode: true,
      dailyNewQuestionIds: dailyPlan.newQuestionIds,
    }));
    setActiveView("quiz");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function rateDailyQuestion(rating) {
    const question = quiz.questions[quiz.index];
    if (!question || !quiz.dailyMode || quiz.status === "answering") return;
    const ratedAt = new Date().toISOString();
    const isNewDailyQuestion = quiz.dailyNewQuestionIds.includes(question.id);
    setProgress((current) => {
      const todayKey = getLocalDateKey(new Date(ratedAt));
      const completedQuestionIds = current.dailyStudy?.date === todayKey
        ? current.dailyStudy.completedQuestionIds ?? []
        : [];
      const newQuestionIds = current.dailyStudy?.date === todayKey
        ? current.dailyStudy.newQuestionIds ?? []
        : [];
      return {
        ...current,
        dailyStudy: {
          date: todayKey,
          completedQuestionIds: rating === "again"
            ? completedQuestionIds
            : [...new Set([...completedQuestionIds, question.id])],
          newQuestionIds: isNewDailyQuestion
            ? [...new Set([...newQuestionIds, question.id])]
            : newQuestionIds,
        },
        attempts: {
          ...current.attempts,
          [question.id]: applyReviewRating(current.attempts[question.id], rating, ratedAt),
        },
      };
    });
    setQuiz((current) => {
      if (rating === "again") {
        return {
          ...current,
          questions: [...current.questions, question],
          index: current.index + 1,
          selectedChoice: null,
          status: "answering",
        };
      }
      if (current.index >= current.questions.length - 1) return { ...current, status: "complete" };
      return {
        ...current,
        index: current.index + 1,
        selectedChoice: null,
        status: "answering",
      };
    });
  }

  function openMockSetup() {
    if (!membership.premium) {
      setBillingError("");
      setUpgradeDialogOpen(true);
      return;
    }
    const mockPackIds = new Set(["bookkeeping-2", "bookkeeping-3", "officer-kyouyou", "officer-senmon"]);
    const packId = settings.packId === "officer-candidate"
      ? "officer-kyouyou"
      : mockPackIds.has(settings.packId)
        ? settings.packId
        : DEFAULT_PACK_ID;
    const nextSettings = {
      ...settings,
      packId,
      mode: "mock",
      examId: "all",
      subject: "すべて",
      category: "すべて",
    };
    setSettings(nextSettings);
    setMockCountdown(null);
    setActiveView("mock");
  }

  function startMockCountdown() {
    if (settings.examId === "all") return;
    if (settings.packId === "officer-senmon" && settings.category === "すべて") return;
    setMockCountdown(3);
  }

  function startQuestionSet(questions, overrides = {}) {
    const nextQuestions = questions.filter(Boolean);
    if (nextQuestions.length === 0) return;
    const nextSettings = { ...settings, ...overrides };
    setSettings(nextSettings);
    setQuiz(createActiveQuiz(nextQuestions));
    setActiveView("quiz");
  }

  function openMaterials() {
    setActiveMaterialLessonId(null);
    setActiveView("materials");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openMaterialLesson(lessonId) {
    const lesson = getMaterialLesson(lessonId);
    if (!lesson) return;
    const openedAt = new Date().toISOString();
    setActiveMaterialLessonId(lessonId);
    setMaterialCheckpointChoice(null);
    setMaterialCheckpointResult(null);
    setProgress((current) => ({
      ...current,
      lessonProgress: {
        ...(current.lessonProgress ?? {}),
        [lessonId]: {
          ...(current.lessonProgress?.[lessonId] ?? {}),
          status: ["understood", "mastered"].includes(current.lessonProgress?.[lessonId]?.status)
            ? current.lessonProgress[lessonId].status
            : "in_progress",
          lastOpenedAt: openedAt,
        },
      },
    }));
    setActiveView("material");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function checkMaterialAnswer() {
    if (!activeMaterialLesson || !Number.isInteger(materialCheckpointChoice)) return;
    const correct = materialCheckpointChoice === activeMaterialLesson.checkpoint.answer;
    const checkedAt = new Date().toISOString();
    setMaterialCheckpointResult(correct ? "correct" : "incorrect");
    setProgress((current) => ({
      ...current,
      lessonProgress: {
        ...(current.lessonProgress ?? {}),
        [activeMaterialLesson.id]: {
          ...(current.lessonProgress?.[activeMaterialLesson.id] ?? {}),
          status: correct ? "understood" : "needs_review",
          checkpointCorrect: correct,
          lastCheckedAt: checkedAt,
          ...(correct ? { completedAt: checkedAt } : {}),
        },
      },
    }));
  }

  function startMaterialQuestions(lesson) {
    const filters = lesson.relatedQuestionFilters;
    const packQuestions = questionBank
      .filter((question) => question.packId === filters.packId)
      .filter((question) => Number.isInteger(question.answer) && Array.isArray(question.choices));
    const categoryQuestions = packQuestions.filter((question) => filters.categories.includes(question.category));
    const questions = (categoryQuestions.length > 0 ? categoryQuestions : packQuestions).slice(0, 5);
    startQuestionSet(questions, {
      packId: filters.packId,
      examId: "all",
      subject: "すべて",
      category: "すべて",
      mode: "random",
      order: "ordered",
    });
  }

  function answerQuestion(choiceIndex) {
    setQuiz((current) => {
      if (current.status !== "answering") return current;
      const question = current.questions[current.index];
      if (current.examMode) {
        if (!canSelectMockChoice(current, question)) return current;
        return {
          ...current,
          selectedChoice: choiceIndex,
          selections: {
            ...current.selections,
            [question.id]: choiceIndex,
          },
        };
      }
      const hasAnswer = Number.isInteger(question.answer);
      const correct = hasAnswer ? choiceIndex === question.answer : null;
      const nextStatus = hasAnswer ? (correct ? "correct" : "incorrect") : "ungraded";

      setProgress((currentProgress) => {
        const previous = currentProgress.attempts[question.id] ?? { total: 0, correct: 0, wrong: 0 };
        const answeredAt = new Date().toISOString();
        const selectedLabel = question.choiceLabels?.[choiceIndex] ?? String.fromCharCode(65 + choiceIndex);
        const historyEntry = {
          id: `${answeredAt}-${question.id}`,
          questionId: question.id,
          packId: question.packId,
          examId: question.examId ?? "",
          subject: question.subject,
          category: question.category,
          choiceIndex,
          selectedLabel,
          correct,
          answeredAt,
        };
        return {
          ...currentProgress,
          history: [historyEntry, ...(currentProgress.history ?? [])].slice(0, 500),
          attempts: {
            ...currentProgress.attempts,
            [question.id]: updateAttemptForAnswer(previous, correct, answeredAt),
          },
        };
      });

      return {
        ...current,
        selectedChoice: choiceIndex,
        status: nextStatus,
        selections: {
          ...current.selections,
          [question.id]: choiceIndex,
        },
        answers: [
          ...current.answers,
          {
            questionId: question.id,
            packId: question.packId,
            subject: question.subject,
            category: question.category,
            choiceIndex,
            correct,
          },
        ],
      };
    });
  }

  function nextQuestion() {
    setQuiz((current) => {
      if (current.index === current.questions.length - 1) {
        if (current.examMode || current.guidedPractice) return current;
        const refill = buildQuiz(settings, progress);
        if (refill.length === 0) return current;
        return {
          ...current,
          questions: [...current.questions, ...refill],
          index: current.index + 1,
          selectedChoice: null,
          status: "answering",
        };
      }
      const nextQuestionItem = current.questions[current.index + 1];
      return {
        ...current,
        index: current.index + 1,
        selectedChoice: current.selections[nextQuestionItem?.id] ?? null,
        status: current.examMode ? "answering" : getAnsweredQuizStatus(current, nextQuestionItem),
      };
    });
  }

  function previousQuestion() {
    setQuiz((current) => {
      if (current.status === "empty" || current.index <= 0) return current;
      return {
        ...current,
        index: current.index - 1,
        selectedChoice: current.selections[current.questions[current.index - 1]?.id] ?? null,
        status: current.examMode ? "answering" : getAnsweredQuizStatus(current, current.questions[current.index - 1]),
      };
    });
  }

  function jumpToQuestion(index) {
    setQuiz((current) => {
      if (current.status === "empty" || index < 0 || index >= current.questions.length) return current;
      const question = current.questions[index];
      return {
        ...current,
        index,
        selectedChoice: current.selections[question.id] ?? null,
        status: current.examMode ? "answering" : getAnsweredQuizStatus(current, question),
      };
    });
  }

  function submitMockExam(reason = "manual") {
    setQuiz((current) => {
      if (!current.examMode || current.status !== "answering") return current;
      const submittedAt = Date.now();
      const requiredAnswerCount = getMockRequiredAnswerCount(current.questions);
      const answers = current.questions.map((question) => {
        const choiceIndex = current.selections[question.id];
        const answered = Number.isInteger(choiceIndex);
        const hasAnswer = Number.isInteger(question.answer);
        return {
          questionId: question.id,
          packId: question.packId,
          subject: question.subject,
          category: question.category,
          choiceIndex: answered ? choiceIndex : null,
          correct: answered && hasAnswer ? choiceIndex === question.answer : null,
          unanswered: !answered,
        };
      });

      setProgress((currentProgress) => {
        const answeredAt = new Date(submittedAt).toISOString();
        const nextAttempts = { ...currentProgress.attempts };
        const history = [...(currentProgress.history ?? [])];

        for (const answer of answers) {
          if (!Number.isInteger(answer.choiceIndex)) continue;
          const question = getQuestionById(answer.questionId);
          if (!question) continue;
          const previous = nextAttempts[question.id] ?? { total: 0, correct: 0, wrong: 0 };
          const selectedLabel = question.choiceLabels?.[answer.choiceIndex] ?? String.fromCharCode(65 + answer.choiceIndex);
          history.unshift({
            id: `${answeredAt}-${question.id}`,
            questionId: question.id,
            packId: question.packId,
            examId: question.examId ?? "",
            subject: question.subject,
            category: question.category,
            choiceIndex: answer.choiceIndex,
            selectedLabel,
            correct: answer.correct,
            answeredAt,
          });
          nextAttempts[question.id] = {
            ...updateAttemptForAnswer(previous, answer.correct, answeredAt),
          };
        }

        const graded = answers.filter((answer) => answer.correct !== null);
        const correct = graded.filter((answer) => answer.correct).length;
        const answered = answers.filter((answer) => !answer.unanswered).length;
        const examTitle = uniqueCompactLabels(current.questions.map((question) => question.examTitle))[0] ?? "";
        const packLabel = uniqueCompactLabels(current.questions.map((question) => getPack(question.packId)?.label ?? question.packId))[0] ?? "";
        return {
          ...currentProgress,
          history: history.slice(0, 500),
          attempts: nextAttempts,
          sessions: [
            {
              id: `${answeredAt}-mock`,
              date: answeredAt,
              mode: "mock",
              total: requiredAnswerCount,
              correct,
              graded: graded.length,
              questionCount: current.questions.length,
              requiredAnswerCount,
              answered,
              unanswered: Math.max(0, requiredAnswerCount - answered),
              rate: requiredAnswerCount > 0 ? Math.round((correct / requiredAnswerCount) * 100) : 0,
              elapsedSeconds: Math.max(0, Math.floor((submittedAt - current.startedAt) / 1000)),
              reason,
              packId: current.questions[0]?.packId ?? "",
              packLabel,
              examId: current.questions[0]?.examId ?? "",
              examTitle,
            },
            ...(currentProgress.sessions ?? []),
          ].slice(0, 30),
        };
      });

      return {
        ...current,
        status: "complete",
        answers,
        submittedAt,
      };
    });
  }

  useEffect(() => {
    if (!quiz.examMode || quiz.status !== "answering" || mockSecondsRemaining !== 0) return;
    submitMockExam("timeup");
  }, [quiz.examMode, quiz.status, mockSecondsRemaining]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "escape" && shortcutHelpOpen) {
        event.preventDefault();
        setShortcutHelpOpen(false);
        return;
      }

      if (key === "/") {
        event.preventDefault();
        setShortcutHelpOpen((open) => !open);
        return;
      }

      if (shortcutHelpOpen || activeView !== "quiz") return;
      if (quiz.status === "empty" || quiz.status === "complete") return;

      const choiceIndex = choiceShortcutKeys.indexOf(key);
      if (choiceIndex >= 0) {
        const currentQuestion = quiz.questions[quiz.index];
        if (quiz.status === "answering" && currentQuestion?.choices?.[choiceIndex] != null) {
          event.preventDefault();
          answerQuestion(choiceIndex);
        } else if (quiz.dailyMode && choiceIndex < reviewRatingOptions.length) {
          event.preventDefault();
          rateDailyQuestion(reviewRatingOptions[choiceIndex].id);
        }
        return;
      }

      if (key === nextShortcutKey) {
        event.preventDefault();
        if (quiz.dailyMode) return;
        nextQuestion();
        return;
      }

      if (key === previousShortcutKey) {
        event.preventDefault();
        previousQuestion();
      }
    }

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [activeView, quiz, shortcutHelpOpen]);

  function resetProgress() {
    const destination = authUser ? "この端末とアカウント同期先" : "この端末";
    if (!window.confirm(`${destination}の学習履歴・復習状況・教材進捗をリセットします。よろしいですか？`)) return;
    const nextProgress = { ...emptyProgress, enabledPacks: settings.enabledPacks };
    setProgress(nextProgress);
    setQuiz(createQuizForSettings(settings, nextProgress));
  }

  function openContactDialog(question = null) {
    setSupportDialog({
      type: question ? "question_report" : "contact",
      question,
    });
  }

  function openAuth(mode = "signin") {
    setAuthDialogMode(mode);
    setAuthDialogOpen(true);
  }

  function openAccount() {
    if (!authUser) {
      openAuth("signin");
      return;
    }
    setActiveView("account");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openAdmin() {
    setActiveView("admin");
    if (window.location.pathname !== "/admin") window.history.pushState({}, "", "/admin");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  function requirePremium(action) {
    if (membership.premium) {
      action();
      return true;
    }
    setBillingError("");
    setUpgradeDialogOpen(true);
    return false;
  }

  function openPremiumView(view) {
    requirePremium(() => setActiveView(view));
  }

  async function startCheckout(interval) {
    if (!authUser) {
      setUpgradeDialogOpen(false);
      openAuth("signin");
      return;
    }
    setBillingBusy(true);
    setBillingError("");
    try {
      const { url } = await createCheckout(interval);
      window.location.assign(url);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "購入手続きを開始できませんでした。");
      setBillingBusy(false);
    }
  }

  async function openBillingPortal() {
    setBillingBusy(true);
    setBillingError("");
    try {
      const { url } = await createBillingPortal();
      window.location.assign(url);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "契約管理画面を開けませんでした。");
      setBillingBusy(false);
    }
  }

  if (isBankLoading) {
    return (
      <div className="app-loading" role="status">
        <GraduationCap aria-hidden="true" size={28} />
        <strong>問題データを読み込み中</strong>
      </div>
    );
  }

  if (bankError) {
    return (
      <div className="app-loading error" role="alert">
        <X aria-hidden="true" size={28} />
        <strong>{bankError}</strong>
      </div>
    );
  }

  const currentQuestion = quiz.questions[quiz.index];
  const isFocusMode = activeView === "quiz" && quiz.examMode && quiz.status === "answering";
  const isPracticeView = activeView === "quiz" && !quiz.examMode;
  const hideShellPanels = isFocusMode || activeView === "mock" || activeView === "landing" || activeView === "materials" || activeView === "material" || activeView === "account" || activeView === "admin";
  const hideControlPanel = hideShellPanels || (isPracticeView && (quiz.dailyMode || practiceSidebarHidden));
  const hideInsightPanel = hideShellPanels || isPracticeView;
  const mainShellClassName = ["landing", "materials", "material", "account", "admin"].includes(activeView)
    ? "landing-shell"
    : hideControlPanel
      ? "learning-shell focus-learning-shell"
      : isPracticeView
        ? "learning-shell practice-learning-shell"
      : "learning-shell";

  return (
    <div className={isFocusMode ? "app-shell focus-mode" : "app-shell"}>
      {shortcutHelpOpen && <ShortcutHelpDialog onClose={() => setShortcutHelpOpen(false)} />}
      {authDialogOpen && (
        <AuthDialog
          initialMode={authDialogMode}
          onClose={() => setAuthDialogOpen(false)}
        />
      )}
      {upgradeDialogOpen && (
        <UpgradeDialog
          user={authUser}
          membership={membership}
          busy={billingBusy}
          error={billingError}
          onClose={() => setUpgradeDialogOpen(false)}
          onLogin={() => {
            setUpgradeDialogOpen(false);
            openAuth("signin");
          }}
          onCheckout={startCheckout}
          onPortal={openBillingPortal}
        />
      )}
      {authConfigReady && supportDialog && (
        <SupportDialog
          request={supportDialog}
          user={authUser}
          onClose={() => setSupportDialog(null)}
        />
      )}
      {!isFocusMode && <header className="app-header">
        <div className="header-start">
          {isPracticeView && !quiz.dailyMode && (
            <button
              className="sidebar-toggle-button"
              type="button"
              onClick={() => setPracticeSidebarHidden((hidden) => !hidden)}
              aria-label={practiceSidebarHidden ? "サイドバーを表示" : "サイドバーを非表示"}
              title={practiceSidebarHidden ? "サイドバーを表示" : "サイドバーを非表示"}
            >
              {practiceSidebarHidden ? <PanelLeftOpen aria-hidden="true" size={19} /> : <PanelLeftClose aria-hidden="true" size={19} />}
            </button>
          )}
          <button className="brand brand-button" type="button" onClick={() => setActiveView("landing")} aria-label="Mememo ホーム">
            <span className="brand-mark">M</span>
            <span>Mememo</span>
          </button>
        </div>
        <nav className="top-nav" aria-label="主要ナビゲーション">
          <button className={activeView === "landing" ? "active" : ""} type="button" onClick={() => setActiveView("landing")}>今日</button>
          <button className={["materials", "material"].includes(activeView) ? "active" : ""} type="button" onClick={openMaterials}>教材</button>
          <button className={activeView === "quiz" ? "active" : ""} type="button" onClick={() => openPractice()}>問題</button>
          <button className={activeView === "mock" ? "active" : ""} type="button" onClick={openMockSetup}>{!membership.premium && <Lock aria-hidden="true" size={14} />}模試</button>
          <button className={activeView === "history" ? "active" : ""} type="button" onClick={() => openPremiumView("history")}>{!membership.premium && <Lock aria-hidden="true" size={14} />}記録</button>
          <button className={activeView === "market" ? "active" : ""} type="button" onClick={() => setActiveView("market")}>その他</button>
          {authConfigReady && (
            <button type="button" onClick={() => openContactDialog()}>
              <MessageSquare aria-hidden="true" size={16} />
              問い合わせ
            </button>
          )}
          {adminAccess === "granted" && (
            <button className={activeView === "admin" ? "active" : ""} type="button" onClick={openAdmin}>
              <LayoutDashboard aria-hidden="true" size={16} />
              管理
            </button>
          )}
        </nav>
        <div className="header-account" aria-label="アカウント">
          {authUser ? (
            <>
              <button className={membership.premium ? "account-pill premium" : "account-pill"} type="button" onClick={openAccount}>
                <UserAvatar user={authUser} size="small" />
                {getUserDisplayName(authUser) || authUser.email || "マイページ"}
                {membership.premium && <strong>PRO</strong>}
              </button>
              <button className="account-button upgrade" type="button" onClick={membership.complimentaryAccess ? openAccount : () => setUpgradeDialogOpen(true)}>
                {membership.complimentaryAccess ? <Shield aria-hidden="true" size={16} /> : membership.premium ? <CreditCard aria-hidden="true" size={16} /> : <Crown aria-hidden="true" size={16} />}
                {membership.complimentaryAccess ? "全機能利用可" : membership.premium ? "契約管理" : "有料プラン"}
              </button>
            </>
          ) : (
            <>
              <button className="account-button upgrade" type="button" onClick={() => setUpgradeDialogOpen(true)}>
                <Crown aria-hidden="true" size={16} />
                有料プラン
              </button>
              <button className="account-button" type="button" onClick={() => openAuth("signin")}>
                <LogIn aria-hidden="true" size={16} />
                {authLoading ? "確認中" : "ログイン"}
              </button>
            </>
          )}
        </div>
        <button className="mobile-account-button" type="button" onClick={openAccount} aria-label={authUser ? "マイページ" : "ログイン"}>
          {authUser ? <UserAvatar user={authUser} size="small" /> : <LogIn aria-hidden="true" size={19} />}
        </button>
      </header>}

      <main className={mainShellClassName} id="top">
        {!hideControlPanel && <aside className="control-panel">
          <section className="control-group" aria-label="学習中のデッキ">
            <h2>デッキ</h2>
            <div className="pack-list">
              {activePackStats.filter((pack) => isVisiblePackEnabled(pack, enabledPackSet)).map((pack) => (
                <button
                  type="button"
                  key={pack.id}
                  className={settings.packId === pack.id ? "pack-toggle selected" : "pack-toggle"}
                  onClick={() => updateSettings({ packId: pack.id })}
                >
                  <PackIcon packId={pack.id} />
                  <span>
                    <strong>{pack.label}</strong>
                    <small>{pack.questionCount}問 / 正答率 {pack.rate}%</small>
                  </span>
                  <Check aria-hidden="true" size={16} />
                </button>
              ))}
            </div>
            <button className="secondary-button compact full-width" type="button" onClick={() => setActiveView("market")}>
              <Plus aria-hidden="true" size={16} />
              収録範囲を見る
            </button>
          </section>

          <section className="control-group" aria-label="出題順">
            <h2>出題順</h2>
            <div className="order-options" role="group" aria-label="出題順">
              {orderOptions.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={settings.order === item.id ? "order-selected" : ""}
                    onClick={() => updateSettings({ order: item.id })}
                  >
                    <Icon aria-hidden="true" size={18} />
                    <span>{item.title}</span>
                    <small>{item.description}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="control-group" aria-label="フィルタ">
            <h2>フィルタ</h2>
            <FilterButtonList
              label="デッキ"
              value={settings.packId}
              options={[
                { value: "all", label: "すべて", detail: "学習中のデッキ" },
                ...activePackStats
                  .filter((pack) => isVisiblePackEnabled(pack, enabledPackSet))
                  .map((pack) => ({ value: pack.id, label: pack.label, detail: `${pack.questionCount}問` })),
              ]}
              onChange={(packId) => updateSettings({ packId })}
            />
            <FilterButtonList
              label={bookkeepingPackIds.includes(settings.packId) ? "試験セット" : "試験回"}
              value={settings.examId}
              options={examOptions.map((exam) => ({
                value: exam.id,
                label: exam.id === "all" ? "すべて" : exam.title,
                detail: `${exam.count}問`,
              }))}
              onChange={(examId) => updateSettings({ examId })}
              scrollable
            />
            <FilterButtonList
              label={isOfficerPackSelection(settings.packId) ? "区分" : "科目"}
              value={settings.subject}
              options={availableSubjects.map((item) => ({ value: item, label: item }))}
              onChange={(subject) => updateSettings({ subject })}
            />
            <FilterButtonList
              label={settings.subject === "専門択一" ? "専門科目" : "論点"}
              value={settings.category}
              options={categoryOptions}
              onChange={(category) => updateSettings({ category })}
            />
          </section>

        </aside>}

        <section className="workbench">
          {announcements[0] && announcements[0].id !== dismissedAnnouncementId && activeView !== "admin" && (
            <aside className="site-announcement" aria-label="お知らせ">
              <Megaphone aria-hidden="true" size={18} />
              <div>
                <strong>{announcements[0].title}</strong>
                <span>{announcements[0].body}</span>
              </div>
              {announcements[0].link_url && <a href={announcements[0].link_url}>詳しく見る</a>}
              <button type="button" onClick={() => setDismissedAnnouncementId(announcements[0].id)} aria-label="お知らせを閉じる"><X aria-hidden="true" size={16} /></button>
            </aside>
          )}
          {checkoutNotice === "success" && (
            <div className="checkout-notice success" role="status">
              <Crown aria-hidden="true" size={19} />
              <span>お申し込みを確認しています。反映されない場合は数秒後に再読み込みしてください。</span>
              <button type="button" onClick={() => setCheckoutNotice(null)} aria-label="閉じる"><X size={16} /></button>
            </div>
          )}
          {checkoutNotice === "cancelled" && (
            <div className="checkout-notice" role="status">
              <span>お申し込みは確定していません。</span>
              <button type="button" onClick={() => setCheckoutNotice(null)} aria-label="閉じる"><X size={16} /></button>
            </div>
          )}
          {activeView === "landing" && (
            <TodayPage
              packs={activePackStats}
              plan={dailyPlan}
              newQuestionLimit={settings.dailyNewQuestionLimit}
              onChangeNewQuestionLimit={(dailyNewQuestionLimit) => updateSettings({ dailyNewQuestionLimit })}
              onStart={startTodayStudy}
              onMarket={() => setActiveView("market")}
              onHistory={() => openPremiumView("history")}
              lesson={recommendedLesson}
              lessonProgress={progress.lessonProgress?.[recommendedLesson.id]}
              onOpenLesson={() => openMaterialLesson(recommendedLesson.id)}
            />
          )}

          {activeView === "materials" && (
            <MaterialsOverview
              progress={progress.lessonProgress ?? {}}
              recommendedLesson={recommendedLesson}
              onOpenLesson={openMaterialLesson}
            />
          )}

          {activeView === "material" && activeMaterialLesson && (
            <MaterialReader
              lesson={activeMaterialLesson}
              progress={progress.lessonProgress?.[activeMaterialLesson.id]}
              selectedChoice={materialCheckpointChoice}
              result={materialCheckpointResult}
              onSelectChoice={(choice) => {
                setMaterialCheckpointChoice(choice);
                setMaterialCheckpointResult(null);
              }}
              onCheck={checkMaterialAnswer}
              onBack={openMaterials}
              onStartQuestions={() => startMaterialQuestions(activeMaterialLesson)}
            />
          )}

          {activeView === "account" && authUser && (
            <AccountView
              user={authUser}
              membership={membership}
              summary={summary}
              progress={progress}
              cloudSync={cloudSync}
              onOpenBilling={() => membership.complimentaryAccess ? undefined : membership.premium ? openBillingPortal() : setUpgradeDialogOpen(true)}
              onOpenStats={() => setActiveView("stats")}
              isAdmin={adminAccess === "granted"}
              onOpenAdmin={openAdmin}
              onReset={resetProgress}
              onSignOut={signOut}
            />
          )}

          {activeView === "admin" && (
            <AdminGate
              access={adminAccess}
              signedIn={Boolean(authUser)}
              onLogin={() => openAuth("signin")}
              onBack={() => setActiveView("landing")}
            />
          )}

          {activeView === "quiz" && (
            <QuizWorkspace
              quiz={quiz}
              question={currentQuestion}
              onAnswer={answerQuestion}
              onNext={nextQuestion}
              onPrevious={previousQuestion}
              onJump={jumpToQuestion}
              onSubmitMock={submitMockExam}
              onReviewMisses={() => requirePremium(() => startQuiz({ mode: "weak" }))}
              onOpenShortcutHelp={() => setShortcutHelpOpen(true)}
              onReportQuestion={authConfigReady ? openContactDialog : null}
              secondsRemaining={mockSecondsRemaining}
              onRateReview={rateDailyQuestion}
              onFinishDaily={() => setActiveView("landing")}
            />
          )}

          {activeView === "mock" && (
            <MockSetupView
              settings={settings}
              packs={availableMockPacks.filter((pack) => enabledPackSet.has(pack.id))}
              examOptions={examOptions}
              categoryOptions={categoryOptions}
              profile={getMockProfile(settings)}
              countdown={mockCountdown}
              onChange={updateSettings}
              onStart={startMockCountdown}
            />
          )}

          {activeView === "review" && (
            <ReviewView
              candidates={reviewCandidates}
              summary={summary}
              onStartReview={(items) =>
                startQuestionSet(
                  items.map((item) => item.question),
                  { mode: "weak", order: "ordered" },
                )
              }
              onPracticeQuestion={(question) => startQuestionSet([question], { mode: "weak" })}
            />
          )}

          {activeView === "history" && (
            <HistoryView
              entries={historyEntries}
              progress={progress}
              sessions={progress.sessions}
              onPracticeQuestion={(question) => startQuestionSet([question], { mode: "weak" })}
              onPracticeExam={(question) =>
                startQuiz({
                  packId: getQuestionPackFilterId(question),
                  examId: question.examId ?? "all",
                  subject: "すべて",
                  category: "すべて",
                  mode: "mock",
                })
              }
            />
          )}

          {activeView === "market" && (
            <DeckMarketplaceView
              packs={activePackStats}
              enabledPackSet={enabledPackSet}
              onToggleDeck={togglePack}
              onPracticeDeck={(packId) => startQuiz({ packId, examId: "all", subject: "すべて", category: "すべて", mode: "random" })}
            />
          )}

          {activeView === "stats" && (
            <StatsView
              summary={summary}
              packs={activePackStats}
              statsByBucket={statsByBucket}
              sessions={progress.sessions}
              questionCount={questionBank.length}
              onReset={resetProgress}
            />
          )}
        </section>

        {!hideInsightPanel && <aside className="insight-panel">
          <section>
            <h2>今日の状態</h2>
            <dl className="mini-stats">
              <div>
                <dt>演習回数</dt>
                <dd>{summary.total}</dd>
              </div>
              <div>
                <dt>正答率</dt>
                <dd>{summary.rate}%</dd>
              </div>
              <div>
                <dt>定着済み</dt>
                <dd>{summary.mastered}問</dd>
              </div>
            </dl>
          </section>
        </aside>}
      </main>
      {!isFocusMode && (
        <footer className="app-footer">
          <span>© 2026 Mememo</span>
          <span>各試験の実施団体とは関係のない学習支援サービスです。</span>
          <a href="/terms.html">利用規約</a>
          <a href="/privacy.html">プライバシーポリシー</a>
          <a href="/commercial-transactions.html">特定商取引法に基づく表記</a>
        </footer>
      )}
    </div>
  );
}

const lessonStatusLabels = {
  not_started: "未学習",
  in_progress: "学習中",
  understood: "理解済み",
  needs_review: "要復習",
  mastered: "定着",
};

function getLessonStatus(progress) {
  return progress?.status ?? "not_started";
}

function MaterialsOverview({ progress, recommendedLesson, onOpenLesson }) {
  const [courseId, setCourseId] = useState(recommendedLesson?.courseId ?? materialCourses[0].id);
  const lessons = getCourseLessons(courseId);
  const chapters = [...new Set(lessons.map((lesson) => lesson.chapter))];
  const completedCount = lessons.filter((lesson) => ["understood", "mastered"].includes(getLessonStatus(progress[lesson.id]))).length;
  const percentage = lessons.length > 0 ? Math.round((completedCount / lessons.length) * 100) : 0;
  const course = materialCourses.find((item) => item.id === courseId) ?? materialCourses[0];
  const courseRecommendation = lessons.find((lesson) => !["understood", "mastered"].includes(getLessonStatus(progress[lesson.id]))) ?? lessons[0];

  return (
    <div className="materials-page">
      <header className="materials-heading">
        <div>
          <span className="materials-eyebrow"><BookOpen aria-hidden="true" size={16} /> 理解してから解く</span>
          <h1>簿記の教材</h1>
          <p>1レッスン5〜10分。要点と例を読み、1問だけ確認してから関連問題へ進みます。</p>
        </div>
        <button className="materials-recommended-button" type="button" onClick={() => onOpenLesson(courseRecommendation.id)}>
          <span>次におすすめ</span>
          <strong>{courseRecommendation.title}</strong>
          <ChevronRight aria-hidden="true" size={20} />
        </button>
      </header>

      <div className="materials-course-tabs" role="tablist" aria-label="教材コース">
        {materialCourses.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={courseId === item.id}
            className={courseId === item.id ? "active" : ""}
            onClick={() => setCourseId(item.id)}
          >
            <strong>{item.title}</strong>
            <span>{item.subtitle}</span>
          </button>
        ))}
      </div>

      <div className="materials-layout">
        <main className="materials-curriculum">
          {chapters.map((chapter) => (
            <section className="materials-chapter" key={chapter}>
              <h2>{chapter}</h2>
              <div className="material-lesson-list">
                {lessons.filter((lesson) => lesson.chapter === chapter).map((lesson, index) => {
                  const status = getLessonStatus(progress[lesson.id]);
                  return (
                    <button className={`material-lesson-row status-${status}`} type="button" key={lesson.id} onClick={() => onOpenLesson(lesson.id)}>
                      <span className="material-lesson-index" aria-hidden="true">
                        {["understood", "mastered"].includes(status) ? <Check size={16} /> : index + 1}
                      </span>
                      <span className="material-lesson-copy">
                        <span className="material-lesson-meta">{lesson.id} · 約{lesson.estimatedMinutes}分</span>
                        <strong>{lesson.title}</strong>
                        <small>{lesson.summary}</small>
                      </span>
                      <span className={`material-status status-${status}`}>{lessonStatusLabels[status]}</span>
                      <ChevronRight className="material-row-chevron" aria-hidden="true" size={20} />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </main>

        <aside className="materials-progress-card">
          <span>{course.title}</span>
          <strong>{percentage}<small>%</small></strong>
          <div className="materials-progress-track" aria-label={`${percentage}% 完了`}><span style={{ width: `${percentage}%` }} /></div>
          <p>{completedCount} / {lessons.length} レッスン完了</p>
          <hr />
          <h2>学習の流れ</h2>
          <ol>
            <li><span>1</span>要点を読む</li>
            <li><span>2</span>例で確認する</li>
            <li><span>3</span>1問チェック</li>
            <li><span>4</span>関連問題を解く</li>
          </ol>
        </aside>
      </div>
    </div>
  );
}

function JournalEntry({ debit, credit }) {
  if (!debit?.length || !credit?.length) return null;
  return (
    <div className="journal-entry" aria-label="仕訳例">
      <div className="journal-side debit"><span>借方</span>{debit.map((item) => <div key={`${item.account}-${item.amount}`}><strong>{item.account}</strong><b>{item.amount}</b></div>)}</div>
      <div className="journal-side credit"><span>貸方</span>{credit.map((item) => <div key={`${item.account}-${item.amount}`}><strong>{item.account}</strong><b>{item.amount}</b></div>)}</div>
    </div>
  );
}

function MaterialSection({ section, number }) {
  return (
    <section className={`material-section type-${section.type}`} id={`material-section-${number}`}>
      <div className="material-section-number">{String(number).padStart(2, "0")}</div>
      <div className="material-section-body">
        <h2>{section.title}</h2>
        {section.body && <p>{section.body}</p>}
        {section.items && (
          section.type === "flow"
            ? <div className="material-flow">{section.items.map((item, index) => <div key={item}><span>{index + 1}</span><strong>{item}</strong>{index < section.items.length - 1 && <ChevronRight aria-hidden="true" size={18} />}</div>)}</div>
            : <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
        {section.scenario && <div className="material-scenario"><span>例題</span><p>{section.scenario}</p></div>}
        <JournalEntry debit={section.debit} credit={section.credit} />
        {section.explanation && <p className="material-explanation">{section.explanation}</p>}
      </div>
    </section>
  );
}

function MaterialReader({ lesson, progress, selectedChoice, result, onSelectChoice, onCheck, onBack, onStartQuestions }) {
  const completed = ["understood", "mastered"].includes(getLessonStatus(progress));
  return (
    <div className="material-reader-page">
      <button className="material-back-button" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" size={18} />教材一覧</button>
      <div className="material-reader-layout">
        <article className="material-reader">
          <header className="material-reader-header">
            <span>{lesson.chapter}</span>
            <div><small>{lesson.id}</small><small><Clock aria-hidden="true" size={14} />約{lesson.estimatedMinutes}分</small></div>
            <h1>{lesson.title}</h1>
            <p>{lesson.summary}</p>
          </header>

          <section className="material-objectives">
            <strong>このレッスンでできるようになること</strong>
            <ul>{lesson.objectives.map((objective) => <li key={objective}><Check aria-hidden="true" size={15} />{objective}</li>)}</ul>
          </section>

          {lesson.sections.map((section, index) => <MaterialSection key={`${lesson.id}-${section.title}`} section={section} number={index + 1} />)}

          <section className="material-checkpoint" aria-labelledby="checkpoint-title">
            <div className="checkpoint-label"><CheckCircle2 aria-hidden="true" size={18} />理解チェック</div>
            <h2 id="checkpoint-title">{lesson.checkpoint.prompt}</h2>
            <div className="checkpoint-choices">
              {lesson.checkpoint.choices.map((choice, index) => (
                <button
                  key={choice}
                  type="button"
                  className={selectedChoice === index ? "selected" : ""}
                  aria-pressed={selectedChoice === index}
                  onClick={() => onSelectChoice(index)}
                ><span>{index + 1}</span>{choice}</button>
              ))}
            </div>
            {!result && <button className="checkpoint-submit" type="button" disabled={!Number.isInteger(selectedChoice)} onClick={onCheck}>答えを確認する</button>}
            {result && (
              <div className={`checkpoint-feedback ${result}`} role="status">
                <strong>{result === "correct" ? "正解です。この内容は理解済みになりました。" : "もう一度、要点を見直してみましょう。"}</strong>
                <p>{lesson.checkpoint.explanation}</p>
                {result === "incorrect" && <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>上から読み直す</button>}
              </div>
            )}
          </section>

          {(result === "correct" || completed) && (
            <section className="material-next-step">
              <div><span>次のステップ</span><h2>関連する問題で定着させる</h2><p>この教材に対応した問題を5問だけ解きます。</p></div>
              <button type="button" onClick={onStartQuestions}>関連問題を解く<ChevronRight aria-hidden="true" size={19} /></button>
            </section>
          )}
        </article>

        <aside className="material-reader-nav">
          <span>このレッスン</span>
          <ol>{lesson.sections.map((section, index) => <li key={section.title}><a href={`#material-section-${index + 1}`}><span>{index + 1}</span>{section.title}</a></li>)}</ol>
          <a href="#checkpoint-title"><span>{lesson.sections.length + 1}</span>理解チェック</a>
          <div className={`material-status status-${getLessonStatus(progress)}`}>{lessonStatusLabels[getLessonStatus(progress)]}</div>
        </aside>
      </div>
    </div>
  );
}

function TodayPage({ packs, plan, newQuestionLimit, onChangeNewQuestionLimit, onStart, onMarket, onHistory, lesson, lessonProgress, onOpenLesson }) {
  const complete = plan.queue.length === 0;
  const packLabel = packs.filter((pack) => pack.questionCount > 0).slice(0, 2).map((pack) => pack.label).join("・");
  return (
    <div className="today-page">
      <section className={complete ? "today-mission complete" : "today-mission"} aria-label="今日の学習">
        <div className="today-mission-main">
          <h1>{complete ? "今日の学習は完了しました" : "今日やること"}</h1>
          <p>{complete ? "次の復習日まで、今日はここで終わりです。" : `この${plan.queue.length}問だけで、今日の学習は完了です。`}</p>
          {!complete && (
            <dl className="today-queue-summary">
              <div className="review"><dt>復習</dt><dd>{plan.reviewCount}<small>問</small></dd></div>
              <div className="new"><dt>新しい問題</dt><dd>{plan.newCount}<small>問</small></dd></div>
              <div className="time"><dt>目安</dt><dd>{plan.estimatedMinutes}<small>分</small></dd></div>
            </dl>
          )}
          {complete ? (
            <div className="today-done-mark"><Check aria-hidden="true" size={24} /><span>今日やることはありません</span></div>
          ) : (
            <button className="today-start-button" type="button" onClick={onStart}>
              <ListChecks aria-hidden="true" size={22} />
              今日の学習を始める
            </button>
          )}
          <label className="daily-new-limit-control">
            <span>1日の新規カード上限</span>
            <select
              value={normalizeDailyNewQuestionLimit(newQuestionLimit)}
              onChange={(event) => onChangeNewQuestionLimit(normalizeDailyNewQuestionLimit(event.target.value))}
              aria-label="1日の新規カード上限"
            >
              {dailyNewQuestionLimitOptions.map((value) => (
                <option key={value} value={value}>
                  {value === UNLIMITED_DAILY_NEW_QUESTIONS ? "無制限" : `${value}問`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <aside className="today-streak" aria-label="継続日数">
          <div className="today-streak-ring" style={{ "--streak-progress": `${Math.min(100, (plan.streak / 7) * 100)}%` }}>
            <span>今週</span>
            <strong>{plan.streak}</strong>
            <small>日継続</small>
          </div>
          <p>{plan.streak > 0 ? "今日も少しだけ続けましょう" : "今日から記録が始まります"}</p>
        </aside>
      </section>

      {lesson && (
        <section className="today-material-card" aria-label="今日の教材">
          <div className="today-material-icon"><BookOpen aria-hidden="true" size={24} /></div>
          <div>
            <span>今日の教材 · 約{lesson.estimatedMinutes}分</span>
            <h2>{lesson.title}</h2>
            <p>{lesson.summary}</p>
          </div>
          <span className={`material-status status-${getLessonStatus(lessonProgress)}`}>{lessonStatusLabels[getLessonStatus(lessonProgress)]}</span>
          <button type="button" onClick={onOpenLesson}>{getLessonStatus(lessonProgress) === "in_progress" ? "続きから" : "教材を始める"}<ChevronRight aria-hidden="true" size={18} /></button>
        </section>
      )}

      <section className="today-forecast" aria-label="これからの復習">
        <div className="today-forecast-heading">
          <div><Clock aria-hidden="true" size={20} /><h2>これからの復習</h2></div>
          <span>回答後に、次の復習日を決めます。</span>
        </div>
        <div className="today-forecast-days">
          {plan.forecast.map((item) => (
            <div key={item.day}>
              <span>{item.day === 1 ? "明日" : `${item.day}日後`}</span>
              <strong>{item.count}</strong>
              <small>問</small>
            </div>
          ))}
        </div>
      </section>

      <div className="today-secondary-actions">
        <span>学習対象: {packLabel || "選択中のセット"}</span>
        <div>
          <button type="button" onClick={onMarket}><Plus aria-hidden="true" size={16} />出題設定</button>
          <button type="button" onClick={onHistory}><History aria-hidden="true" size={16} />学習記録</button>
        </div>
      </div>
    </div>
  );
}

function LandingPage({ packs, enabledPackSet, summary, track, premium, onStart, onTrackChange, onMarket, onStats, onUpgrade }) {
  const isOfficerTrack = track === "officer";
  const trackPackIds = new Set(isOfficerTrack ? ["officer-candidate"] : bookkeepingPackIds);
  const featuredPacks = packs.filter((pack) => trackPackIds.has(pack.id));
  const trackQuestionCount = featuredPacks.reduce((total, pack) => total + pack.totalQuestions, 0);
  const trackCopy = isOfficerTrack
    ? {
        eyebrow: "防衛省・自衛隊 公開問題",
        title: "一般幹部候補生等採用試験を、本試験形式で演習",
        description: "防衛省・自衛隊の幹部を目指す方向けに、一般教養・専門択一の公開問題を試験回ごとに整理しています。",
        primaryLabel: "幹部候補生の演習を始める",
        sectionTitle: "一般幹部候補生等の問題セット",
        defaultPackId: "officer-candidate",
      }
    : {
        eyebrow: "日商簿記 2級・3級",
        title: "日商簿記2級・3級を、問題演習で身につける",
        description: "仕訳・帳簿・決算から商業簿記・工業簿記まで、2026年度の出題区分を参照したオリジナル問題で学べます。",
        primaryLabel: "簿記の演習を始める",
        sectionTitle: "簿記の問題セット",
        defaultPackId: "bookkeeping-2",
      };
  const totalAttempts = summary.total.toLocaleString("ja-JP");
  const totalQuestions = trackQuestionCount.toLocaleString("ja-JP");

  return (
    <div className="landing-page">
      <nav className="entry-track-switcher" aria-label="学習分野を選択">
        <span>学習したい分野</span>
        <div role="group" aria-label="学習分野">
          <a className={!isOfficerTrack ? "active" : ""} href="/" onClick={(event) => { event.preventDefault(); onTrackChange("bookkeeping"); }}>
            <Calculator aria-hidden="true" size={18} />
            簿記を学ぶ
          </a>
          <a className={isOfficerTrack ? "active" : ""} href="/officer" onClick={(event) => { event.preventDefault(); onTrackChange("officer"); }}>
            <Shield aria-hidden="true" size={18} />
            一般幹部候補生等を学ぶ
          </a>
        </div>
        <small>あとから両方を学習対象に追加できます</small>
      </nav>

      <section className={`landing-hero ${isOfficerTrack ? "officer-entry" : "bookkeeping-entry"}`} aria-label={`${trackCopy.eyebrow} 演習サイトの概要`}>
        <div className="landing-hero-copy">
          <span className="landing-eyebrow">{trackCopy.eyebrow}</span>
          <h1>{trackCopy.title}</h1>
          <p>{trackCopy.description}</p>
          <div className="landing-actions">
            <button className="primary-button" type="button" onClick={() => onStart(trackCopy.defaultPackId)}>
              <ListChecks aria-hidden="true" size={18} />
              {trackCopy.primaryLabel}
            </button>
            <button className="secondary-button" type="button" onClick={onMarket}>
              <Plus aria-hidden="true" size={18} />
              学習セットを管理
            </button>
            <button className="premium-button" type="button" onClick={premium ? onMock : onUpgrade}>
              {premium ? <TimerReset aria-hidden="true" size={18} /> : <Crown aria-hidden="true" size={18} />}
              {premium ? "模試を始める" : "全問題を解放する"}
            </button>
          </div>
          <dl className="landing-proof">
            <div>
              <dt>収録問題</dt>
              <dd>{totalQuestions}問</dd>
            </div>
            <div>
              <dt>演習回数</dt>
              <dd>{totalAttempts}回</dd>
            </div>
            <div>
              <dt>現在の正答率</dt>
              <dd>{summary.rate}%</dd>
            </div>
          </dl>
        </div>

        <div className="landing-product-preview" aria-label="演習画面プレビュー">
          <div className="preview-toolbar">
            <span>問42</span>
            <div className="preview-progress">
              <span style={{ width: "64%" }} />
            </div>
            <strong>64%</strong>
          </div>
          <div className="preview-question">
            <strong>問題文</strong>
            <p>問題文を読み、根拠を考えて最も適切な選択肢を選びます。</p>
          </div>
          <div className="preview-choices">
              {["1", "2", "3", "4", "5"].map((label, index) => (
              <div className={index === 1 ? "preview-choice selected" : "preview-choice"} key={label}>
                <span>{label}</span>
                <strong>{index === 1 ? "選択中の回答カード" : "回答選択肢カード"}</strong>
              </div>
            ))}
          </div>
          <div className="preview-footer">
            <div>
              <small>復習候補</small>
              <strong>{summary.mastered}問定着</strong>
            </div>
            <button className="secondary-button compact" type="button" onClick={onStats}>
              進捗を見る
            </button>
          </div>
        </div>
      </section>

      <section className="landing-feature-grid" aria-label="主な機能">
        <LandingFeature icon={FileText} title="出典と編集履歴" text="公式公開問題は出典画像、オリジナル問題は監査済みの解説を確認できます。" />
        <LandingFeature icon={Target} title="復習優先" text="ミスした問題を復習候補として整理し、解き直せます。" />
        <LandingFeature icon={TimerReset} title="模試モード" text="試験セットと科目を選び、制限時間付きで演習できます。" />
      </section>

      {!premium && (
        <section className="premium-callout" aria-label="Mememo 有料プラン">
          <div>
            <span className="premium-eyebrow"><Crown aria-hidden="true" size={16} /> Mememo Pro</span>
            <h2>選んだ問題セットを、最後まで使い切る</h2>
            <p>無料版は各デッキ12問を体験できます。Proでは全問題、復習、模試、履歴、進捗分析を利用でき、別分野を追加しても同じプランで学べます。</p>
          </div>
          <div className="premium-callout-price">
            <span>月額</span>
            <strong>¥480</strong>
            <small>または年額 ¥4,800</small>
            <button className="premium-button" type="button" onClick={onUpgrade}>プランを見る</button>
          </div>
        </section>
      )}

      <section className="landing-packs" aria-label="収録セット">
        <div className="landing-section-heading">
          <div>
            <span className="landing-section-kicker">現在の入口</span>
            <h2>{trackCopy.sectionTitle}</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={onMarket}>
            両方の学習セットを管理
          </button>
        </div>
        <div className="landing-pack-list">
          {featuredPacks.map((pack) => (
            <button
              className="landing-pack-row"
              type="button"
              key={pack.id}
              onClick={() => onStart(pack.id)}
              style={{ "--deck-accent": pack.accent }}
            >
              <span className="deck-symbol">
                <PackIcon packId={pack.id} />
              </span>
              <span>
                <strong>{pack.label}</strong>
                <small>{premium ? `${pack.questionCount}問` : `体験 ${pack.questionCount}問 / 全${pack.totalQuestions}問`} / 正答率 {pack.rate}%</small>
              </span>
              {isVisiblePackEnabled(pack, enabledPackSet)
                ? <Check aria-label="学習対象に追加済み" size={17} />
                : <Plus aria-label="演習開始時に学習対象へ追加" size={17} />}
            </button>
          ))}
        </div>
        <div className="cross-track-note">
          <span>{isOfficerTrack ? <Calculator aria-hidden="true" size={18} /> : <Shield aria-hidden="true" size={18} />}</span>
          <div>
            <strong>{isOfficerTrack ? "簿記も同じアカウントで学べます" : "一般幹部候補生等の公開問題も収録しています"}</strong>
            <small>学習セット管理で追加すると、両方を選んだ横断演習もできます。</small>
          </div>
          <button className="secondary-button compact" type="button" onClick={() => onTrackChange(isOfficerTrack ? "bookkeeping" : "officer")}>
            専用ページを見る
          </button>
        </div>
      </section>
    </div>
  );
}

function LandingFeature({ icon: Icon, title, text }) {
  return (
    <article className="landing-feature">
      <span>
        <Icon aria-hidden="true" size={22} />
      </span>
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </article>
  );
}

function UpgradeDialog({ user, membership, busy, error, onClose, onLogin, onCheckout, onPortal }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-panel upgrade-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <span className="premium-eyebrow"><Crown aria-hidden="true" size={16} /> Mememo Pro</span>
            <h2 id="upgrade-title">全問題と復習機能を解放</h2>
            <p>日商簿記2級・3級、幹部候補生等の全627問を、制限なく演習できます。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <ul className="premium-benefits">
          <li><Check aria-hidden="true" size={17} />全627問へアクセス</li>
          <li><Check aria-hidden="true" size={17} />ミス・定着度に基づく復習モード</li>
          <li><Check aria-hidden="true" size={17} />時間制限付き模試モード</li>
          <li><Check aria-hidden="true" size={17} />回答履歴と進捗分析</li>
        </ul>

        {membership.premium ? (
          <div className="current-plan-card">
            <strong>Proプランをご利用中です</strong>
            <span>{membership.plan === "year" ? "年額プラン" : membership.plan === "month" ? "月額プラン" : "有料プラン"}</span>
            {membership.currentPeriodEnd && (
              <small>{membership.cancelAtPeriodEnd ? "利用終了予定" : "次回更新"}：{new Date(membership.currentPeriodEnd).toLocaleDateString("ja-JP")}</small>
            )}
            <button className="secondary-button" type="button" onClick={onPortal} disabled={busy}>
              <CreditCard aria-hidden="true" size={17} />契約・支払方法を管理
            </button>
          </div>
        ) : (
          <div className="pricing-grid">
            <article className="pricing-card">
              <span>月額プラン</span>
              <strong>¥480<small> / 月</small></strong>
              <p>毎月自動更新。いつでも解約できます。</p>
              <button className="secondary-button" type="button" onClick={() => user ? onCheckout("month") : onLogin()} disabled={busy || !authConfigReady}>
                {user ? "月額プランを選ぶ" : "ログインして選ぶ"}
              </button>
            </article>
            <article className="pricing-card recommended">
              <span className="recommend-badge">2か月分お得</span>
              <span>年額プラン</span>
              <strong>¥4,800<small> / 年</small></strong>
              <p>毎年自動更新。月あたり400円相当。</p>
              <button className="premium-button" type="button" onClick={() => user ? onCheckout("year") : onLogin()} disabled={busy || !authConfigReady}>
                {user ? "年額プランを選ぶ" : "ログインして選ぶ"}
              </button>
            </article>
          </div>
        )}

        {!authConfigReady && <p className="form-status">現在、購入受付の公開準備中です。</p>}
        {error && <p className="form-status error">{error}</p>}
        <p className="billing-fine-print">
          選択後、Stripeの安全な決済画面で注文内容を最終確認します。解約後も支払済み期間の終了まで利用できます。
          お申し込み前に<a href="/terms.html">利用規約</a>と<a href="/commercial-transactions.html">特定商取引法に基づく表記</a>をご確認ください。
        </p>
      </section>
    </div>
  );
}

function PackIcon({ packId }) {
  const common = { "aria-hidden": "true", size: 19 };
  if (packId.startsWith("bookkeeping-")) return <Calculator {...common} />;
  if (packId === "itpass") return <PlugZap {...common} />;
  if (packId.startsWith("officer-")) return <Shield {...common} />;
  return <PlugZap {...common} />;
}

function FilterButtonList({ label, value, options, onChange, scrollable = false }) {
  return (
    <div className="filter-button-group">
      <span className="filter-button-label">{label}</span>
      <div className={scrollable ? "filter-button-list scrollable" : "filter-button-list"} role="listbox" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              type="button"
              key={option.value}
              className={selected ? "filter-chip selected" : "filter-chip"}
              onClick={() => onChange(option.value)}
              role="option"
              aria-selected={selected}
            >
              <span>{option.label}</span>
              {option.detail && <small>{option.detail}</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MockSetupView({ settings, packs, examOptions, categoryOptions, profile, countdown, onChange, onStart }) {
  const selectedExam = examOptions.find((exam) => exam.id === settings.examId);
  const requiresSpecializedSubject = settings.packId === "officer-senmon";
  const isBookkeepingPack = bookkeepingPackIds.includes(settings.packId);
  const selectedSpecializedSubject = categoryOptions.find((option) => option.value === settings.category);
  const ready = settings.examId !== "all" && selectedExam && (!requiresSpecializedSubject || settings.category !== "すべて");
  const questionCountLabel = requiresSpecializedSubject
    ? settings.category === "すべて"
      ? "専門科目選択後に確定"
      : selectedSpecializedSubject?.detail ?? "専門科目選択後に確定"
    : selectedExam && selectedExam.id !== "all"
      ? profile.questions
        ? `${profile.questions}問（収録${selectedExam.count}問から抽出）`
        : `${selectedExam.count}問`
      : "年度選択後に確定";
  const answerRuleLabel = settings.packId === "officer-kyouyou"
    ? "その1は英語必答を含め16問選択、その2は必答"
    : settings.packId === "officer-senmon"
      ? `${settings.category === "すべて" ? "専門科目" : settings.category}から20問選択`
      : isBookkeepingPack
        ? "四肢択一の基礎確認（本試験の大問形式とは異なります）"
        : "全問解答";
  const unavailableReason = !selectedExam || settings.examId === "all"
    ? "模試を開始するには試験セットを選択してください。"
    : requiresSpecializedSubject && (!selectedSpecializedSubject || settings.category === "すべて")
      ? "専門択一の模試を開始するには専門科目を選択してください。"
      : "";
  return (
    <section className="mock-setup-view">
      <div className="view-heading">
        <div>
          <h2>模試</h2>
          <p>試験セットを選んでから開始します。開始後は集中用レイアウトに切り替わります。</p>
        </div>
      </div>

      <div className="mock-setup-grid">
        <section className="table-panel mock-setup-panel">
          <h3>出題範囲</h3>
          <FilterButtonList
            label="デッキ"
            value={settings.packId}
            options={[
              ...packs.map((pack) => ({ value: pack.id, label: pack.label, detail: `${pack.questionCount}問` })),
            ]}
            onChange={(packId) => onChange({ packId, mode: "mock" })}
          />
          <FilterButtonList
            label="試験セット"
            value={settings.examId}
            options={examOptions
              .filter((exam) => exam.id !== "all")
              .map((exam) => ({
                value: exam.id,
                label: exam.title,
                detail: `${exam.count}問`,
              }))}
            onChange={(examId) => onChange({ examId, mode: "mock" })}
            scrollable
          />
          {requiresSpecializedSubject && (
            <FilterButtonList
              label="専門科目"
              value={settings.category}
              options={categoryOptions.filter((option) => option.value !== "すべて")}
              onChange={(category) => onChange({ category, mode: "mock" })}
            />
          )}
        </section>

        <section className="table-panel mock-setup-panel">
          <h3>形式</h3>
          <div className="mock-profile">
            <span>出題形式</span>
            <strong>{profile.label}</strong>
          </div>
          <dl className="mock-fixed-summary">
            <div>
              <dt>制限時間</dt>
              <dd>{profile.minutes}分</dd>
            </div>
            <div>
              <dt>出題デッキ</dt>
              <dd>{questionCountLabel}</dd>
            </div>
            <div>
              <dt>解答ルール</dt>
              <dd>{answerRuleLabel}</dd>
            </div>
          </dl>
          <button className="primary-button" type="button" onClick={onStart} disabled={!ready || countdown !== null}>
            <TimerReset aria-hidden="true" size={17} />
            模試を開始
          </button>
          {!ready && <p className="empty-text">{unavailableReason}</p>}
        </section>
      </div>

      {countdown !== null && (
        <div className="mock-countdown" role="status" aria-live="assertive">
          <span>{countdown || "開始"}</span>
        </div>
      )}
    </section>
  );
}

function QuizWorkspace({
  quiz,
  question,
  onAnswer,
  onNext,
  onPrevious,
  onJump,
  onSubmitMock,
  onReviewMisses,
  onOpenShortcutHelp,
  onReportQuestion,
  secondsRemaining,
  onRateReview,
  onFinishDaily,
}) {
  if (!question) {
    return (
      <section className="quiz-card empty-card" aria-label="出題なし">
        <div className="empty-icon">
          <ListChecks aria-hidden="true" size={28} />
        </div>
        <h2>この条件で出題できる問題がありません</h2>
        <p>デッキ、年度、分野の条件を変えてください。復習は演習履歴が必要です。</p>
      </section>
    );
  }

  if (quiz.status === "complete") {
    if (quiz.dailyMode) {
      return (
        <section className="today-session-complete" aria-label="今日の学習完了">
          <div className="today-complete-check"><Check aria-hidden="true" size={34} /></div>
          <h2>今日の学習は完了しました</h2>
          <p>{quiz.questions.length}問の復習予定を更新しました。今日はここまでで大丈夫です。</p>
          <button className="primary-button" type="button" onClick={onFinishDaily}>今日の画面へ戻る</button>
        </section>
      );
    }
    const requiredAnswerCount = quiz.examMode ? getMockRequiredAnswerCount(quiz.questions) : quiz.answers.length;
    const graded = quiz.answers.filter((answer) => answer.correct !== null);
    const correct = graded.filter((answer) => answer.correct).length;
    const ungraded = quiz.answers.length - graded.length;
    const unanswered = quiz.answers.filter((answer) => answer.unanswered).length;
    const answered = quiz.answers.length - unanswered;
    const scoreDenominator = quiz.examMode ? requiredAnswerCount : graded.length;
    const requiredUnanswered = quiz.examMode ? Math.max(0, requiredAnswerCount - answered) : unanswered;
    const rate = scoreDenominator > 0 ? Math.round((correct / scoreDenominator) * 100) : 0;
    const misses = quiz.answers.filter((answer) => answer.correct === false);
    const weakBuckets = misses.reduce((summary, answer) => {
      const key = `${getPack(answer.packId)?.label ?? answer.packId} ${answer.category}`;
      summary[key] = (summary[key] ?? 0) + 1;
      return summary;
    }, {});
    const answerByQuestionId = new Map(quiz.answers.map((answer) => [answer.questionId, answer]));

    return (
      <section className="mock-result-view" aria-label="結果">
        <section className="quiz-card result-card" aria-label="採点サマリー">
          <div className="result-ring" style={{ "--score-rate": `${rate}%` }}>
            <span>{scoreDenominator > 0 ? `${rate}%` : "記録"}</span>
            <small>{scoreDenominator > 0 ? `${correct}/${scoreDenominator}` : `${ungraded}問`}</small>
          </div>
          <div className="result-copy">
            <h2>{quiz.examMode ? "模試結果" : graded.length === 0 ? "選択を記録しました" : rate >= 80 ? "定着が進んでいます" : rate >= 60 ? "弱点を絞れています" : "復習対象を増やしましょう"}</h2>
            <p>{quiz.examMode ? `回答 ${answered}/${requiredAnswerCount}問。正答率は提出が必要な問題数を分母にしています。` : graded.length === 0 ? "この試験回は公式解答が未収録のため、正誤判定なしで演習回数だけ記録しました。" : "間違えた論点は復習に回せます。履歴から同じ試験回を再演習することもできます。"}</p>
            <div className="weak-tags">
              {Object.keys(weakBuckets).length === 0 ? <span>ミスなし</span> : Object.entries(weakBuckets).map(([key, count]) => <span key={key}>{key} {count}問</span>)}
            </div>
            <div className="result-actions">
              <button className="primary-button" type="button" onClick={onReviewMisses}>復習</button>
            </div>
          </div>
        </section>

        <section className="quiz-card mock-result-list" aria-label="問題別の採点結果">
          <div className="mock-result-heading">
            <div>
              <h3>問題別結果</h3>
              <p>提出時の選択肢、正解、正誤を一覧できます。</p>
            </div>
            <div className="mock-result-counts" aria-label="採点内訳">
              <span>正解 {correct}</span>
              <span>不正解 {misses.length}</span>
              <span>未回答 {requiredUnanswered}</span>
              {quiz.examMode && <span>必要 {requiredAnswerCount}</span>}
            </div>
          </div>

          <div className="mock-result-rows">
            {quiz.questions.map((resultQuestion, index) => {
              const answer = answerByQuestionId.get(resultQuestion.id);
              const selectedIndex = answer?.choiceIndex;
              const correctIndex = resultQuestion.answer;
              const selectedLabel = Number.isInteger(selectedIndex)
                ? resultQuestion.choiceLabels?.[selectedIndex] ?? String.fromCharCode(65 + selectedIndex)
                : "";
              const correctLabel = Number.isInteger(correctIndex)
                ? resultQuestion.choiceLabels?.[correctIndex] ?? String.fromCharCode(65 + correctIndex)
                : "";
              const selectedChoice = Number.isInteger(selectedIndex)
                ? resultQuestion.choices?.[selectedIndex]
                : "";
              const correctChoice = Number.isInteger(correctIndex)
                ? resultQuestion.choices?.[correctIndex]
                : "";
              const resultLabel = answer?.unanswered
                ? "未回答"
                : answer?.correct === null
                  ? "採点対象外"
                  : answer?.correct
                    ? "正解"
                    : "不正解";
              const promptPreview = getHistoryQuestionPreview(resultQuestion);
              const rowClassName = [
                "mock-result-row",
                answer?.correct === false ? "missed" : "",
                answer?.unanswered ? "unanswered" : "",
                answer?.correct === null && !answer?.unanswered ? "ungraded" : "",
              ].filter(Boolean).join(" ");

              return (
                <article className={rowClassName} key={resultQuestion.id}>
                  <div className="mock-result-status">
                    <span>{resultLabel}</span>
                    <small>問{resultQuestion.questionNumber ?? index + 1}</small>
                  </div>
                  <div className="mock-result-question">
                    <div className="question-tags">
                      <span>{resultQuestion.packLabel}</span>
                      {resultQuestion.examTitle && <span>{resultQuestion.examTitle}</span>}
                      <span>{resultQuestion.category}</span>
                    </div>
                    <h3>{resultQuestion.prompt}</h3>
                    {promptPreview && <p className="history-question-preview">{promptPreview}</p>}
                    <div className="history-answer-grid">
                      <div className={answer?.correct === false ? "history-answer selected wrong" : "history-answer selected"}>
                        <span>あなたの選択 {selectedLabel || "-"}</span>
                        <strong>{selectedChoice ? <FormattedInline text={selectedChoice} /> : answer?.unanswered ? "未回答" : "未記録"}</strong>
                      </div>
                      <div className="history-answer correct">
                        <span>正解 {correctLabel || "-"}</span>
                        <strong>{correctChoice ? <FormattedInline text={correctChoice} /> : "未収録"}</strong>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    );
  }

  const reveal = quiz.status === "correct" || quiz.status === "incorrect" || quiz.status === "ungraded";
  const hasAnswer = Number.isInteger(question.answer);
  const unavailable = isQuestionUnavailable(question);
  const sourceImages = unavailable ? [] : question.images?.length ? question.images : question.image ? [question.image] : [];
  const quizHeader = getQuizHeader(question);
  const answeredCount = Object.keys(quiz.selections ?? {}).length;
  const usesOfficerNavigator = quiz.questions.some(isOfficerQuestion) && (quiz.examMode || quiz.guidedPractice);
  const requiredAnswerCount = usesOfficerNavigator ? getMockRequiredAnswerCount(quiz.questions) : quiz.questions.length;
  const selectionGroup = usesOfficerNavigator ? getOfficerSelectionState(quiz.questions, quiz.selections, question) : null;
  const selectionLimitReached = quiz.examMode && isAnswerableMockQuestion(question) && !canSelectMockChoice(quiz, question);
  const mockTimeLabel = secondsRemaining === null ? "" : formatDuration(secondsRemaining);
  const mockNearlyDone = secondsRemaining !== null && secondsRemaining <= 300;
  const showOfficerNavigator = usesOfficerNavigator;

  const questionBody = (
    <>
      <div className="quiz-topline">
        <h2>{quizHeader.title}</h2>
        <div className="question-meta" aria-label="問題情報">
          {quizHeader.meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>

      <QuestionText question={question} />

      {unavailable ? (
        <div className="unavailable-question-note" role="note">
          <strong>回答対象外</strong>
          <span>著作権の関係により、この問題の本文・選択肢・公式画像は表示できません。</span>
        </div>
      ) : (
        <div className="choices" role="list">
          {question.choices.map((choice, index) => {
          const isCorrect = hasAnswer && index === question.answer;
          const isSelected = quiz.selectedChoice === index;
          const className = [
            "choice-button",
            (quiz.examMode || quiz.guidedPractice) && isSelected ? "choice-selected" : "",
            reveal && isCorrect ? "choice-correct" : "",
            reveal && isSelected && !isCorrect && hasAnswer ? "choice-wrong" : "",
            reveal && isSelected && !hasAnswer ? "choice-selected" : "",
          ].filter(Boolean).join(" ");

          return (
            <button
              className={className}
              type="button"
              key={`${question.id}-${index}`}
              disabled={selectionLimitReached || (!quiz.examMode && quiz.status !== "answering")}
              onClick={() => onAnswer(index)}
              role="listitem"
            >
              <span className="choice-index">{question.choiceLabels?.[index] ?? String.fromCharCode(65 + index)}</span>
              <span>
                <FormattedInline text={choice} />
              </span>
              {reveal && isCorrect && <Check aria-hidden="true" size={17} />}
              {reveal && isSelected && !isCorrect && hasAnswer && <X aria-hidden="true" size={17} />}
            </button>
          );
          })}
        </div>
      )}

      {selectionLimitReached && (
        <p className="mock-selection-limit">
          {selectionGroup?.title ?? "この区分"}は指定数の{selectionGroup?.rule?.target ?? 0}問に達しています。回答を変更する場合は、回答済みの問題に戻って選択肢を選び直してください。
        </p>
      )}

      {sourceImages.length > 0 && (
        <details className="source-image-panel">
          <summary>公式PDF画像を確認</summary>
          {sourceImages.map((image, index) => (
            <figure className="question-image-frame" key={image}>
              <img src={image} alt={`${question.source ?? question.prompt}の公式問題ページ${index + 1}`} />
              <figcaption>{question.copyright}{sourceImages.length > 1 ? ` / ${index + 1}ページ目` : ""}</figcaption>
            </figure>
          ))}
        </details>
      )}

      {reveal && (
        <div className={`feedback ${quiz.status}`}>
          <div>
            <strong>{quiz.status === "correct" ? "正解です" : quiz.status === "ungraded" ? "選択を記録しました" : "惜しいです"}</strong>
            <ExplanationText text={question.explanation} />
          </div>
        </div>
      )}

      {quiz.dailyMode && reveal ? (
        <section className="review-rating-panel" aria-label="次の復習日を選択">
          <div className="review-rating-heading">
            <strong>この問題の手応えは？</strong>
            <span>選ぶと次のカードへ進みます</span>
          </div>
          <div className="review-rating-options">
            {reviewRatingOptions.map((option) => (
              <button className={`review-rating ${option.id}`} type="button" key={option.id} onClick={() => onRateReview(option.id)}>
                <strong>{option.label}</strong>
                <span>{option.intervalLabel}</span>
              </button>
            ))}
          </div>
          {onReportQuestion && (
            <button className="daily-report-button" type="button" onClick={() => onReportQuestion(question)}>
              <MessageSquare aria-hidden="true" size={14} />問題を報告
            </button>
          )}
        </section>
      ) : !quiz.dailyMode ? (
        <div className="quiz-actions">
          <span className="quiz-position">{quiz.index + 1}/{quiz.questions.length}</span>
          <div className="question-nav-actions">
            {onReportQuestion && (
              <button className="shortcut-help-hint report-question-button" type="button" onClick={() => onReportQuestion(question)}>
                <MessageSquare aria-hidden="true" size={15} />
                この問題を報告
              </button>
            )}
            <button className="shortcut-help-hint" type="button" onClick={() => onOpenShortcutHelp()}>
              <kbd>/</kbd>
              ショートカット
            </button>
            <button className="secondary-button compact" type="button" onClick={onPrevious} disabled={quiz.index === 0}>
              前へ <kbd>P</kbd>
            </button>
            <button className="primary-button compact" type="button" onClick={onNext} disabled={(quiz.examMode || quiz.guidedPractice) && quiz.index === quiz.questions.length - 1}>
              次へ <kbd>N</kbd>
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <section className={quiz.dailyMode ? "quiz-card daily-quiz-card" : "quiz-card"} aria-label="クイズ">
      {quiz.dailyMode && (
        <div className="daily-study-status">
          <span>今日の学習</span>
          <strong>{quiz.index + 1} / {quiz.questions.length}</strong>
          <div className="progress-track slim"><span style={{ width: `${((quiz.index + 1) / quiz.questions.length) * 100}%` }} /></div>
          <button type="button" onClick={onFinishDaily}>中断</button>
        </div>
      )}
      {quiz.examMode && (
        <div className="mock-status-bar">
          <div className={mockNearlyDone ? "mock-timer urgent" : "mock-timer"}>
            <Clock aria-hidden="true" size={18} />
            <strong>{mockTimeLabel}</strong>
          </div>
          <div className="mock-progress">
            <span>回答 {answeredCount}/{requiredAnswerCount}</span>
            <div className="progress-track slim">
              <span style={{ width: `${requiredAnswerCount > 0 ? Math.min(100, (answeredCount / requiredAnswerCount) * 100) : 0}%` }} />
            </div>
          </div>
          <button className="primary-button compact" type="button" onClick={() => onSubmitMock("manual")}>
            <Flag aria-hidden="true" size={16} />
            提出
          </button>
        </div>
      )}

      {quiz.guidedPractice && (
        <div className="mock-status-bar practice-status-bar">
          <div className="mock-timer practice-mode-label">
            <ListChecks aria-hidden="true" size={18} />
            <strong>演習</strong>
          </div>
          <div className="mock-progress">
            <span>回答 {answeredCount}/{requiredAnswerCount}</span>
            <div className="progress-track slim">
              <span style={{ width: `${requiredAnswerCount > 0 ? Math.min(100, (answeredCount / requiredAnswerCount) * 100) : 0}%` }} />
            </div>
          </div>
        </div>
      )}

      {showOfficerNavigator ? (
        <div className="officer-quiz-layout">
          <div className="officer-quiz-main">
            {questionBody}
          </div>
          <OfficerQuestionNavigator
            quiz={quiz}
            onJump={onJump}
            mode={quiz.examMode ? "mock" : "practice"}
          />
        </div>
      ) : questionBody}

      {quiz.examMode && !showOfficerNavigator && (
        <div className="question-palette" aria-label="問題選択">
          {quiz.questions.map((item, index) => {
            const selected = index === quiz.index;
            const answered = Number.isInteger(quiz.selections?.[item.id]);
            return (
              <button
                className={[
                  "palette-button",
                  selected ? "current" : "",
                  answered ? "answered" : "",
                ].filter(Boolean).join(" ")}
                type="button"
                key={item.id}
                onClick={() => onJump(index)}
              >
                {getQuestionNavLabel(item, index)}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

const adminMetricDefinitions = [
  { key: "users", label: "登録ユーザー", help: "Supabase Auth", icon: Users },
  { key: "activeSubscriptions", label: "有料会員", help: "active / trialing", icon: Crown },
  { key: "learningProfiles", label: "同期ユーザー", help: "学習履歴あり", icon: Database },
  { key: "activeToday", label: "今日の利用", help: "同期更新ベース", icon: BarChart3 },
  { key: "openSupport", label: "未完了の問い合わせ", help: "要確認・対応中", icon: MessageSquare },
  { key: "activeAnnouncements", label: "公開中のお知らせ", help: "サイト内表示", icon: Megaphone },
];

function formatAdminDate(value, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", withTime
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function AdminGate({ access, signedIn, onLogin, onBack }) {
  if (["idle", "checking"].includes(access)) {
    return <section className="admin-gate"><RefreshCw className="spin" aria-hidden="true" size={24} /><strong>管理者権限を確認中</strong></section>;
  }
  if (access !== "granted") {
    return (
      <section className="admin-gate denied">
        <Shield aria-hidden="true" size={34} />
        <span>ADMIN ONLY</span>
        <h1>{signedIn ? "このページにはアクセスできません" : "管理者ログインが必要です"}</h1>
        <p>{signedIn ? "ログイン中のアカウントには管理者権限がありません。" : "管理者として登録されたアカウントでログインしてください。"}</p>
        <div>{!signedIn && <button className="primary-button" type="button" onClick={onLogin}><LogIn aria-hidden="true" size={17} />ログイン</button>}<button className="secondary-button" type="button" onClick={onBack}>ホームへ戻る</button></div>
      </section>
    );
  }
  return <AdminDashboard />;
}

function AdminDashboard() {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setData(await loadAdminDashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "管理データを取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function changeSupportStatus(id, status) {
    setBusyId(id);
    setNotice("");
    try {
      await updateSupportStatus(id, status);
      setData((current) => {
        const previous = current.contacts.find((item) => item.id === id)?.status;
        const delta = (status !== "closed" ? 1 : 0) - (previous !== "closed" ? 1 : 0);
        return {
          ...current,
          contacts: current.contacts.map((item) => item.id === id ? { ...item, status } : item),
          metrics: { ...current.metrics, openSupport: Math.max(0, current.metrics.openSupport + delta) },
        };
      });
      setNotice("問い合わせ状態を更新しました。");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "問い合わせを更新できませんでした。");
    } finally {
      setBusyId("");
    }
  }

  async function publishAnnouncement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const values = {
      title: formData.get("title"),
      body: formData.get("body"),
      linkUrl: formData.get("linkUrl"),
    };
    if (!window.confirm(`「${values.title}」をサイトのお知らせとして公開します。よろしいですか？`)) return;
    setBusyId("announcement-new");
    setNotice("");
    try {
      await createAnnouncement(values);
      form.reset();
      setNotice("お知らせを公開しました。");
      await refresh();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "お知らせを公開できませんでした。");
    } finally {
      setBusyId("");
    }
  }

  async function toggleAnnouncement(item) {
    const action = item.is_active ? "非公開" : "再公開";
    if (!window.confirm(`「${item.title}」を${action}にします。よろしいですか？`)) return;
    setBusyId(item.id);
    setNotice("");
    try {
      await updateAnnouncement(item.id, { isActive: !item.is_active });
      setData((current) => ({
        ...current,
        announcements: current.announcements.map((announcement) => announcement.id === item.id ? { ...announcement, is_active: !item.is_active } : announcement),
        metrics: {
          ...current.metrics,
          activeAnnouncements: Math.max(0, current.metrics.activeAnnouncements + (item.is_active ? -1 : 1)),
        },
      }));
      setNotice(`お知らせを${action}にしました。`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "お知らせを更新できませんでした。");
    } finally {
      setBusyId("");
    }
  }

  if (loading && !data) {
    return <section className="admin-gate"><RefreshCw className="spin" aria-hidden="true" size={24} /><strong>管理データを読み込み中</strong></section>;
  }
  if (!data) {
    return <section className="admin-gate denied"><AlertCircle aria-hidden="true" size={32} /><h1>管理画面を読み込めませんでした</h1><p>{error}</p><button className="secondary-button" type="button" onClick={refresh}>再読み込み</button></section>;
  }

  const userById = new Map(data.users.map((item) => [item.id, item]));
  const tabDefinitions = [
    { id: "overview", label: "概要", icon: LayoutDashboard },
    { id: "users", label: "ユーザー", icon: Users },
    { id: "support", label: `問い合わせ ${data.metrics.openSupport}`, icon: MessageSquare },
    { id: "announcements", label: "お知らせ", icon: Megaphone },
  ];

  return (
    <section className="admin-page" aria-labelledby="admin-title">
      <header className="admin-page-header">
        <div><span>MEMEMO OPERATIONS</span><h1 id="admin-title">管理ダッシュボード</h1><p>ユーザー、学習状況、契約、問い合わせ、お知らせを一か所で確認できます。</p></div>
        <div className="admin-header-actions"><small>{data.admin.email}<br />更新 {formatAdminDate(data.generatedAt)}</small><button className="secondary-button compact" type="button" onClick={refresh} disabled={loading}><RefreshCw className={loading ? "spin" : ""} aria-hidden="true" size={15} />更新</button></div>
      </header>

      <nav className="admin-tabs" aria-label="管理メニュー">
        {tabDefinitions.map((tab) => {
          const Icon = tab.icon;
          return <button className={activeTab === tab.id ? "active" : ""} type="button" key={tab.id} onClick={() => setActiveTab(tab.id)}><Icon aria-hidden="true" size={16} />{tab.label}</button>;
        })}
      </nav>

      {notice && <p className="admin-notice success">{notice}</p>}
      {error && <p className="admin-notice error">{error}<button type="button" onClick={() => setError("")}><X aria-hidden="true" size={14} /></button></p>}

      {activeTab === "overview" && (
        <>
          <div className="admin-metric-grid">
            {adminMetricDefinitions.map((metric) => {
              const Icon = metric.icon;
              return <article key={metric.key}><span><Icon aria-hidden="true" size={17} /></span><small>{metric.label}</small><strong>{Number(data.metrics[metric.key] ?? 0).toLocaleString("ja-JP")}</strong><p>{metric.help}</p></article>;
            })}
          </div>
          <div className="admin-overview-grid">
            <article className="admin-panel">
              <div className="admin-panel-heading"><div><h2>最近のユーザー</h2><p>新しい登録とログイン状況</p></div><button type="button" onClick={() => setActiveTab("users")}>すべて見る</button></div>
              <div className="admin-compact-list">{data.users.slice(0, 6).map((user) => <div key={user.id}><span className="admin-user-initial">{(user.displayName || user.email || "U").slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName || "名称未設定"}</strong><small>{user.email}</small></div><time>{formatAdminDate(user.createdAt)}</time></div>)}</div>
            </article>
            <article className="admin-panel">
              <div className="admin-panel-heading"><div><h2>要対応</h2><p>未完了の問い合わせ</p></div><button type="button" onClick={() => setActiveTab("support")}>すべて見る</button></div>
              <div className="admin-compact-list contacts">{data.contacts.filter((item) => item.status !== "closed").slice(0, 6).map((item) => <div key={item.id}><span className={`admin-status-dot ${item.status}`} /><div><strong>{item.subject}</strong><small>{item.contact_email || "連絡先なし"}</small></div><time>{formatAdminDate(item.created_at)}</time></div>)}{data.contacts.filter((item) => item.status !== "closed").length === 0 && <p className="admin-empty">未対応の問い合わせはありません。</p>}</div>
            </article>
            <article className="admin-panel wide">
              <div className="admin-panel-heading"><div><h2>最近の契約</h2><p>有料プランの状態</p></div></div>
              <AdminSubscriptionsTable subscriptions={data.subscriptions.slice(0, 8)} userById={userById} />
            </article>
          </div>
        </>
      )}

      {activeTab === "users" && <AdminUsersPanel users={data.users} learningStates={data.learningStates} subscriptions={data.subscriptions} />}
      {activeTab === "support" && <AdminSupportPanel contacts={data.contacts} busyId={busyId} onChangeStatus={changeSupportStatus} />}
      {activeTab === "announcements" && <AdminAnnouncementsPanel items={data.announcements} busyId={busyId} onPublish={publishAnnouncement} onToggle={toggleAnnouncement} />}
    </section>
  );
}

function AdminSubscriptionsTable({ subscriptions, userById }) {
  if (subscriptions.length === 0) return <p className="admin-empty">契約データはありません。</p>;
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>ユーザー</th><th>状態</th><th>更新</th><th>次回期間</th></tr></thead><tbody>{subscriptions.map((item) => { const user = userById.get(item.user_id); return <tr key={item.user_id}><td><strong>{user?.displayName || user?.email || item.user_id.slice(0, 8)}</strong><small>{user?.email || item.user_id}</small></td><td><span className={`admin-tag ${item.status}`}>{item.status}</span></td><td>{formatAdminDate(item.updated_at)}</td><td>{formatAdminDate(item.current_period_end, false)}{item.cancel_at_period_end && <small>期間末に終了</small>}</td></tr>; })}</tbody></table></div>;
}

function AdminUsersPanel({ users, learningStates, subscriptions }) {
  const learningByUser = new Map(learningStates.map((item) => [item.user_id, item]));
  const subscriptionByUser = new Map(subscriptions.map((item) => [item.user_id, item]));
  return (
    <article className="admin-panel full">
      <div className="admin-panel-heading"><div><h2>ユーザー</h2><p>最新{users.length}件。認証情報・学習同期・契約状態を横断表示します。</p></div></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>ユーザー</th><th>メール確認</th><th>学習同期</th><th>プラン</th><th>登録</th><th>最終ログイン</th></tr></thead><tbody>{users.map((user) => { const learning = learningByUser.get(user.id); const subscription = subscriptionByUser.get(user.id); return <tr key={user.id}><td><strong>{user.displayName || "名称未設定"}</strong><small>{user.email}</small></td><td><span className={`admin-tag ${user.emailConfirmed ? "active" : "pending"}`}>{user.emailConfirmed ? "確認済み" : "未確認"}</span></td><td>{learning ? formatAdminDate(learning.updated_at) : "未同期"}</td><td><span className={`admin-tag ${subscription?.status ?? "free"}`}>{subscription?.status ?? "free"}</span></td><td>{formatAdminDate(user.createdAt)}</td><td>{formatAdminDate(user.lastSignInAt)}</td></tr>; })}</tbody></table></div>
    </article>
  );
}

function AdminSupportPanel({ contacts, busyId, onChangeStatus }) {
  return (
    <article className="admin-panel full">
      <div className="admin-panel-heading"><div><h2>問い合わせ</h2><p>問い合わせと問題報告を受信順に管理します。</p></div></div>
      <div className="admin-contact-list">{contacts.map((item) => <section key={item.id}><header><div><span className={`admin-tag ${item.status}`}>{item.status === "open" ? "未対応" : item.status === "reviewing" ? "対応中" : "完了"}</span><strong>{item.subject}</strong></div><time>{formatAdminDate(item.created_at)}</time></header><p>{item.message}</p><footer><span>{item.contact_email || "連絡先なし"}{item.question_id ? ` · 問題 ${item.question_id}` : ""}</span><select aria-label={`${item.subject}の対応状態`} value={item.status} disabled={busyId === item.id} onChange={(event) => onChangeStatus(item.id, event.target.value)}><option value="open">未対応</option><option value="reviewing">対応中</option><option value="closed">完了</option></select></footer></section>)}{contacts.length === 0 && <p className="admin-empty">問い合わせはありません。</p>}</div>
    </article>
  );
}

function AdminAnnouncementsPanel({ items, busyId, onPublish, onToggle }) {
  return (
    <div className="admin-announcement-grid">
      <form className="admin-panel admin-announcement-form" onSubmit={onPublish}>
        <div className="admin-panel-heading"><div><h2>新しいお知らせ</h2><p>公開後、今日の学習画面に表示されます。</p></div></div>
        <label>タイトル<input name="title" required maxLength={120} placeholder="教材追加のお知らせ" /></label>
        <label>本文<textarea name="body" required maxLength={2000} rows={6} placeholder="ユーザーに伝える内容を入力" /></label>
        <label>詳細リンク（任意）<input name="linkUrl" placeholder="/ または https://..." /></label>
        <button className="primary-button" type="submit" disabled={busyId === "announcement-new"}><Megaphone aria-hidden="true" size={16} />{busyId === "announcement-new" ? "公開中" : "サイトに公開"}</button>
      </form>
      <article className="admin-panel announcement-history">
        <div className="admin-panel-heading"><div><h2>公開履歴</h2><p>最新{items.length}件</p></div></div>
        <div>{items.map((item) => <section key={item.id}><header><span className={`admin-tag ${item.is_active ? "active" : "closed"}`}>{item.is_active ? "公開中" : "非公開"}</span><time>{formatAdminDate(item.published_at)}</time></header><strong>{item.title}</strong><p>{item.body}</p>{item.link_url && <small>{item.link_url}</small>}<button className="secondary-button compact" type="button" disabled={busyId === item.id} onClick={() => onToggle(item)}>{item.is_active ? "非公開にする" : "再公開する"}</button></section>)}{items.length === 0 && <p className="admin-empty">お知らせはありません。</p>}</div>
      </article>
    </div>
  );
}

function UserAvatar({ user, size = "large" }) {
  const avatarUrl = getUserAvatarUrl(user);
  const label = getUserDisplayName(user) || user?.email || "ユーザー";
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUrl]);

  if (avatarUrl && !avatarFailed) {
    return <img className={`user-avatar ${size}`} src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} />;
  }
  return <span className={`user-avatar fallback ${size}`} aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>;
}

function calculateStudyStreak(progress) {
  const studyDates = new Set((progress.history ?? [])
    .map((item) => String(item.answeredAt ?? item.date ?? "").slice(0, 10))
    .filter(Boolean));
  let cursor = new Date();
  const today = cursor.toISOString().slice(0, 10);
  if (!studyDates.has(today)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (studyDates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function formatAccountDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function AccountView({ user, membership, summary, progress, cloudSync, onOpenBilling, onOpenStats, isAdmin, onOpenAdmin, onReset, onSignOut }) {
  const [displayName, setDisplayName] = useState(getUserDisplayName(user));
  const [profileStatus, setProfileStatus] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const providers = getLinkedProviders(user);
  const completedLessons = Object.values(progress.lessonProgress ?? {})
    .filter((item) => ["understood", "mastered"].includes(item?.status)).length;
  const streak = calculateStudyStreak(progress);
  const syncLabel = cloudSync.status === "saving"
    ? "保存中"
    : cloudSync.status === "loading"
      ? "読み込み中"
      : cloudSync.status === "error"
        ? "同期エラー"
        : "同期済み";

  useEffect(() => {
    setDisplayName(getUserDisplayName(user));
  }, [user]);

  async function updateProfile(event) {
    event.preventDefault();
    if (!supabase) return;
    setProfileBusy(true);
    setProfileStatus("");
    setProfileError("");
    const { error } = await supabase.auth.updateUser({
      data: { ...(user.user_metadata ?? {}), display_name: displayName.trim() },
    });
    setProfileBusy(false);
    if (error) {
      setProfileError("プロフィールを更新できませんでした。時間を置いて再度お試しください。");
      return;
    }
    setProfileStatus("プロフィールを更新しました。");
  }

  async function sendVerificationEmail() {
    if (!supabase || !user.email) return;
    setMailBusy(true);
    setProfileStatus("");
    setProfileError("");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: user.email,
      options: { emailRedirectTo: getAuthRedirectUrl() },
    });
    setMailBusy(false);
    if (error) setProfileError("確認メールを送信できませんでした。");
    else setProfileStatus("確認メールを再送しました。");
  }

  async function sendPasswordReset() {
    if (!supabase || !user.email) return;
    setMailBusy(true);
    setProfileStatus("");
    setProfileError("");
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: getAuthRedirectUrl(),
    });
    setMailBusy(false);
    if (error) setProfileError("パスワード再設定メールを送信できませんでした。");
    else setProfileStatus("パスワード再設定メールを送信しました。");
  }

  return (
    <section className="account-page" aria-labelledby="account-page-title">
      <header className="account-hero">
        <UserAvatar user={user} />
        <div>
          <span>MY PAGE</span>
          <h1 id="account-page-title">{getUserDisplayName(user) || "マイページ"}</h1>
          <p>{user.email}</p>
        </div>
        <span className={membership.premium ? "plan-badge premium" : "plan-badge"}>
          {membership.premium ? <Crown aria-hidden="true" size={15} /> : <Sparkles aria-hidden="true" size={15} />}
          {membership.complimentaryAccess ? "全機能アクセス" : membership.premium ? "Mememo Pro" : "無料プラン"}
        </span>
      </header>

      <div className="account-stat-grid">
        <article><strong>{summary.total}</strong><span>回答数</span></article>
        <article><strong>{summary.rate}%</strong><span>正答率</span></article>
        <article><strong>{summary.mastered}</strong><span>定着した問題</span></article>
        <article><strong>{completedLessons}</strong><span>完了教材</span></article>
        <article><strong>{streak}日</strong><span>連続学習</span></article>
      </div>

      <div className="account-grid">
        <article className="account-card profile-card">
          <div className="account-card-heading">
            <div><User aria-hidden="true" size={19} /><h2>プロフィール</h2></div>
            <span>登録日 {formatAccountDate(user.created_at)}</span>
          </div>
          <form className="profile-form" onSubmit={updateProfile}>
            <label>
              表示名
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} placeholder="表示名を入力" />
            </label>
            <button className="primary-button compact" type="submit" disabled={profileBusy || !displayName.trim()}>
              {profileBusy ? "保存中" : "変更を保存"}
            </button>
          </form>
          {profileStatus && <p className="form-status success">{profileStatus}</p>}
          {profileError && <p className="form-status error">{profileError}</p>}
        </article>

        <article className="account-card">
          <div className="account-card-heading"><div><Shield aria-hidden="true" size={19} /><h2>ログインと安全性</h2></div></div>
          <dl className="account-detail-list">
            <div><dt>メール</dt><dd>{user.email}</dd></div>
            <div><dt>メール確認</dt><dd className={user.email_confirmed_at ? "verified" : "unverified"}>{user.email_confirmed_at ? "確認済み" : "未確認"}</dd></div>
            <div><dt>ログイン方法</dt><dd>{providers.length > 0 ? providers.map((item) => item === "email" ? "メール" : item[0].toUpperCase() + item.slice(1)).join("・") : "メール"}</dd></div>
            <div><dt>最終ログイン</dt><dd>{formatAccountDate(user.last_sign_in_at)}</dd></div>
          </dl>
          <div className="account-button-row">
            {!user.email_confirmed_at && <button className="secondary-button compact" type="button" onClick={sendVerificationEmail} disabled={mailBusy}>確認メールを再送</button>}
            <button className="secondary-button compact" type="button" onClick={sendPasswordReset} disabled={mailBusy}>パスワードを変更</button>
          </div>
        </article>

        <article className="account-card">
          <div className="account-card-heading"><div>{cloudSync.status === "error" ? <CloudOff aria-hidden="true" size={19} /> : <Cloud aria-hidden="true" size={19} />}<h2>学習データ同期</h2></div><span className={`sync-state ${cloudSync.status}`}>{syncLabel}</span></div>
          <p>問題履歴、復習状況、教材の進捗、1日の新規問題数設定をこのアカウントに保存します。</p>
          {cloudSync.updatedAt && <small>最終同期 {new Date(cloudSync.updatedAt).toLocaleString("ja-JP")}</small>}
          {cloudSync.error && <p className="form-status error">同期先の設定を確認してください。</p>}
          <button className="secondary-button compact" type="button" onClick={onOpenStats}>詳しい学習記録を見る</button>
        </article>

        <article className="account-card">
          <div className="account-card-heading"><div><CreditCard aria-hidden="true" size={19} /><h2>プラン</h2></div></div>
          <div className="plan-summary">
            <strong>{membership.complimentaryAccess ? "全機能アクセス" : membership.premium ? "Mememo Pro" : "無料プラン"}</strong>
            <p>{membership.complimentaryAccess ? "運営用アカウントとして、すべての問題・模試・詳細記録を利用できます。" : membership.premium ? "すべての問題・模試・詳細記録を利用できます。" : "今日の学習と教材を中心に利用できます。"}</p>
          </div>
          {!membership.complimentaryAccess && <button className={membership.premium ? "secondary-button compact" : "primary-button compact"} type="button" onClick={onOpenBilling}>
            {membership.premium ? "契約を管理" : "Proを見る"}
          </button>}
        </article>
      </div>

      <footer className="account-footer-actions">
        <div className="account-button-row">
          <button className="secondary-button compact" type="button" onClick={onSignOut}><LogOut aria-hidden="true" size={16} />ログアウト</button>
          {isAdmin && <button className="secondary-button compact" type="button" onClick={onOpenAdmin}><LayoutDashboard aria-hidden="true" size={16} />管理画面</button>}
        </div>
        <button className="danger-text-button" type="button" onClick={onReset}><RotateCcw aria-hidden="true" size={15} />この端末と同期先の学習履歴をリセット</button>
      </footer>
    </section>
  );
}

function friendlyAuthError(error) {
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("unsupported provider") || message.includes("provider is not enabled")) return "このログイン方法は現在利用できません。メールアドレスでログインしてください。";
  if (message.includes("invalid login credentials")) return "メールアドレスまたはパスワードが正しくありません。";
  if (message.includes("email not confirmed")) return "メール確認が完了していません。確認メールをご確認ください。";
  if (message.includes("already registered")) return "このメールアドレスはすでに登録されています。";
  if (message.includes("password")) return "パスワードは8文字以上で入力してください。";
  if (message.includes("rate limit")) return "操作が続いたため一時的に制限されています。少し待ってからお試しください。";
  return "認証処理に失敗しました。入力内容を確認して再度お試しください。";
}

function AuthDialog({ onClose, initialMode = "signin" }) {
  const [mode, setMode] = useState(initialMode);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthProviders, setOauthProviders] = useState([]);

  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => {
    let active = true;
    getEnabledOAuthProviders().then((providers) => {
      if (active) setOauthProviders(providers);
    });
    return () => { active = false; };
  }, []);

  function changeMode(nextMode) {
    setMode(nextMode);
    setStatus("");
    setError("");
  }

  async function runAuth(action) {
    if (!supabase) {
      setError("Supabase の環境変数が未設定です。");
      return null;
    }
    setSubmitting(true);
    setStatus("");
    setError("");
    try {
      const result = await action();
      if (result?.error) throw result.error;
      return result;
    } catch (authError) {
      setError(friendlyAuthError(authError));
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (mode === "signup") {
      if (password.length < 8) {
        setError("パスワードは8文字以上で入力してください。");
        return;
      }
      if (password !== confirmPassword) {
        setError("確認用パスワードが一致しません。");
        return;
      }
      const result = await runAuth(() => supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
          data: { display_name: displayName.trim() },
        },
      }));
      if (result && !result.data.session) setStatus("確認メールを送信しました。メール内のリンクから登録を完了してください。");
      return;
    }
    if (mode === "magic") {
      const result = await runAuth(() => supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: getAuthRedirectUrl() },
      }));
      if (result) setStatus("ログイン用リンクをメールで送信しました。");
      return;
    }
    if (mode === "forgot") {
      const result = await runAuth(() => supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getAuthRedirectUrl(),
      }));
      if (result) setStatus("パスワード再設定メールを送信しました。");
      return;
    }
    if (mode === "update-password") {
      if (password.length < 8 || password !== confirmPassword) {
        setError(password.length < 8 ? "パスワードは8文字以上で入力してください。" : "確認用パスワードが一致しません。");
        return;
      }
      const result = await runAuth(() => supabase.auth.updateUser({ password }));
      if (result) setStatus("パスワードを更新しました。この画面を閉じて続けられます。");
      return;
    }
    await runAuth(() => supabase.auth.signInWithPassword({ email, password }));
  }

  async function signInWithProvider(provider) {
    await runAuth(() => supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: getAuthRedirectUrl() },
    }));
  }

  const title = mode === "signup" ? "アカウント作成" : mode === "forgot" ? "パスワード再設定" : mode === "update-password" ? "新しいパスワード" : "おかえりなさい";
  const description = mode === "signup"
    ? "無料で始めて、学習履歴を端末間で引き継げます。"
    : mode === "forgot"
      ? "登録したメールアドレスに再設定リンクを送ります。"
      : mode === "update-password"
        ? "今後のログインに使う新しいパスワードを設定します。"
        : "今日の復習と教材の続きから始めましょう。";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel auth-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="auth-brand"><span className="brand-mark">M</span><strong>Mememo</strong></div>
        <div className="modal-heading auth-heading">
          <div><h2 id="auth-title">{title}</h2><p>{description}</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる"><X aria-hidden="true" size={18} /></button>
        </div>

        {!authConfigReady && <div className="setup-note" role="note"><strong>認証設定が必要です</strong><span>VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定してください。</span></div>}

        {! ["forgot", "update-password"].includes(mode) && (
          <div className="auth-tabs" role="tablist" aria-label="認証方法">
            <button className={mode !== "signup" ? "active" : ""} type="button" role="tab" onClick={() => changeMode("signin")}>ログイン</button>
            <button className={mode === "signup" ? "active" : ""} type="button" role="tab" onClick={() => changeMode("signup")}>新規登録</button>
          </div>
        )}

        {! ["forgot", "update-password", "magic"].includes(mode) && oauthProviders.length > 0 && (
          <>
            <div className="oauth-buttons">
              {oauthProviders.includes("google") && <button className="oauth-button" type="button" onClick={() => signInWithProvider("google")} disabled={submitting || !authConfigReady}><span>G</span>Google</button>}
              {oauthProviders.includes("apple") && <button className="oauth-button" type="button" onClick={() => signInWithProvider("apple")} disabled={submitting || !authConfigReady}><span>●</span>Apple</button>}
            </div>
            <div className="auth-divider"><span>または</span></div>
          </>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" && <label>表示名<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" placeholder="学習者名" maxLength={40} required /></label>}
          {mode !== "update-password" && <label>メールアドレス<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>}
          {! ["magic", "forgot"].includes(mode) && <label>パスワード<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8文字以上" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required /></label>}
          {["signup", "update-password"].includes(mode) && <label>パスワード（確認）<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>}
          <button className="primary-button auth-submit" type="submit" disabled={submitting || !authConfigReady}>
            {mode === "signup" ? "無料アカウントを作る" : mode === "magic" ? "ログインリンクを送る" : mode === "forgot" ? "再設定メールを送る" : mode === "update-password" ? "パスワードを更新" : "ログイン"}
            <ChevronRight aria-hidden="true" size={17} />
          </button>
        </form>

        {mode === "signin" && <div className="auth-secondary-actions"><button type="button" onClick={() => changeMode("forgot")}>パスワードを忘れた</button><button type="button" onClick={() => changeMode("magic")}><Mail aria-hidden="true" size={14} />メールリンクでログイン</button></div>}
        {["forgot", "magic", "update-password"].includes(mode) && <div className="auth-secondary-actions single"><button type="button" onClick={() => changeMode("signin")}><ArrowLeft aria-hidden="true" size={14} />ログインに戻る</button></div>}
        {status && <p className="form-status success">{status}</p>}
        {error && <p className="form-status error">{error}</p>}
        <p className="auth-terms">続行すると、<a href="/terms.html" target="_blank" rel="noreferrer">利用規約</a>と<a href="/privacy.html" target="_blank" rel="noreferrer">プライバシーポリシー</a>に同意したものとみなされます。</p>
      </section>
    </div>
  );
}

function SupportDialog({ request, user, onClose }) {
  const question = request.question;
  const [email, setEmail] = useState(user?.email ?? "");
  const [subject, setSubject] = useState(
    request.type === "question_report"
      ? `問題報告: ${question?.examTitle ?? ""} 問${question?.questionNumber ?? ""}`.trim()
      : "お問い合わせ",
  );
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");
    setError("");
    try {
      await submitSupportMessage({
        type: request.type,
        subject,
        message,
        email,
        user,
        question,
      });
      setStatus("送信しました。確認後に対応します。");
      setMessage("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "送信に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-panel support-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="support-title">{request.type === "question_report" ? "この問題を報告" : "お問い合わせ"}</h2>
            <p>{request.type === "question_report" ? "問題IDと試験情報を添付して送信します。" : "ご意見・不具合・収録内容について送信できます。"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {!authConfigReady && (
          <div className="setup-note" role="note">
            <strong>問い合わせ保存先が未設定です</strong>
            <span>Supabase の環境変数と `support_messages` テーブルを設定してください。</span>
          </div>
        )}

        {question && (
          <div className="report-context">
            <span>{question.packLabel}</span>
            {question.examTitle && <span>{question.examTitle}</span>}
            <span>問{question.questionNumber ?? "-"}</span>
            <code>{question.id}</code>
          </div>
        )}

        <form className="support-form" onSubmit={handleSubmit}>
          <label>
            返信先メールアドレス
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label>
            件名
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              required
            />
          </label>
          <label>
            内容
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={7}
              placeholder={request.type === "question_report" ? "誤字、選択肢、解説、画像表示など、気づいた内容を書いてください。" : "お問い合わせ内容を書いてください。"}
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={submitting || !authConfigReady}>
            <MessageSquare aria-hidden="true" size={17} />
            送信
          </button>
        </form>

        {status && <p className="form-status success">{status}</p>}
        {error && <p className="form-status error">{error}</p>}
      </section>
    </div>
  );
}

function ShortcutHelpDialog({ onClose }) {
  const shortcuts = [
    { key: "1-8", action: "選択肢を選ぶ" },
    { key: "N", action: "次の問題へ進む" },
    { key: "P", action: "前の問題へ戻る" },
    { key: "/", action: "ショートカット一覧を開く/閉じる" },
    { key: "Esc", action: "この一覧を閉じる" },
  ];

  return (
    <div className="shortcut-help-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="shortcut-help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="shortcut-help-heading">
          <Keyboard aria-hidden="true" size={20} />
          <h2 id="shortcut-help-title">ショートカット</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="ショートカット一覧を閉じる">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="shortcut-help-list">
          {shortcuts.map((shortcut) => (
            <div className="shortcut-help-row" key={shortcut.key}>
              <kbd>{shortcut.key}</kbd>
              <span>{shortcut.action}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function OfficerQuestionNavigator({ quiz, onJump, mode = "mock" }) {
  const groups = buildOfficerSelectionGroups(quiz.questions, quiz.selections);
  if (groups.length === 0) return null;
  const answeredLabel = mode === "practice" ? "演習済み" : "回答済み";
  const headingNote = mode === "practice" ? "区分別の演習状況" : "区分別の回答状況";
  const requiredLabel = mode === "practice" ? "目安" : "必答";

  return (
    <aside className="officer-question-nav" aria-label="幹部候補生の問題選択">
      <div className="officer-nav-heading">
        <strong>問題選択</strong>
        <span>{headingNote}</span>
      </div>
      <div className="officer-nav-legend" aria-label="表示凡例">
        <span><i className="legend-current" />表示中</span>
        <span><i className="legend-answered" />{answeredLabel}</span>
        <span><i className="legend-unavailable" />表示不可</span>
      </div>
      <div className="officer-nav-groups">
        {groups.map((group) => {
          const target = group.rule?.target;
          const required = target ?? group.answerableCount;
          const complete = required > 0 && group.answered >= required;
          const statusLabel = `${group.answered}/${required}`;
          return (
            <section className={complete ? "officer-nav-group complete" : "officer-nav-group"} key={group.key}>
              <div className="officer-nav-group-head">
                <div>
                  <strong>{group.title}</strong>
                  {group.subtitle && <span>{group.subtitle}</span>}
                </div>
                <div className={group.rule?.kind === "required" ? "officer-rule required" : "officer-rule"}>
                  <b>{mode === "practice" && group.rule?.kind === "required" ? requiredLabel : (group.rule?.label ?? "区分")}</b>
                  <span>{statusLabel}</span>
                </div>
              </div>
              {group.rule?.note && <p>{group.rule.note}</p>}
              <div className="officer-question-grid">
                {group.items.map(({ question, index, answered }) => {
                  const selected = index === quiz.index;
                  const unavailable = isQuestionUnavailable(question);
                  return (
                    <button
                      className={[
                        "palette-button",
                        "officer-grid-button",
                        selected ? "current" : "",
                        answered ? "answered" : "",
                        unavailable ? "unavailable" : "",
                      ].filter(Boolean).join(" ")}
                      type="button"
                      key={question.id}
                      onClick={() => onJump(index)}
                      aria-label={`${group.title} 問${getQuestionNavLabel(question, index)}${unavailable ? " 表示不可" : ""}`}
                    >
                      {getQuestionNavLabel(question, index)}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function ExplanationText({ text }) {
  const paragraphs = formatExplanation(text);
  return (
    <div className="explanation-text">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>
          <FormattedInline text={paragraph} />
        </p>
      ))}
    </div>
  );
}

function formatExplanation(text = "") {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const normalized = trimmed
    .replace(/\r\n?/g, "\n")
    .replace(/\n+\s*([」』）\)])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*(出典[:：])/g, "\n\n$1")
    .replace(/\s*(その他は誤り[:：])\s*/g, "\n\n$1\n")
    .replace(/\s*(正解は\s*[（(][^)）]+[）)]。?)/g, "\n\n$1")
    .replace(/(?<!正解は)\s+(\([1-9]\d*\)\s*)/g, "\n$1")
    .replace(/\n{3,}/g, "\n\n");
  return normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function QuestionText({ question }) {
  const text = getDisplayQuestionText(question);

  if (!text) {
    return (
      <div className="question-text-panel empty-text-panel">
        <strong>問題文テキストがありません</strong>
        <span>公式PDF画像を確認してください。</span>
      </div>
    );
  }

  return (
    <section className="question-text-panel" aria-label="問題文">
      <div className="question-text-heading">
        <strong>問題文</strong>
      </div>
      <FormattedQuestionText text={text} />
    </section>
  );
}

function getDisplayQuestionText(question) {
  if (isQuestionUnavailable(question)) {
    return `問${question.questionNumber ?? ""}\n${question.unavailableReason ?? "この問題は著作権の関係により表示できません。"}`.trim();
  }
  const sourceText = question.transcription?.markdown || question.transcription?.text || question.transcription?.rawText || "";
  if (question.packId?.startsWith("officer-")) {
    return removeOfficerQuestionNumber(removeChoiceText(stripInlineMarkdown(sourceText), question.choiceLabels));
  }
  if (question.packId !== "itpass" || !POLISHED_ITPASS_EXAM_IDS.has(question.examId)) return sourceText;
  return removeLatestItpassQuestionNumber(removeChoiceText(stripInlineMarkdown(sourceText), question.choiceLabels));
}

function stripInlineMarkdown(text) {
  return text
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/__+/g, "")
    .trim();
}

function removeChoiceText(text, choiceLabels = []) {
  const choiceHeading = text.search(/(?:^|\n)\s*選択肢\s*(?:[（(][^）)]*[）)])?\s*[:：]?/);
  if (choiceHeading >= 0) {
    return text.slice(0, choiceHeading).trim();
  }
  const answerCombinationTable = text.search(
    /(?:^|\n)\s*\|?\s*(?:a|A|ア|Ａ)\s*\|\s*(?:b|B|イ|Ｂ)\s*\|\s*(?:c|C|ウ|Ｃ)\s*\|\s*(?:d|D|エ|Ｄ)\s*\|?/,
  );
  if (answerCombinationTable >= 0) {
    return text.slice(0, answerCombinationTable).trim();
  }

  const lines = text.split(/\r?\n/);
  const keptLines = [];
  const labels = choiceLabels?.length ? choiceLabels : ["ア", "イ", "ウ", "エ"];
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const choiceLine = new RegExp(
    `^\\s*(?:[-*•]\\s*)?(?:\\(?\\s*(?:${escapedLabels})\\s*\\)?|(?:${escapedLabels})[.)．])\\s*[:：.]?\\s+`
  );
  const choiceTableLine = new RegExp(`^\\s*\\|\\s*\\(?\\s*(?:${escapedLabels})\\s*\\)?\\s*\\|`);
  const numberedMarkdownLine = new RegExp(`^\\s*(?:${escapedLabels})[.)．]\\s+`);

  for (const line of lines) {
    if (choiceLine.test(line) || choiceTableLine.test(line) || numberedMarkdownLine.test(line)) break;
    keptLines.push(line);
  }

  return keptLines.join("\n").trim();
}

function removeLatestItpassQuestionNumber(text) {
  return text.replace(/^\s*問\s*\d{1,3}\s*/, "").trim();
}

function removeOfficerQuestionNumber(text) {
  return text
    .replace(/^\s*(?:No\.?|問)\s*\d{1,3}\s*[:：.]?\s*/i, "")
    .replace(/^\s*\d{1,3}\s*(?:\r?\n|$)/, "")
    .trim();
}

function FormattedQuestionText({ text }) {
  const blocks = parseQuestionText(text);

  return (
    <div className="formatted-question-text">
      {blocks.map((block, index) => {
        if (block.type === "table") {
          return <QuestionTable key={index} rows={block.rows} alignments={block.alignments} />;
        }
        if (block.type === "list") {
          return (
            <ul className="question-list" key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <FormattedInline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            <FormattedInline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

function parseQuestionText(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = [];

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  }

  function flushList() {
    if (list.length > 0) {
      blocks.push({ type: "list", items: list });
      list = [];
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const tableHeader = parseTableRow(line);
    const separator = parseTableSeparator(lines[index + 1]?.trim() ?? "");
    if (tableHeader && separator) {
      flushParagraph();
      flushList();
      const rows = [tableHeader];
      index += 2;
      while (index < lines.length) {
        const row = parseTableRow(lines[index].trim());
        if (!row) {
          index -= 1;
          break;
        }
        rows.push(row);
        index += 1;
      }
      blocks.push({ type: "table", rows, alignments: separator });
      continue;
    }

    const listMatch = line.match(/^[-•]\s*(.+)$/);
    if (listMatch) {
      flushParagraph();
      list.push(listMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function parseTableRow(line) {
  if (!line.startsWith("|") || !line.endsWith("|")) return null;
  return line.slice(1, -1).split("|").map((cell) => cell.trim());
}

function parseTableSeparator(line) {
  const row = parseTableRow(line);
  if (!row || !row.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  return row.map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  });
}

function QuestionTable({ rows, alignments }) {
  const [head, ...body] = rows;
  return (
    <div className="question-table-wrap">
      <table className="question-data-table">
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} style={{ textAlign: alignments[index] ?? "left" }}>
                <FormattedInline text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={{ textAlign: alignments[cellIndex] ?? "left" }}>
                  <FormattedInline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormattedInline({ text }) {
  const parts = [];
  const pattern = /(<u>[\s\S]+?<\/u>|\$\$[^$]+\$\$|\$[^$]+\$|\\\([^)]+\\\)|\\\[[\s\S]+?\\\])/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    parts.push(match[0].startsWith("<u>") ? { type: "underline", value: match[0].slice(3, -4) } : { type: "math", value: match[0] });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) parts.push({ type: "text", value: text.slice(lastIndex) });

  return parts.map((part, index) => {
    if (part.type === "text") return <PlainTextWithMathHints key={index} text={part.value} />;
    if (part.type === "underline") {
      return (
        <u key={index}>
          <FormattedInline text={part.value} />
        </u>
      );
    }
    const displayMode = part.value.startsWith("$$") || part.value.startsWith("\\[");
    const expression = part.value
      .replace(/^\$\$|\$\$$/g, "")
      .replace(/^\$|\$$/g, "")
      .replace(/^\\\(|\\\)$/g, "")
      .replace(/^\\\[|\\\]$/g, "");
    return (
      <span
        key={index}
        className={displayMode ? "math-display" : "math-inline"}
        dangerouslySetInnerHTML={{ __html: katex.renderToString(expression, { throwOnError: false, displayMode }) }}
      />
    );
  });
}

function PlainTextWithMathHints({ text }) {
  const parts = [];
  const segments = findPlainMathSegments(text);
  let lastIndex = 0;
  for (const segment of segments) {
    if (segment.start > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, segment.start) });
    }
    parts.push({ type: "math", value: segment.value });
    lastIndex = segment.end;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  return parts.map((part, index) => {
    if (part.type === "math") {
      return (
        <span
          className="math-inline plain-math"
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(normalizePlainMathExpression(part.value), {
              throwOnError: false,
              displayMode: false,
            }),
          }}
          key={index}
        />
      );
    }
    return <span key={index}>{renderCaretSuperscripts(part.value, index)}</span>;
  });
}

function findPlainMathSegments(text) {
  const trimmed = text.trim();
  if (isStandaloneMathText(trimmed)) {
    const start = text.indexOf(trimmed);
    return [{ start, end: start + trimmed.length, value: trimmed }];
  }

  const segments = [];
  const addMatches = (pattern) => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = match[0];
      if (!value.trim()) continue;
      segments.push({ start: match.index, end: match.index + value.length, value });
    }
  };

  addMatches(/\\(?:left|right|dfrac|frac|sqrt|cos|sin|tan|theta|pi|alpha|beta|gamma)[^\n。、]*(?:\}|\)|\]|\d)/g);
  addMatches(/∫\s*_[^\n。、]+?\s+d\s*[a-z]/g);
  addMatches(/\|[A-Z]{2}\|\s*=\s*[−-]?\d+(?:、\s*\|[A-Z]{2}\|\s*=\s*[−-]?\d+)*/g);
  addMatches(/<[A-Z]{2}>\s*・\s*<[A-Z]{2}>/g);
  addMatches(/\([a-zαβγθπ]\s*[+−-]\s*\d+\)(?:\s*\([a-zαβγθπ]\s*[+−-]\s*\d+\))*(?:\s*=\s*[−-]?\s*\([a-zαβγθπ]\s*[+−-]\s*\d+\)(?:\s*\([a-zαβγθπ]\s*[+−-]\s*\d+\))*)+/g);
  addMatches(/\([αβγa-zθπ]\s*[+−-]\s*\d+\)(?:\s*\([αβγa-zθπ]\s*[+−-]\s*\d+\))+/g);
  addMatches(/[a-zαβγθπ]\s*=\s*(?:\d+\s*)?(?:cos|sin|tan)\s*\d*[a-zαβγθπ](?:\s*[+−-]\s*\d*\s*(?:cos|sin|tan)\s*\d*[a-zαβγθπ])+/g);
  addMatches(/\d+\s*[≦≤<]\s*[a-zαβγθπ]\s*[<≦≤]\s*\d*[a-zαβγθπ]/g);
  addMatches(/[−-]?\d+\s*\/\s*\d+/g);

  const term = String.raw`(?:\d+(?:\.\d+)?[a-zαβγθπ](?:\^\{?[A-Za-z0-9]+\}?)?|[a-zαβγθπ](?:\^\{?[A-Za-z0-9]+\}?)?|\d+(?:\.\d+)?)`;
  addMatches(new RegExp(`(?<![A-Za-z])${term}(?:\\s*[+−\\-*/=]\\s*${term})+(?![A-Za-z])`, "g"));

  return segments
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((segment, index, sorted) => {
      const previous = sorted.slice(0, index).find((item) =>
        segment.start < item.end && segment.end > item.start
      );
      return !previous;
    });
}

function isStandaloneMathText(value) {
  if (!value) return false;
  return (
    /^[−-]?\d+(?:\.\d+)?$/.test(value) ||
    /^[a-zαβγθπ]$/.test(value) ||
    /^[a-zαβγθπ]\s*[+−-]\s*\d+$/.test(value) ||
    /^[−-]?\d+\s*\/\s*\d+$/.test(value)
  );
}

function normalizePlainMathExpression(value) {
  let expression = value
    .replace(/−/g, "-")
    .replace(/≦|≤/g, "\\le ")
    .replace(/≧|≥/g, "\\ge ")
    .replace(/α/g, "\\alpha ")
    .replace(/β/g, "\\beta ")
    .replace(/γ/g, "\\gamma ")
    .replace(/θ/g, "\\theta ")
    .replace(/π/g, "\\pi ")
    .replace(/\|([A-Z]{2})\|/g, "\\lvert \\overrightarrow{$1}\\rvert")
    .replace(/<([A-Z]{2})>/g, "\\overrightarrow{$1}")
    .replace(/・/g, "\\cdot ")
    .replace(/(^|[^\\])\b(cos|sin|tan|log)\b/g, "$1\\$2")
    .replace(/([−-]?\d+)\s*\/\s*(\d+)/g, "\\frac{$1}{$2}")
    .replace(/\^([A-Za-z0-9]+)/g, "^{$1}");

  expression = expression.replace(
    /∫\s*_\s*([^\s^]+)\s*\^\s*([^\s]+)\s*([\s\S]*?)\s*d\s*([a-z])$/,
    (_, lower, upper, integrand, variable) => `\\int_{${lower}}^{${upper}} ${integrand.trim()}\\,d${variable}`
  );

  return expression;
}

function renderCaretSuperscripts(text, keyPrefix) {
  const parts = [];
  const pattern = /\^(?:\{([^}]+)\}|([A-Za-z0-9]+))/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "sup", value: match[1] ?? match[2] });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  return parts.map((part, index) => {
    if (part.type === "sup") {
      return <sup className="math-sup" key={`${keyPrefix}-${index}`}>{part.value}</sup>;
    }
    return <span key={`${keyPrefix}-${index}`}>{part.value}</span>;
  });
}

function DeckMarketplaceView({ packs, enabledPackSet, onToggleDeck, onPracticeDeck }) {
  const groups = [
    {
      id: "bookkeeping",
      eyebrow: "資格試験",
      title: "日商簿記",
      description: "2級・3級を個別に、または同時に学習できます。",
      packIds: new Set(bookkeepingPackIds),
    },
    {
      id: "officer",
      eyebrow: "採用試験",
      title: "一般幹部候補生等",
      description: "防衛省・自衛隊が公開している一般教養・専門択一をまとめて学習します。",
      packIds: new Set(["officer-candidate"]),
    },
  ];

  return (
    <section className="market-view">
      <div className="view-heading">
        <div>
          <h2>学習セット管理</h2>
          <p>入口は分けていますが、ここでは簿記と一般幹部候補生等を同時に学習対象へ追加できます。</p>
        </div>
      </div>

      <div className="market-groups">
        {groups.map((group) => (
          <section className="market-group" key={group.id} aria-labelledby={`market-group-${group.id}`}>
            <div className="market-group-heading">
              <span>{group.eyebrow}</span>
              <h3 id={`market-group-${group.id}`}>{group.title}</h3>
              <p>{group.description}</p>
            </div>
            <div className="market-grid">
              {packs.filter((pack) => group.packIds.has(pack.id)).map((pack) => {
                const enrolled = isVisiblePackEnabled(pack, enabledPackSet);
                const memberPackIds = pack.memberPackIds ?? [pack.id];
                const canRemove = enrolled && enabledPackSet.size > memberPackIds.length;
                const actionLabel = enrolled ? canRemove ? "演習対象から外す" : "演習対象" : "演習対象に追加";
                return (
                  <article className={enrolled ? "deck-card enrolled" : "deck-card"} key={pack.id} style={{ "--deck-accent": pack.accent }}>
                    <div className="deck-card-top">
                      <span className="deck-symbol"><PackIcon packId={pack.id} /></span>
                      <span className={enrolled ? "deck-status enrolled" : "deck-status"}>{enrolled ? "演習対象" : "未選択"}</span>
                    </div>
                    <div>
                      <h3>{pack.title}</h3>
                      <p>{pack.description}</p>
                    </div>
                    <dl className="deck-metrics">
                      <div><dt>問題</dt><dd>{pack.questionCount}</dd></div>
                      <div><dt>演習</dt><dd>{pack.total}</dd></div>
                      <div><dt>正答率</dt><dd>{pack.rate}%</dd></div>
                    </dl>
                    <div className="deck-actions">
                      <button
                        className={enrolled ? "secondary-button compact" : "primary-button compact"}
                        type="button"
                        onClick={() => onToggleDeck(pack.id)}
                        disabled={enrolled && !canRemove}
                      >
                        {enrolled ? <Check aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />}
                        {actionLabel}
                      </button>
                      <button className="secondary-button compact" type="button" onClick={() => onPracticeDeck(pack.id)} disabled={!enrolled}>
                        このセットで演習
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function ReviewView({ candidates, summary, onStartReview, onPracticeQuestion }) {
  const topCandidates = candidates.slice(0, 20);
  const wrongCount = candidates.filter((item) => (item.attempt?.wrong ?? 0) > 0).length;
  const overdueCount = candidates.filter((item) => item.dueLabel?.includes("遅れ")).length;

  return (
    <section className="review-view">
      <div className="view-heading">
        <div>
          <h2>復習</h2>
          <p>実際に間違えた問題から、今日の復習期限に来ているものを解き直せます。</p>
        </div>
        <button className="primary-button" type="button" onClick={() => onStartReview(topCandidates)} disabled={topCandidates.length === 0}>
          <Target aria-hidden="true" size={17} />
          今日の復習を開始
        </button>
      </div>

      <div className="metric-grid">
        <MetricCard icon={Target} label="今日の復習" value={`${candidates.length}問`} />
        <MetricCard icon={X} label="ミスあり" value={`${wrongCount}問`} />
        <MetricCard icon={Clock} label="期限超過" value={`${overdueCount}問`} />
      </div>

      <section className="table-panel review-summary-panel">
        <h3>今日の復習キュー</h3>
        {topCandidates.length === 0 ? (
          <p className="empty-text">今日の復習問題はありません。演習で間違えた問題はここに入り、正解するたびに次回の復習間隔が長くなります。</p>
        ) : (
          <div className="review-list">
            {topCandidates.map((item, index) => (
              <article className="review-row" key={item.question.id}>
                <div className="review-rank">{index + 1}</div>
                <div>
                  <div className="question-tags">
                    <span>{item.question.packLabel}</span>
                    {item.question.examTitle && <span>{item.question.examTitle}</span>}
                    <span>{item.question.category}</span>
                  </div>
                  <h3>{item.question.prompt}</h3>
                  <div className="review-reasons">
                    {item.reasons.map((reason) => (
                      <span key={reason}>{reason}</span>
                    ))}
                  </div>
                </div>
                <div className="review-score">
                  <strong>{item.accuracy === null ? "記録" : `${item.accuracy}%`}</strong>
                  <small>{item.attempt?.total ?? 0}回 / Lv.{item.reviewLevel}</small>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => onPracticeQuestion(item.question)}>1問復習</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="table-panel">
        <h3>全体の状態</h3>
        <div className="progress-row wide">
          <span>総演習</span>
          <div className="progress-track slim"><span style={{ width: `${Math.min(100, summary.total)}%` }} /></div>
          <strong>{summary.total}回</strong>
        </div>
        <div className="progress-row wide">
          <span>正答率</span>
          <div className="progress-track slim"><span style={{ width: `${summary.rate}%` }} /></div>
          <strong>{summary.rate}%</strong>
        </div>
      </section>
    </section>
  );
}

function HistoryView({ entries, progress, sessions, onPracticeQuestion, onPracticeExam }) {
  const mockSessions = (sessions ?? []).filter((session) => session.mode === "mock");
  return (
    <section className="history-view">
      <div className="view-heading">
        <div>
          <h2>学習履歴</h2>
          <p>最近解いた問題、結果、選択肢、同じ問題への復習導線を確認できます。</p>
        </div>
      </div>

      <section className="mock-history-panel">
        <div className="mock-history-heading">
          <h3>模試受験履歴</h3>
          <span>{mockSessions.length}回</span>
        </div>
        {mockSessions.length === 0 ? (
          <p className="empty-text">模試を提出すると、受験日時、得点、回答数がここに残ります。</p>
        ) : (
          <div className="mock-history-list">
            {mockSessions.slice(0, 10).map((session) => {
              const total = session.requiredAnswerCount ?? session.total ?? session.questionCount ?? 0;
              const rate = Number.isInteger(session.rate)
                ? session.rate
                : total > 0
                  ? Math.round((session.correct / total) * 100)
                  : 0;
              const answered = session.answered ?? 0;
              return (
                <article className="mock-history-row" key={session.id}>
                  <div>
                    <span>{formatDateTime(session.date)}</span>
                    <strong>{session.examTitle || session.packLabel || "模試"}</strong>
                    {session.packLabel && session.examTitle && <small>{session.packLabel}</small>}
                  </div>
                  <div className="mock-history-score">
                    <strong>{rate}%</strong>
                    <span>{session.correct}/{total}</span>
                  </div>
                  <div className="mock-history-meta">
                    <span>回答 {answered}/{total}</span>
                    <span>{formatDuration(session.elapsedSeconds ?? 0)}</span>
                    <span>{session.reason === "timeup" ? "時間切れ" : "提出"}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="history-timeline">
        {entries.length === 0 ? (
          <section className="empty-history-card empty-card" aria-label="履歴なし">
            <div className="empty-icon">
              <History aria-hidden="true" size={28} />
            </div>
            <h2>まだ学習履歴がありません</h2>
            <p>問題に解答すると、ここに時系列で記録されます。</p>
          </section>
        ) : (
          entries.slice(0, 80).map((entry, index) => {
            const attempt = progress.attempts[entry.questionId];
            const accuracy = getAttemptAccuracy(attempt);
            const resultLabel = entry.correct === null ? "記録" : entry.correct ? "正解" : "不正解";
            const selectedChoice = Number.isInteger(entry.choiceIndex)
              ? entry.question.choices?.[entry.choiceIndex]
              : "";
            const correctChoice = Number.isInteger(entry.question.answer)
              ? entry.question.choices?.[entry.question.answer]
              : "";
            const correctLabel = Number.isInteger(entry.question.answer)
              ? entry.question.choiceLabels?.[entry.question.answer] ?? String.fromCharCode(65 + entry.question.answer)
              : "";
            const promptPreview = getHistoryQuestionPreview(entry.question);
            const explanationPreview = getHistoryExplanationPreview(entry.question.explanation);
            return (
              <article className={`history-row ${entry.correct === false ? "missed" : ""}`} key={`${entry.id}-${index}`}>
                <div className="history-result">
                  <span>{resultLabel}</span>
                  <small>{formatDateTime(entry.answeredAt)}</small>
                </div>
                <div>
                  <div className="question-tags">
                    <span>{entry.question.packLabel}</span>
                    {entry.question.examTitle && <span>{entry.question.examTitle}</span>}
                    <span>{entry.question.category}</span>
                  </div>
                  <h3>{entry.question.prompt}</h3>
                  {promptPreview && <p className="history-question-preview">{promptPreview}</p>}
                  <div className="history-answer-grid">
                    <div className={entry.correct === false ? "history-answer selected wrong" : "history-answer selected"}>
                      <span>あなたの選択 {entry.selectedLabel || "-"}</span>
                      <strong>{selectedChoice || "未記録"}</strong>
                    </div>
                    <div className="history-answer correct">
                      <span>正解 {correctLabel || "-"}</span>
                      <strong>{correctChoice || "未収録"}</strong>
                    </div>
                  </div>
                  {explanationPreview && (
                    <p className="history-explanation-preview">{explanationPreview}</p>
                  )}
                  <p className="history-attempt-meta">
                    累計 {attempt?.total ?? 0}回{accuracy !== null ? ` / 正答率 ${accuracy}%` : ""}
                  </p>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => onPracticeQuestion(entry.question)}>この問題</button>
                  {entry.question.examId && <button type="button" onClick={() => onPracticeExam(entry.question)}>この試験</button>}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function getHistoryQuestionPreview(question) {
  const text = getDisplayQuestionText(question)
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === question.prompt) return "";
  return truncateText(text, 170);
}

function getHistoryExplanationPreview(explanation) {
  const text = String(explanation || "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? truncateText(text, 150) : "";
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const displayMinutes = minutes % 60;
  if (hours > 0) {
    return `${hours}:${String(displayMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${displayMinutes}:${String(seconds).padStart(2, "0")}`;
}

function StatsView({ summary, packs, statsByBucket, sessions, questionCount, onReset }) {
  return (
    <section className="stats-view">
      <div className="view-heading">
        <div>
          <h2>進捗</h2>
          <p>分野別の演習量、正答率、弱点候補。</p>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard icon={ListChecks} label="総演習" value={`${summary.total}回`} />
        <MetricCard icon={Trophy} label="正答率" value={`${summary.rate}%`} />
        <MetricCard icon={GraduationCap} label="定着済み" value={`${summary.mastered}問`} />
        <MetricCard icon={BarChart3} label="問題数" value={`${questionCount}問`} />
      </div>

      <div className="stats-layout">
        <section className="table-panel">
          <h3>分野別</h3>
          {packs.map((pack) => (
            <div className="progress-row" key={pack.id}>
              <span>{pack.label}</span>
              <div className="progress-track slim"><span style={{ width: `${pack.rate}%`, background: pack.accent }} /></div>
              <strong>{pack.rate}%</strong>
            </div>
          ))}
        </section>

        <section className="table-panel">
          <h3>弱点候補</h3>
          {statsByBucket.length === 0 ? (
            <p className="empty-text">演習後にミスが多い論点が表示されます。</p>
          ) : (
            statsByBucket.map((item) => (
              <div className="weak-row full" key={item.key}>
                <span>{item.packLabel} / {item.subject}</span>
                <strong>{item.category}</strong>
                <small>正答 {item.correct} / ミス {item.wrong}</small>
              </div>
            ))
          )}
        </section>
      </div>

      <section className="table-panel">
        <h3>最近のセッション</h3>
        {sessions.length === 0 ? (
          <p className="empty-text">まだセッション記録はありません。</p>
        ) : (
          sessions.slice(0, 8).map((session) => (
            <div className="session-row" key={session.id}>
              <span>{new Date(session.date).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              <strong>{session.correct}/{session.total}</strong>
              <small>{modeOptions.find((mode) => mode.id === session.mode)?.title ?? session.mode}</small>
            </div>
          ))
        )}
      </section>

      <div className="danger-zone">
        <button className="secondary-button" type="button" onClick={onReset}>
          <RotateCcw aria-hidden="true" size={17} />
          ローカル進捗をリセット
        </button>
      </div>
    </section>
  );
}

function MetricCard({ icon: Icon, label, value }) {
  return (
    <div className="metric-card">
      <Icon aria-hidden="true" size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
