
export const learningPacks = [
  {
    id: "itpass",
    label: "ITパスポート試験",
    title: "ITパスポート公式公開問題",
    description: "IPAが公開しているITパスポート試験の公式過去問題を出典付きで演習。",
    exam: "2,900問 / 四肢択一",
    accent: "#1f7ecf",
    dataUrl: "/itpass/questions.json",
  },
  {
    id: "basic-info",
    label: "基本情報技術者試験",
    title: "基本情報技術者試験 公開問題",
    description: "IPAが公開している基本情報技術者試験の最新3年度分の科目A・Bデッキを演習。",
    exam: "78問 / 四肢択一",
    accent: "#267a83",
    dataUrl: "/basic-info/questions.json",
  },
  {
    id: "applied-info",
    label: "応用情報技術者試験",
    title: "応用情報技術者試験 午前公開問題",
    description: "IPAが公開している応用情報技術者試験の最新3回分の午前問題を演習。",
    exam: "240問 / 四肢択一",
    accent: "#7a4f9a",
    dataUrl: "/applied-info/questions.json",
  },
  {
    id: "officer-kyouyou",
    label: "一般幹部候補生等 一般教養",
    title: "自衛隊幹部候補生等 一般教養",
    description: "防衛省・自衛隊が公開している幹部候補生等試験の一般教養問題を演習。",
    exam: "347問 / 五肢択一 / 解答未収録",
    accent: "#476a3b",
    dataUrl: "/officer/kyouyou/questions.json",
  },
  {
    id: "officer-senmon",
    label: "一般幹部候補生等 専門択一",
    title: "自衛隊幹部候補生等 専門択一",
    description: "防衛省・自衛隊が公開している幹部候補生等試験の専門択一問題を演習。",
    exam: "540問 / 五肢択一 / 解答未収録",
    accent: "#6d5b2d",
    dataUrl: "/officer/senmon/questions.json",
  },
];

export const officerCandidatePackIds = ["officer-kyouyou", "officer-senmon"];

const latestOfficerExamIds = new Set([
  "r7-1-kyouyou",
  "r7-2-kyouyou",
  "r7-1-senmon",
  "r7-2-senmon",
]);

export const visibleLearningPacks = [
  ...learningPacks.filter((pack) => !officerCandidatePackIds.includes(pack.id)),
  {
    id: "officer-candidate",
    label: "一般幹部候補生等 一般教養・専門択一",
    title: "一般幹部候補生等採用試験",
    description: "防衛省・自衛隊が公開している幹部候補生等試験の最新1年分を演習。",
    exam: "272問 / 五肢択一 / AI推定解答あり",
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

export async function loadQuestionBank() {
  if (questionBank.length > 0) return questionBank;
  questionBankPromise ??= Promise.all(
    learningPacks.map((pack) =>
      fetch(pack.dataUrl)
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
  if (officerCandidatePackIds.includes(question.packId) && !Number.isInteger(question.answer) && !isCopyrightUnavailable) {
    return false;
  }
  return !isCopyrightUnavailable || officerCandidatePackIds.includes(question.packId);
}

function hasUnavailableCopyrightText(question) {
  const text = [
    question.transcription?.rawText,
    question.transcription?.text,
    question.transcription?.markdown,
  ].filter(Boolean).join("\n");
  return /著作権の関係[^。\n]*(掲載できません|掲載できない)/.test(text);
}

export const defaultEnabledPacks = learningPacks.map((pack) => pack.id);

export function getPack(packId) {
  return learningPacks.find((pack) => pack.id === packId);
}
