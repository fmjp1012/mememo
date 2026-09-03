#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const OFFICIAL_SCOPE_URL = "https://www.kentei.ne.jp/bookkeeping/35697-2";
const OFFICIAL_EXAM_URL = "https://www.kentei.ne.jp/32364";
const SOURCE_NOTICE = "日本商工会議所の2026年度適用出題区分を参照したオリジナル問題";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const sourcePath = path.resolve(readArg("--source") || "/Users/fmjp/Desktop/boki/src/questionBank.js");
const outputRoot = path.resolve(readArg("--output-root") || "public/bookkeeping");
const { questionBank: legacyQuestions } = await import(pathToFileURL(sourcePath));

function numberFrom(value) {
  const match = String(value).match(/[0-9][0-9,]*(?:\.[0-9]+)?/);
  return match ? Number(match[0].replaceAll(",", "")) : Number.NaN;
}

function formatYen(value) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function formatNumber(value) {
  return Math.round(value).toLocaleString("ja-JP");
}

function rotatedChoices(correct, distractors, seed) {
  const choices = [correct, ...distractors];
  const offset = seed % choices.length;
  const rotated = [...choices.slice(offset), ...choices.slice(0, offset)];
  return { choices: rotated, answer: rotated.indexOf(correct) };
}

function variantNumber(question) {
  return Number(question.id.match(/-(\d+)$/)?.[1] || 1);
}

function addCorrection(question, correction, reason) {
  return {
    ...question,
    ...correction,
    editorialCorrection: reason,
  };
}

function correctLegacyQuestion(question) {
  const seed = variantNumber(question) - 1;

  if (question.id.startsWith("g3-04-")) {
    const amount = numberFrom(question.choices[question.answer]);
    const correct = `減価償却費 ${formatNumber(amount)} / 減価償却累計額 ${formatNumber(amount)}`;
    const choiceSet = rotatedChoices(correct, [
      `減価償却累計額 ${formatNumber(amount)} / 減価償却費 ${formatNumber(amount)}`,
      `備品 ${formatNumber(amount)} / 減価償却費 ${formatNumber(amount)}`,
      `減価償却費 ${formatNumber(amount)} / 備品 ${formatNumber(amount)}`,
    ], seed);
    return addCorrection(question, {
      prompt: `期末に備品の減価償却費${formatYen(amount)}を間接法で計上する。正しい仕訳は？`,
      ...choiceSet,
      explanation: "3級では間接法を前提とし、減価償却費を借方、減価償却累計額を貸方に計上します。固定資産を直接減額する直接法は2級以上の範囲です。",
    }, "3級の出題範囲に合わせ、直接法から間接法へ修正");
  }

  if (question.id.startsWith("g3-06-")) {
    const months = Number(question.prompt.match(/期末に(\d+)か月分/)?.[1] || 1);
    const monthlyRent = (seed + 1) * 10_000;
    const prepaid = monthlyRent * months;
    const correct = `前払家賃 ${formatNumber(prepaid)} / 支払家賃 ${formatNumber(prepaid)}`;
    const choiceSet = rotatedChoices(correct, [
      `支払家賃 ${formatNumber(prepaid)} / 前払家賃 ${formatNumber(prepaid)}`,
      `未払家賃 ${formatNumber(prepaid)} / 支払家賃 ${formatNumber(prepaid)}`,
      `前払家賃 ${formatNumber(monthlyRent)} / 支払家賃 ${formatNumber(monthlyRent)}`,
    ], seed);
    return addCorrection(question, {
      prompt: `月額${formatYen(monthlyRent)}の家賃を支払い、期末に${months}か月分が未経過である。正しい決算整理仕訳は？`,
      ...choiceSet,
      explanation: `未経過分は翌期の費用なので前払家賃へ振り替えます。${formatYen(monthlyRent)} × ${months}か月 = ${formatYen(prepaid)}です。`,
    }, "端数処理に依存しない月額ベースの設問へ修正");
  }

  if (question.id.startsWith("g3-11-")) {
    const amount = numberFrom(question.choices[question.answer]);
    return addCorrection(question, {
      prompt: `会社設立時に株主から${formatYen(amount)}の払込みを普通預金で受け、全額を資本金とした。正しい仕訳は？`,
      explanation: "設立時の払込金を全額資本金とする場合、普通預金の増加を借方、資本金の増加を貸方に記入します。",
    }, "3級の基礎的な資本取引であることが明確になるよう設問を具体化");
  }

  if (question.id.startsWith("g2c-05-")) {
    return addCorrection(question, {
      prompt: question.prompt.replace("償却原価法では", "額面と取得価額の差額が金利調整差額であるとき、償却原価法では"),
      explanation: "額面より低い価額で取得し、その差額が金利調整差額である場合、差額を満期まで配分して帳簿価額を額面に近づけるため、帳簿価額は増加します。",
    }, "償却原価法を適用する前提条件を追記");
  }

  if (question.id.startsWith("g2c-09-")) {
    return addCorrection(question, {
      prompt: "貸倒引当金の損金算入限度超過額など、将来減算一時差異から生じる税効果として計上する科目は？",
      explanation: "将来減算一時差異は将来の課税所得を減らすため、回収可能性がある範囲で繰延税金資産を計上します。2級では引当金などに関する一時差異が対象です。",
    }, "2級の税効果会計の対象範囲が分かる具体例を追加");
  }

  if (question.id.startsWith("g2c-14-")) {
    return addCorrection(question, {
      prompt: question.prompt.replace("将来の収益獲得が確実である", "将来の収益獲得または費用削減が確実である"),
      explanation: "自社利用ソフトウェアは、将来の収益獲得または費用削減が確実と認められる場合、無形固定資産のソフトウェアとして計上します。",
    }, "自社利用ソフトウェアの資産計上要件を正確化");
  }

  if (question.id.startsWith("g2i-10-")) {
    return addCorrection(question, {
      explanation: `${question.explanation.replace("です。", "です")}。販売量は整数で必要なため、端数は切り上げます。`,
    }, "損益分岐点販売量の端数切上げを明記");
  }

  if (question.id === "theory-010") {
    const choiceSet = rotatedChoices("期間原価として当期の費用にする", [
      "変動製造原価とともに製品原価へ含める",
      "非原価項目として処理する",
      "仕掛品原価だけに含める",
    ], seed);
    return addCorrection(question, {
      prompt: "直接原価計算では、固定製造原価をどのように処理する？",
      ...choiceSet,
      explanation: "直接原価計算では、変動製造原価だけを製品原価に含め、固定製造原価は発生した期間の期間原価として処理します。",
    }, "問い方と誤答選択肢を実務的な内容へ改善");
  }

  return question;
}

function normalizeQuestion(question, questionNumber) {
  const corrected = correctLegacyQuestion(question);
  const packId = corrected.level === "2級" ? "bookkeeping-2" : "bookkeeping-3";
  const sourceId = corrected.id;
  const id = `bookkeeping-${corrected.level === "2級" ? "2" : "3"}-${sourceId}`;
  const processingHistory = [
    {
      stage: "dataset-import",
      tool: "scripts/import_bookkeeping_questions.mjs",
      mode: "legacy-original-question-migration",
      sourceId,
      sourceFile: path.basename(sourcePath),
      outputStatus: "imported",
    },
  ];
  if (corrected.editorialCorrection) {
    processingHistory.push({
      stage: "editorial-review",
      tool: "scripts/import_bookkeeping_questions.mjs",
      mode: "2026-syllabus-alignment",
      reason: corrected.editorialCorrection,
      officialScopeUrl: OFFICIAL_SCOPE_URL,
      outputStatus: "corrected",
    });
  }

  return {
    id,
    packId,
    subject: corrected.subject,
    category: corrected.category,
    difficulty: corrected.difficulty,
    prompt: corrected.prompt,
    choices: corrected.choices,
    choiceLabels: ["A", "B", "C", "D"],
    answer: corrected.answer,
    explanation: corrected.explanation,
    source: SOURCE_NOTICE,
    sourceUrl: OFFICIAL_SCOPE_URL,
    examGuideUrl: OFFICIAL_EXAM_URL,
    examId: `${packId}-2026-original`,
    examTitle: "2026年度対応 オリジナル演習",
    questionNumber,
    copyright: "オリジナル問題（日本商工会議所の公式問題ではありません）",
    answerSource: "mememo-editorial",
    answerVerified: true,
    officialAnswer: false,
    syllabusVersion: "2022年度適用区分（2026年度試験にも適用）",
    transcription: {
      status: "editorial_reviewed",
      language: "ja",
      format: "plain",
      engine: "legacy-original+mememo-editorial",
      rawText: corrected.prompt,
      text: corrected.prompt,
      markdown: corrected.prompt,
      choices: corrected.choices.map((text, index) => ({ label: ["A", "B", "C", "D"][index], text })),
      needsReview: false,
      reviewNotes: corrected.editorialCorrection ? [corrected.editorialCorrection] : [],
    },
    searchText: `${corrected.level} ${corrected.subject} ${corrected.category} ${corrected.difficulty} ${corrected.prompt} ${corrected.choices.join(" ")}`,
    processingHistory,
  };
}

const byLevel = new Map([["2級", []], ["3級", []]]);
for (const question of legacyQuestions) {
  const items = byLevel.get(question.level);
  if (!items) throw new Error(`Unsupported bookkeeping level: ${question.level}`);
  items.push(normalizeQuestion(question, items.length + 1));
}

for (const [level, questions] of byLevel) {
  const ids = new Set();
  for (const question of questions) {
    if (ids.has(question.id)) throw new Error(`Duplicate id: ${question.id}`);
    ids.add(question.id);
    if (question.choices.length !== 4) throw new Error(`Invalid choice count: ${question.id}`);
    if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.choices.length) {
      throw new Error(`Invalid answer: ${question.id}`);
    }
    if (!question.explanation) throw new Error(`Missing explanation: ${question.id}`);
  }

  const directory = path.join(outputRoot, level === "2級" ? "level2" : "level3");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "questions.json"), `${JSON.stringify(questions, null, 2)}\n`);
  console.log(`${level}: ${questions.length} questions -> ${directory}/questions.json`);
}

const audit = {
  generatedAt: new Date().toISOString(),
  sourceFile: path.basename(sourcePath),
  officialReferences: {
    syllabus: OFFICIAL_SCOPE_URL,
    examFormat: OFFICIAL_EXAM_URL,
    syllabusVersion: "2022年度適用区分（2026年度試験にも適用）",
  },
  packs: Object.fromEntries([...byLevel].map(([level, questions]) => [level, {
    questions: questions.length,
    editorialCorrections: questions.filter((question) =>
      question.processingHistory.some((item) => item.stage === "editorial-review")
    ).length,
    subjects: Object.fromEntries([...new Set(questions.map((question) => question.subject))].map((subject) => [
      subject,
      questions.filter((question) => question.subject === subject).length,
    ])),
  }])),
  validation: {
    duplicateIds: 0,
    invalidChoiceCounts: 0,
    duplicateChoices: 0,
    invalidAnswers: 0,
    missingExplanations: 0,
    missingProcessingHistory: 0,
  },
  limitations: [
    "日本商工会議所の公式問題・公式解答ではなく、出題区分を参照したオリジナル四肢択一問題です。",
    "同じ論点で数値だけを変えた計算・仕訳バリエーションを含みます。",
    "アプリの基礎確認模試は本試験の大問構成や入力式を完全には再現していません。",
  ],
};
await writeFile(path.join(outputRoot, "audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(`Audit -> ${path.join(outputRoot, "audit.json")}`);
