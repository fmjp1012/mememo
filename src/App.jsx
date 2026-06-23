import { useEffect, useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  BarChart3,
  Brain,
  Check,
  Clock,
  FileText,
  Flag,
  GraduationCap,
  History,
  ListChecks,
  Plus,
  PlugZap,
  RotateCcw,
  Shield,
  Shuffle,
  Target,
  TimerReset,
  Trophy,
  X,
} from "lucide-react";
import {
  defaultEnabledPacks,
  getPack,
  loadQuestionBank,
  officerCandidatePackIds,
  questionBank,
  visibleLearningPacks,
} from "./learningContent.js";

const STORAGE_KEY = "mememo-progress-v1";
const SETTINGS_STORAGE_KEY = "mememo-settings-v1";
const DEFAULT_PACK_ID = "itpass";
const DEFAULT_EXAM_ID = "2026r08";
const POLISHED_ITPASS_EXAM_IDS = new Set(["2026r08", "2025r07", "2024r06"]);
const choiceShortcutKeys = ["1", "2", "3", "4", "5", "6", "7", "8"];
const nextShortcutKey = "n";
const previousShortcutKey = "p";

const mockProfiles = {
  itpass: { label: "ITパスポート 本試験", minutes: 120, questions: 100 },
  "basic-info": { label: "基本情報 公開サンプル", minutes: 190, questions: 26 },
  "applied-info": { label: "応用情報 午前", minutes: 150, questions: 80 },
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
    description: "公式PDFの並びで進める",
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
  attempts: {},
  bookmarks: [],
  history: [],
  sessions: [],
  enabledPacks: defaultEnabledPacks,
};

function normalizeEnabledPacks(enabledPacks) {
  const validPackIds = new Set(defaultEnabledPacks);
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
    if (!stored) return emptyProgress;
    const parsed = JSON.parse(stored);
    const enabledPacks = normalizeEnabledPacks(Array.isArray(parsed.enabledPacks) ? parsed.enabledPacks : []);
    return {
      ...emptyProgress,
      ...parsed,
      enabledPacks: enabledPacks.length > 0 ? enabledPacks : defaultEnabledPacks,
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      attempts: parsed.attempts && typeof parsed.attempts === "object" ? parsed.attempts : {},
    };
  } catch {
    return emptyProgress;
  }
}

function saveProgress(progress) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function getDefaultSettings(progress) {
  return {
    enabledPacks: progress.enabledPacks,
    packId: DEFAULT_PACK_ID,
    examId: DEFAULT_EXAM_ID,
    subject: "すべて",
    category: "すべて",
    mode: "random",
    order: "ordered",
  };
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
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings) {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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
      if (!attempt) return false;
      const accuracy = attempt.total > 0 ? attempt.correct / attempt.total : 0;
      return attempt.wrong > 0 || accuracy < 0.7;
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
        return right.wrong - left.wrong || left.correct / Math.max(1, left.total) - right.correct / Math.max(1, right.total);
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
  return ["itpass", "basic-info", "applied-info", "officer-kyouyou", "officer-senmon"].map((packId) => {
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
      const total = attempt?.total ?? 0;
      const lastAt = attempt?.lastAt ? new Date(attempt.lastAt).getTime() : 0;
      const reasons = [];

      if (attempt?.lastResult === "wrong") reasons.push("直近ミス");
      if (wrong > 0) reasons.push(`ミス${wrong}回`);
      if (accuracy !== null && accuracy < 70) reasons.push(`正答率${accuracy}%`);

      if (reasons.length === 0) return null;

      const priority =
        (attempt?.lastResult === "wrong" ? 5 : 0) +
        wrong * 3 +
        (accuracy === null ? 0 : Math.max(0, 70 - accuracy) / 10) +
        Math.min(4, Math.max(0, Date.now() - lastAt) / 86_400_000) * 0.1;

      return {
        question,
        attempt,
        accuracy,
        reasons,
        priority,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority || (b.attempt?.wrong ?? 0) - (a.attempt?.wrong ?? 0));
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
    startedAt: options.startedAt ?? null,
    durationSeconds: options.durationSeconds ?? null,
    submittedAt: null,
  };
}

function createQuizForSettings(settings, progress) {
  const questions = buildQuiz(settings, progress);
  if (settings.mode !== "mock") return createActiveQuiz(questions);
  const limit = getMockQuestionLimit(settings, questions.length);
  return createActiveQuiz(questions.slice(0, limit), {
    examMode: true,
    startedAt: Date.now(),
    durationSeconds: getMockDurationMinutes(settings) * 60,
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
  const [activeView, setActiveView] = useState("landing");
  const [isBankLoading, setIsBankLoading] = useState(questionBank.length === 0);
  const [bankVersion, setBankVersion] = useState(0);
  const [bankError, setBankError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [mockCountdown, setMockCountdown] = useState(null);

  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    loadQuestionBank()
      .then(() => {
        if (cancelled) return;
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
  }, []);

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
    const nextSettings = resolveSettings(settings, partial);
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
    const nextSettings = { ...settings, ...overrides };
    setSettings(nextSettings);
    setQuiz(createQuizForSettings(nextSettings, progress));
    setActiveView("quiz");
  }

  function openPractice() {
    const nextSettings = {
      ...settings,
      mode: settings.mode === "weak" ? "weak" : "random",
    };
    setSettings(nextSettings);
    setQuiz(createQuizForSettings(nextSettings, progress));
    setActiveView("quiz");
  }

  function openMockSetup() {
    const mockPackIds = new Set(["itpass", "basic-info", "applied-info", "officer-kyouyou", "officer-senmon"]);
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
    setSettings({ ...settings, ...overrides });
    setQuiz(createActiveQuiz(nextQuestions));
    setActiveView("quiz");
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
            [question.id]: {
              total: previous.total + 1,
              correct: previous.correct + (correct === true ? 1 : 0),
              wrong: previous.wrong + (correct === false ? 1 : 0),
              ungraded: (previous.ungraded ?? 0) + (correct === null ? 1 : 0),
              lastResult: correct === null ? "ungraded" : correct ? "correct" : "wrong",
              lastAt: answeredAt,
            },
          },
        };
      });

      return {
        ...current,
        selectedChoice: choiceIndex,
        status: nextStatus,
        answers: [
          ...current.answers,
          {
            questionId: question.id,
            packId: question.packId,
            subject: question.subject,
            category: question.category,
            correct,
          },
        ],
      };
    });
  }

  function nextQuestion() {
    setQuiz((current) => {
      if (current.index === current.questions.length - 1) {
        if (current.examMode) return current;
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
      return {
        ...current,
        index: current.index + 1,
        selectedChoice: current.examMode ? current.selections[current.questions[current.index + 1]?.id] ?? null : null,
        status: "answering",
      };
    });
  }

  function previousQuestion() {
    setQuiz((current) => {
      if (current.status === "empty" || current.index <= 0) return current;
      return {
        ...current,
        index: current.index - 1,
        selectedChoice: current.examMode ? current.selections[current.questions[current.index - 1]?.id] ?? null : null,
        status: "answering",
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
        selectedChoice: current.examMode ? current.selections[question.id] ?? null : null,
        status: current.examMode ? "answering" : current.status,
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
            total: previous.total + 1,
            correct: previous.correct + (answer.correct === true ? 1 : 0),
            wrong: previous.wrong + (answer.correct === false ? 1 : 0),
            ungraded: (previous.ungraded ?? 0) + (answer.correct === null ? 1 : 0),
            lastResult: answer.correct === null ? "ungraded" : answer.correct ? "correct" : "wrong",
            lastAt: answeredAt,
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
      if (activeView !== "quiz") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (quiz.status === "empty" || quiz.status === "complete") return;

      const key = event.key.toLowerCase();
      const choiceIndex = choiceShortcutKeys.indexOf(key);
      if (choiceIndex >= 0) {
        const currentQuestion = quiz.questions[quiz.index];
        if (quiz.status === "answering" && currentQuestion?.choices?.[choiceIndex] != null) {
          event.preventDefault();
          answerQuestion(choiceIndex);
        }
        return;
      }

      if (key === nextShortcutKey) {
        event.preventDefault();
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
  }, [activeView, quiz]);

  function resetProgress() {
    if (!window.confirm("学習履歴とセッション記録をリセットします。よろしいですか？")) return;
    const nextProgress = { ...emptyProgress, enabledPacks: settings.enabledPacks };
    setProgress(nextProgress);
    setQuiz(createQuizForSettings(settings, nextProgress));
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
  const hideShellPanels = isFocusMode || activeView === "mock" || activeView === "landing";
  const mainShellClassName = activeView === "landing"
    ? "landing-shell"
    : hideShellPanels
      ? "learning-shell focus-learning-shell"
      : "learning-shell";

  return (
    <div className={isFocusMode ? "app-shell focus-mode" : "app-shell"}>
      {!isFocusMode && <header className="app-header">
        <button className="brand brand-button" type="button" onClick={() => setActiveView("landing")} aria-label="Mememo ホーム">
          <span className="brand-mark">M</span>
          <span>Mememo</span>
        </button>
        <nav className="top-nav" aria-label="主要ナビゲーション">
          <button className={activeView === "landing" ? "active" : ""} type="button" onClick={() => setActiveView("landing")}>ホーム</button>
          <button className={activeView === "quiz" && !quiz.examMode ? "active" : ""} type="button" onClick={openPractice}>演習</button>
          <button className={activeView === "mock" ? "active" : ""} type="button" onClick={openMockSetup}>模試</button>
          <button className={activeView === "review" ? "active" : ""} type="button" onClick={() => setActiveView("review")}>復習</button>
          <button className={activeView === "history" ? "active" : ""} type="button" onClick={() => setActiveView("history")}>履歴</button>
          <button className={activeView === "market" ? "active" : ""} type="button" onClick={() => setActiveView("market")}>マーケット</button>
          <button className={activeView === "stats" ? "active" : ""} type="button" onClick={() => setActiveView("stats")}>進捗</button>
        </nav>
      </header>}

      <main className={mainShellClassName} id="top">
        {!hideShellPanels && <aside className="control-panel">
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
              デッキを追加
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
              label="試験回"
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
          {activeView === "landing" && (
            <LandingPage
              packs={activePackStats}
              enabledPackSet={enabledPackSet}
              summary={summary}
              questionCount={questionBank.length}
              onStart={openPractice}
              onMock={openMockSetup}
              onMarket={() => setActiveView("market")}
              onStats={() => setActiveView("stats")}
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
              onReviewMisses={() => startQuiz({ mode: "weak" })}
              secondsRemaining={mockSecondsRemaining}
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

        {!hideShellPanels && <aside className="insight-panel">
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
    </div>
  );
}

function LandingPage({ packs, enabledPackSet, summary, questionCount, onStart, onMock, onMarket, onStats }) {
  const visiblePacks = packs.filter((pack) => isVisiblePackEnabled(pack, enabledPackSet));
  const featuredPacks = visiblePacks.slice(0, 4);
  const totalAttempts = summary.total.toLocaleString("ja-JP");
  const totalQuestions = questionCount.toLocaleString("ja-JP");

  return (
    <div className="landing-page">
      <section className="landing-hero" aria-label="Mememo の概要">
        <div className="landing-hero-copy">
          <h1>公式問題で、毎日の演習を迷わず進める</h1>
          <p>
            ITパスポート、基本情報、応用情報、幹部候補生等の公開問題を、
            出典画像と選択肢カードで集中して解けます。
          </p>
          <div className="landing-actions">
            <button className="primary-button" type="button" onClick={onStart}>
              <ListChecks aria-hidden="true" size={18} />
              すぐ演習する
            </button>
            <button className="secondary-button" type="button" onClick={onMarket}>
              <Plus aria-hidden="true" size={18} />
              収録セットを見る
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
            <p>公開問題の本文を読み、最も適切な選択肢を選びます。</p>
          </div>
          <div className="preview-choices">
            {["ア", "イ", "ウ", "エ"].map((label, index) => (
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
        <LandingFeature icon={FileText} title="公式PDF画像" text="問題文と選択肢の横で、公開元の画像を確認できます。" />
        <LandingFeature icon={Target} title="復習優先" text="ミスや低定着の問題を抽出し、次に解くべき順に並べます。" />
        <LandingFeature icon={TimerReset} title="模試モード" text="年度と範囲を選び、制限時間付きで一括採点します。" />
      </section>

      <section className="landing-packs" aria-label="収録セット">
        <div className="landing-section-heading">
          <h2>収録セット</h2>
          <button className="secondary-button compact" type="button" onClick={onMarket}>
            すべて管理
          </button>
        </div>
        <div className="landing-pack-list">
          {featuredPacks.map((pack) => (
            <button
              className="landing-pack-row"
              type="button"
              key={pack.id}
              onClick={onStart}
              style={{ "--deck-accent": pack.accent }}
            >
              <span className="deck-symbol">
                <PackIcon packId={pack.id} />
              </span>
              <span>
                <strong>{pack.label}</strong>
                <small>{pack.questionCount}問 / 正答率 {pack.rate}%</small>
              </span>
              <Check aria-hidden="true" size={17} />
            </button>
          ))}
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

function PackIcon({ packId }) {
  const common = { "aria-hidden": "true", size: 19 };
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
  const selectedSpecializedSubject = categoryOptions.find((option) => option.value === settings.category);
  const ready = settings.examId !== "all" && selectedExam && (!requiresSpecializedSubject || settings.category !== "すべて");
  const questionCountLabel = requiresSpecializedSubject
    ? settings.category === "すべて"
      ? "専門科目選択後に確定"
      : selectedSpecializedSubject?.detail ?? "専門科目選択後に確定"
    : selectedExam && selectedExam.id !== "all"
      ? `${selectedExam.count}問`
      : "年度選択後に確定";
  const answerRuleLabel = settings.packId === "officer-kyouyou"
    ? "その1は英語必答を含め16問選択、その2は必答"
    : settings.packId === "officer-senmon"
      ? `${settings.category === "すべて" ? "専門科目" : settings.category}から20問選択`
      : "全問解答";
  const unavailableReason = !selectedExam || settings.examId === "all"
    ? "模試を開始するには年度を選択してください。"
    : requiresSpecializedSubject && (!selectedSpecializedSubject || settings.category === "すべて")
      ? "専門択一の模試を開始するには専門科目を選択してください。"
      : "";
  return (
    <section className="mock-setup-view">
      <div className="view-heading">
        <div>
          <h2>模試</h2>
          <p>年度を選んでから開始します。開始後は集中用レイアウトに切り替わります。</p>
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
            label="年度"
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
  secondsRemaining,
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
  const requiredAnswerCount = quiz.examMode ? getMockRequiredAnswerCount(quiz.questions) : quiz.questions.length;
  const selectionGroup = quiz.examMode ? getOfficerSelectionState(quiz.questions, quiz.selections, question) : null;
  const selectionLimitReached = quiz.examMode && isAnswerableMockQuestion(question) && !canSelectMockChoice(quiz, question);
  const mockTimeLabel = secondsRemaining === null ? "" : formatDuration(secondsRemaining);
  const mockNearlyDone = secondsRemaining !== null && secondsRemaining <= 300;
  const showOfficerNavigator = quiz.examMode && quiz.questions.some(isOfficerQuestion);

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
            quiz.examMode && isSelected ? "choice-selected" : "",
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
              {choiceShortcutKeys[index] && <kbd className="choice-shortcut">{choiceShortcutKeys[index]}</kbd>}
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

      <div className="quiz-actions">
        <span className="quiz-position">{quiz.index + 1}/{quiz.questions.length}</span>
        <div className="question-nav-actions">
          <button className="secondary-button compact" type="button" onClick={onPrevious} disabled={quiz.index === 0}>
            前へ <kbd>P</kbd>
          </button>
          <button className="primary-button compact" type="button" onClick={onNext} disabled={quiz.examMode && quiz.index === quiz.questions.length - 1}>
            次へ <kbd>N</kbd>
          </button>
        </div>
      </div>

      {reveal && (
        <div className={`feedback ${quiz.status}`}>
          <div>
            <strong>{quiz.status === "correct" ? "正解です" : quiz.status === "ungraded" ? "選択を記録しました" : "惜しいです"}</strong>
            <ExplanationText text={question.explanation} />
          </div>
        </div>
      )}
    </>
  );

  return (
    <section className="quiz-card" aria-label="クイズ">
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

      {showOfficerNavigator ? (
        <div className="officer-quiz-layout">
          <div className="officer-quiz-main">
            {questionBody}
          </div>
          <OfficerQuestionNavigator
            quiz={quiz}
            onJump={onJump}
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

function OfficerQuestionNavigator({ quiz, onJump }) {
  const groups = buildOfficerSelectionGroups(quiz.questions, quiz.selections);
  if (groups.length === 0) return null;

  return (
    <aside className="officer-question-nav" aria-label="幹部候補生の問題選択">
      <div className="officer-nav-heading">
        <strong>問題選択</strong>
        <span>区分別の回答状況</span>
      </div>
      <div className="officer-nav-legend" aria-label="表示凡例">
        <span><i className="legend-current" />表示中</span>
        <span><i className="legend-answered" />回答済み</span>
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
                  <b>{group.rule?.label ?? "区分"}</b>
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
  return (
    <section className="market-view">
      <div className="view-heading">
        <div>
          <h2>デッキマーケット</h2>
          <p>学習に使うデッキを追加して、自分用のデッキ一覧を作れます。</p>
        </div>
      </div>

      <div className="market-grid">
        {packs.map((pack) => {
          const enrolled = isVisiblePackEnabled(pack, enabledPackSet);
          const memberPackIds = pack.memberPackIds ?? [pack.id];
          const canRemove = enrolled && enabledPackSet.size > memberPackIds.length;
          const actionLabel = enrolled ? canRemove ? "学習中から外す" : "最後のデッキ" : "学習に追加";
          return (
            <article className={enrolled ? "deck-card enrolled" : "deck-card"} key={pack.id} style={{ "--deck-accent": pack.accent }}>
              <div className="deck-card-top">
                <span className="deck-symbol"><PackIcon packId={pack.id} /></span>
                <span className={enrolled ? "deck-status enrolled" : "deck-status"}>{enrolled ? "学習中" : "未追加"}</span>
              </div>
              <div>
                <h3>{pack.title}</h3>
                <p>{pack.description}</p>
              </div>
              <dl className="deck-metrics">
                <div>
                  <dt>問題</dt>
                  <dd>{pack.questionCount}</dd>
                </div>
                <div>
                  <dt>演習</dt>
                  <dd>{pack.total}</dd>
                </div>
                <div>
                  <dt>正答率</dt>
                  <dd>{pack.rate}%</dd>
                </div>
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
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => onPracticeDeck(pack.id)}
                  disabled={!enrolled}
                >
                  このデッキで演習
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ReviewView({ candidates, summary, onStartReview, onPracticeQuestion }) {
  const topCandidates = candidates.slice(0, 20);
  const wrongCount = candidates.filter((item) => (item.attempt?.wrong ?? 0) > 0).length;
  const lowAccuracyCount = candidates.filter((item) => item.accuracy !== null && item.accuracy < 70).length;

  return (
    <section className="review-view">
      <div className="view-heading">
        <div>
          <h2>復習</h2>
          <p>ミスと低正答率の問題を優先して解き直せます。</p>
        </div>
        <button className="primary-button" type="button" onClick={() => onStartReview(topCandidates)} disabled={topCandidates.length === 0}>
          <Target aria-hidden="true" size={17} />
          復習を開始
        </button>
      </div>

      <div className="metric-grid">
        <MetricCard icon={Target} label="復習候補" value={`${candidates.length}問`} />
        <MetricCard icon={X} label="ミスあり" value={`${wrongCount}問`} />
        <MetricCard icon={BarChart3} label="低正答率" value={`${lowAccuracyCount}問`} />
      </div>

      <section className="table-panel review-summary-panel">
        <h3>復習キュー</h3>
        {topCandidates.length === 0 ? (
          <p className="empty-text">まだ復習候補がありません。演習で間違えた問題や正答率の低い問題がここに表示されます。</p>
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
                  <small>{item.attempt?.total ?? 0}回演習</small>
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
