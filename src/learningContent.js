
export const learningPacks = [
  {
    id: "bookkeeping-2",
    label: "日商簿記2級",
    title: "日商簿記2級 商業簿記・工業簿記",
    description: "2026年度適用の出題区分を参照したオリジナル問題で、商業簿記と工業簿記を演習。",
    exam: "228問 / 四肢択一 / 解説あり",
    totalQuestions: 228,
    accent: "#295f63",
    dataUrl: "/api/questions/bookkeeping-2",
  },
  {
    id: "bookkeeping-3",
    label: "日商簿記3級",
    title: "日商簿記3級 商業簿記",
    description: "2026年度適用の出題区分を参照したオリジナル問題で、仕訳・帳簿・決算を演習。",
    exam: "126問 / 四肢択一 / 解説あり",
    totalQuestions: 126,
    accent: "#8a6230",
    dataUrl: "/api/questions/bookkeeping-3",
  },
  {
    id: "officer-kyouyou",
    label: "一般幹部候補生等 一般教養",
    title: "自衛隊幹部候補生等 一般教養",
    description: "防衛省・自衛隊が公開している幹部候補生等試験の一般教養問題を演習。",
    exam: "347問 / 五肢択一 / 解答未収録",
    totalQuestions: 93,
    accent: "#476a3b",
    dataUrl: "/api/questions/officer-kyouyou",
  },
  {
    id: "officer-senmon",
    label: "一般幹部候補生等 専門択一",
    title: "自衛隊幹部候補生等 専門択一",
    description: "防衛省・自衛隊が公開している幹部候補生等試験の専門択一問題を演習。",
    exam: "540問 / 五肢択一 / 解答未収録",
    totalQuestions: 180,
    accent: "#6d5b2d",
    dataUrl: "/api/questions/officer-senmon",
  },
];

export const officerCandidatePackIds = ["officer-kyouyou", "officer-senmon"];
export const bookkeepingPackIds = ["bookkeeping-2", "bookkeeping-3"];
export const totalCatalogQuestions = learningPacks.reduce((total, pack) => total + pack.totalQuestions, 0);
export const freeQuestionsPerPack = 12;

const latestOfficerExamIds = new Set([
  "r7-1-kyouyou",
  "r7-2-kyouyou",
  "r7-1-senmon",
  "r7-2-senmon",
]);

export const visibleLearningPacks = [
  ...learningPacks.filter((pack) => bookkeepingPackIds.includes(pack.id)),
  {
    id: "officer-candidate",
    label: "一般幹部候補生等 一般教養・専門択一",
    title: "一般幹部候補生等採用試験",
    description: "防衛省・自衛隊が公開している幹部候補生等試験の最新1年分を演習。",
    exam: "272問 / 五肢択一 / AI推定解答あり",
    totalQuestions: 273,
    accent: "#476a3b",
    memberPackIds: officerCandidatePackIds,
  },
];

function normalizeQuestion(question) {
  const pack = learningPacks.find((item) => item.id === question.packId);
  const transcriptionText = [
    question.transcription?.rawText,
    question.transcription?.markdown,
    ...(question.transcription?.choices ?? []).map((choice) => choice.text),
  ].filter(Boolean).join(" ");
  return {
    ...question,
    isCopyrightUnavailable: hasUnavailableCopyrightText(question),
    unavailableReason: hasUnavailableCopyrightText(question)
      ? "この問題は著作権の関係により問題文を表示できません。"
      : question.unavailableReason,
    packLabel: pack?.label ?? question.packId,
    searchText: `${pack?.label ?? question.packId} ${question.subject} ${question.category} ${question.difficulty} ${question.prompt} ${question.source ?? ""} ${question.searchText ?? ""} ${transcriptionText}`.toLowerCase(),
  };
}

export let questionBank = [];

let questionBankPromise;
let questionBankAccessKey = "";

export async function loadQuestionBank({ accessToken = "", force = false } = {}) {
  const accessKey = accessToken ? "authenticated" : "anonymous";
  if (!force && questionBank.length > 0 && questionBankAccessKey === accessKey) return questionBank;
  if (force || questionBankAccessKey !== accessKey) {
    questionBank = [];
    questionBankPromise = null;
  }
  questionBankAccessKey = accessKey;
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  questionBankPromise ??= Promise.all(
    learningPacks.map((pack) =>
      fetch(`/api/questions/${pack.id}`, { headers, credentials: "same-origin" })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to load ${pack.label} questions: ${response.status}`);
          }
          return response.json();
        })
    )
  )
    .then((packs) => {
      questionBank = packs.flat().filter(isUsableQuestion).map(normalizeQuestion);
      return questionBank;
    });
  return questionBankPromise;
}

function isUsableQuestion(question) {
  if (officerCandidatePackIds.includes(question.packId) && !latestOfficerExamIds.has(question.examId)) {
    return false;
  }
  const isCopyrightUnavailable = hasUnavailableCopyrightText(question);
  if (officerCandidatePackIds.includes(question.packId) && !Number.isInteger(question.answer)) {
    return false;
  }
  return !isCopyrightUnavailable;
}

function hasUnavailableCopyrightText(question) {
  const text = [
    question.transcription?.rawText,
    question.transcription?.text,
    question.transcription?.markdown,
  ].filter(Boolean).join("\n");
  return /著作権の関係[^。\n]*(掲載できません|掲載できない)/.test(text);
}

export const defaultEnabledPacks = [...bookkeepingPackIds];

export function getPack(packId) {
  return learningPacks.find((pack) => pack.id === packId);
}
