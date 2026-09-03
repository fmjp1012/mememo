import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Brain,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  Database,
  FileImage,
  FileText,
  Gauge,
  GitCompare,
  Keyboard,
  Loader2,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import "./pipelineCompare.css";

const DATASETS = [
  { id: "itpass", label: "ITパスポート", url: "/itpass/questions.json" },
  { id: "basic-info", label: "基本情報", url: "/basic-info/questions.json" },
  { id: "applied-info", label: "応用情報", url: "/applied-info/questions.json" },
  { id: "officer-kyouyou", label: "幹部候補生 一般教養", url: "/officer/kyouyou/questions.json" },
  { id: "officer-senmon", label: "幹部候補生 専門択一", url: "/officer/senmon/questions.json" },
];

const DEFAULT_PRICING = {
  inputUsdPerMillion: 0.25,
  outputUsdPerMillion: 2.0,
  usdJpy: 160,
};

const PIPELINES = [
  {
    id: "local",
    title: "Local OCR",
    summary: "PDF抽出 / Apple Vision / Tesseract を使う低コスト下書き",
    icon: FileText,
    color: "slate",
  },
  {
    id: "gptRead",
    title: "GPT Image Read",
    summary: "問題クロップ画像を正として構造化読み取り",
    icon: FileImage,
    color: "blue",
  },
  {
    id: "gptSolve",
    title: "GPT Read + Explanation",
    summary: "読み取りに加えてAI推定解答・解説まで生成",
    icon: GitCompare,
    color: "green",
  },
];

const GUIDE_STEPS = [
  {
    id: "source",
    title: "公式PDF / 公開JSON",
    detail: "出典画像を正本として保持し、後続のOCR・GPT出力はすべて比較対象として扱う。",
    icon: Database,
    tone: "slate",
  },
  {
    id: "crop",
    title: "ページ描画とクロップ",
    detail: "問題番号マーカーを検出して、ページ画像から問題単位の入力画像を作る。",
    icon: Scissors,
    tone: "blue",
  },
  {
    id: "local",
    title: "Local OCR候補",
    detail: "Apple Vision、Tesseract、PDF抽出などを走らせ、候補ごとの品質スコアを残す。",
    icon: FileText,
    tone: "green",
  },
  {
    id: "review",
    title: "疑わしい問題を抽出",
    detail: "短文、選択肢不足、ページfallback、表・数式崩れを低コストに先に見つける。",
    icon: ShieldCheck,
    tone: "amber",
  },
  {
    id: "read",
    title: "GPT Image Read",
    detail: "怪しいクロップだけを画像正として構造化し、本文・選択肢・レビュー理由を更新する。",
    icon: Brain,
    tone: "violet",
  },
  {
    id: "solve",
    title: "GPT Read + Explanation",
    detail: "解答キーがない試験だけ、AI推定解答と短い解説を生成して未検証として保存する。",
    icon: Sparkles,
    tone: "teal",
  },
];

const GUIDE_LANES = [
  {
    id: "local",
    title: "Local OCR",
    icon: FileText,
    input: "PDFテキスト、ページ画像、問題クロップ",
    output: "rawText / markdown / qualityScore / localOcrCandidates",
    when: "大量に安く下書きし、疑わしい問題を絞る段階",
    watch: "問→間、問題番号誤読、表の列崩れ、横並び選択肢",
  },
  {
    id: "gpt-read",
    title: "GPT Image Read",
    icon: FileImage,
    input: "対象問題のクロップ画像だけ",
    output: "bodyMarkdown / choices / uncertainSpans / needsReview",
    when: "Local OCRが壊れた問題を、公式画像基準で直す段階",
    watch: "fallbackページ画像、対象外問題の混入、読めない図表の捏造",
  },
  {
    id: "gpt-solve",
    title: "GPT Read + Explanation",
    icon: GitCompare,
    input: "画像、本文、選択肢、OCR文脈",
    output: "answer / answerLabel / explanation / answerConfidence",
    when: "公式解答がない幹部候補生問題の暫定解答を作る段階",
    watch: "必ず answerVerified:false。著作権で本文欠落なら解かない",
  },
];

const REVIEW_RULES = [
  ["ローカルで直す", "ページfallback、クロップずれ、問題番号マーカー誤検出", "repair_officer_question_images.py などで画像参照を修正"],
  ["GPT miniへ送る", "選択肢がプレースホルダ、短すぎる本文、表・数式・図の崩れ", "cropped image-only を優先して OCR に引っ張られないようにする"],
  ["人手レビュー", "著作権欠落、時事・法制度、英語長文、confidence低", "answerVerified は公式キーまたは手動確認後だけ true にする"],
];

const PROVENANCE_FIELDS = [
  "stage",
  "tool",
  "model",
  "mode",
  "inputImage",
  "outputEngine",
  "answerSource",
  "answerConfidence",
  "needsReview",
];

const GPT_READ_PROMPTS = {
  imageOnly: {
    title: "GPT画像読み取り: image-only",
    mode: "image-only",
    body: `You are a meticulous Japanese exam transcription specialist.
Transcribe the supplied official Japanese information-technology exam question image from scratch and return only JSON that matches the requested schema.

Rules:
- Treat the image as the only source of truth. Do not rely on any previous OCR or existing choices.
- Transcribe only the target question specified by questionNumber/source. Ignore other questions visible on the same page.
- The first question heading in text/markdown/latex must be the target question number. Do not include preceding or following questions.
- Preserve the original Japanese meaning. Do not solve or explain the problem.
- Output polished Markdown in Japanese.
- Keep text and markdown as the problem body only. Put answer choices only in choices.
- Preserve meaningful line breaks: keep paragraph, condition-list, quote, code, and table boundaries, but do not insert line breaks only because the PDF visually wrapped a long sentence.
- Use bodyMarkdown for the same problem body shown to learners, without embedded answer choices or OCR/debug labels.
- Use rawVisibleText for a faithful line-oriented transcription of all target-question text visible in the image, including choice labels.
- Convert clear tables to GitHub-flavored Markdown tables.
- Convert formulas and spreadsheet expressions into clear text and LaTeX where appropriate.
- Preserve pseudo-code indentation when visible.
- Keep answer choices with the same labels as the original question when they exist.
- If text, diagrams, table cells, shaded areas, paths, formulas, or symbols are not fully readable, return your best transcription and set needsReview=true.
- Never invent omitted numbers, table cells, labels, paths, or formulas. Put uncertain spans in uncertainSpans and explain them in reviewNotes.`,
  },
  ocrPlusImage: {
    title: "GPT OCR補正: ocr-plus-image",
    mode: "ocr-plus-image",
    body: `You are a meticulous Japanese exam transcription corrector.
Correct OCR text for a Japanese information-technology exam question using the supplied OCR text and, when present, the official page image.
Return only JSON that matches the requested schema.

Rules:
- Preserve the original Japanese meaning. Do not solve or explain the problem.
- Output polished Markdown in Japanese.
- Keep text and markdown as the problem body only. Put answer choices only in choices.
- Preserve meaningful line breaks: keep paragraph, condition-list, quote, code, and table boundaries, but do not insert line breaks only because the PDF visually wrapped a long sentence.
- Convert clear tables to GitHub-flavored Markdown tables.
- Convert formulas and spreadsheet expressions into clear text and LaTeX where appropriate.
- Preserve pseudo-code indentation when visible.
- Keep answer choices with the same labels as the original question when they exist.
- If the image/OCR is insufficient, still return your best correction and set needsReview=true.
- Never invent omitted numbers, table cells, labels, paths, or formulas. Put uncertain spans in uncertainSpans and explain them in reviewNotes.`,
  },
};

function getHashPage() {
  if (typeof window === "undefined") return "compare";
  return window.location.hash.replace(/^#\/?/, "") === "guide" ? "guide" : "compare";
}

function PageTabs({ page, onChange }) {
  return (
    <nav className="pc-page-tabs" aria-label="パイプライン比較ページ">
      <button
        type="button"
        className={page === "compare" ? "active" : ""}
        onClick={() => onChange("compare")}
      >
        <GitCompare size={16} /> 比較
      </button>
      <button
        type="button"
        className={page === "guide" ? "active" : ""}
        onClick={() => onChange("guide")}
      >
        <BookOpen size={16} /> 理解
      </button>
    </nav>
  );
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP").format(Math.round(value || 0));
}

function estimateTextTokens(text) {
  return Math.max(1, Math.ceil(normalizeText(text).length / 2.2));
}

function estimateImageTokens(question) {
  const image = question?.image || "";
  if (image.includes("/pages/")) return 1200;
  if (image.includes("/crops/")) return 900;
  return 1000;
}

function costFromTokens(inputTokens, outputTokens, pricing) {
  const usd =
    (inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  return { usd, jpy: usd * pricing.usdJpy };
}

function getLatestHistory(question, toolName) {
  const history = Array.isArray(question?.processingHistory) ? question.processingHistory : [];
  return [...history].reverse().find((item) => item.tool === toolName);
}

function getTranscription(question) {
  return question?.transcription || {};
}

function getLocalOcrCandidates(question) {
  const transcription = getTranscription(question);
  const candidates = [
    ...(transcription.localOcrCandidates || []),
    ...(transcription.ocrCandidates || []),
    ...(transcription.candidates || []),
  ].filter(Boolean);
  const seen = new Set();
  const normalized = candidates
    .map((candidate) => {
      const name = candidate.name || candidate.engine || "";
      const text = candidate.text || candidate.rawText || candidate.sample || candidate.markdown || "";
      return {
        name,
        text,
        score: candidate.score ?? candidate.qualityScore,
        seconds: candidate.seconds,
        reasons: candidate.reasons || candidate.qualityReasons || [],
        error: candidate.error,
      };
    })
    .filter((candidate) => candidate.name && !seen.has(candidate.name) && seen.add(candidate.name));
  if (normalized.length) return normalized;
  const current = transcription.previousOcr || transcription;
  return [
    {
      name: current.engine || "current local OCR",
      text: current.rawText || current.text || current.markdown || "",
      score: current.qualityScore,
      reasons: current.qualityReasons || [],
    },
  ];
}

function getChoiceText(question, choices) {
  const labels = question?.choiceLabels || [];
  return (choices || question?.choices || []).map((choice, index) => ({
    label: labels[index] || choice?.label || String(index + 1),
    text: typeof choice === "string" ? choice : choice?.text || "",
  }));
}

function buildPipelineRows(question, pricing) {
  const transcription = getTranscription(question);
  const previous = transcription.previousOcr || {};
  const body =
    transcription.bodyMarkdown ||
    transcription.markdown ||
    transcription.text ||
    transcription.rawText ||
    "";
  const rawVisible = transcription.rawVisibleText || transcription.rawText || body;
  const localBody = previous.rawText || previous.markdown || previous.text || transcription.rawText || body;
  const localInput = estimateImageTokens(question);
  const localOutput = estimateTextTokens(localBody);
  const gptReadHistory = getLatestHistory(question, "scripts/llm_correct_questions.py");
  const solveHistory = getLatestHistory(question, "scripts/solve_officer_questions.py");
  const readInput = estimateImageTokens(question) + 160;
  const readOutput = Math.max(500, estimateTextTokens(`${body}\n${JSON.stringify(question?.choices || [])}`));
  const solveInput = estimateImageTokens(question) + estimateTextTokens(`${body}\n${question?.choices?.join("\n") || ""}`) + 240;
  const solveOutput = Math.max(700, estimateTextTokens(question?.explanation || "") + 520);

  return [
    {
      id: "local",
      title: "Local OCR",
      status: previous.engine || transcription.engine?.startsWith("llm:") ? "reference" : "current",
      engine: previous.engine || transcription.engine || "local extraction",
      body: localBody,
      rawVisible: localBody,
      choices: getChoiceText(question, previous.choices || transcription.choices || question?.choices),
      explanation: "解説生成なし。公式解答がある試験は固定文、幹部候補生は別パイプラインで生成。",
      flags: [
        ...(previous.qualityScore ? [`qualityScore ${previous.qualityScore}`] : []),
        ...((transcription.qualityReasons || []).slice(0, 4)),
      ],
      needsReview: Boolean(previous.needsReview ?? transcription.needsReview),
      inputTokens: localInput,
      outputTokens: localOutput,
      cost: costFromTokens(localInput, localOutput, { ...pricing, inputUsdPerMillion: 0, outputUsdPerMillion: 0 }),
      history: previous,
    },
    {
      id: "gptRead",
      title: "GPT Image Read",
      status: transcription.engine?.includes("image-only") ? "available" : "not-run",
      engine: transcription.engine?.includes("llm:") ? transcription.engine : "not run",
      body,
      rawVisible,
      choices: getChoiceText(question, transcription.choices || question?.choices),
      explanation: "読み取り専用。解答や解説は生成しない。",
      flags: [
        ...((transcription.layoutFlags || []).slice(0, 4)),
        ...((transcription.uncertainSpans || []).slice(0, 3).map((span) => `uncertain: ${span.text || span.reason}`)),
        ...((transcription.reviewNotes || []).slice(0, 3)),
      ],
      needsReview: Boolean(transcription.needsReview),
      inputTokens: readInput,
      outputTokens: readOutput,
      cost: costFromTokens(readInput, readOutput, pricing),
      history: gptReadHistory,
    },
    {
      id: "gptSolve",
      title: "GPT Read + Explanation",
      status: question?.answerSource?.startsWith("llm:") ? "available" : question?.explanation ? "partial" : "not-run",
      engine: question?.answerSource || "official/static explanation",
      body,
      rawVisible,
      choices: getChoiceText(question, question?.choices),
      explanation: question?.explanation || "未生成",
      flags: [
        ...(question?.needsAnswerReview ? ["needsAnswerReview"] : []),
        ...(question?.answerConfidence != null ? [`confidence ${question.answerConfidence}`] : []),
        ...((question?.answerReviewNotes || []).slice(0, 3)),
      ],
      needsReview: Boolean(question?.needsAnswerReview),
      inputTokens: solveInput,
      outputTokens: solveOutput,
      cost: costFromTokens(solveInput, solveOutput, pricing),
      history: solveHistory,
    },
  ];
}

function getRunRows(question, pricing) {
  const history = Array.isArray(question?.processingHistory) ? question.processingHistory : [];
  const runs = history
    .filter((item) => item.tool?.includes("llm_correct_questions") || item.tool?.includes("solve_officer_questions"))
    .map((item, index) => {
      const usage = item.usage || {};
      const inputTokens = usage.input_tokens || usage.inputTokens || estimateImageTokens(question);
      const outputTokens = usage.output_tokens || usage.outputTokens || estimateTextTokens(item.outputExplanation || item.outputMarkdownSample || "");
      return {
        id: item.runId || `${item.tool}-${item.stage}-${index}`,
        stage: item.stage || "-",
        tool: item.tool || "-",
        model: item.model || "-",
        mode: item.mode || "-",
        promptName: item.promptName || "-",
        promptVersion: item.promptVersion || "-",
        promptHash: item.promptHash || "-",
        inputImage: item.inputImage || "-",
        outputImage: item.outputImage || "",
        status: item.status || item.outputEngine || item.answerSource || "-",
        answerLabel: item.answerLabel ?? "",
        confidence: item.answerConfidence ?? "",
        needsReview: Boolean(item.needsReview || item.needsAnswerReview),
        inputTokens,
        outputTokens,
        cost: costFromTokens(inputTokens, outputTokens, pricing),
        outputText: item.outputMarkdownSample || item.outputTextSample || item.outputExplanation || "",
        raw: item,
      };
    });

  if (runs.length) return runs;
  const transcription = getTranscription(question);
  if (!transcription.engine?.startsWith("llm:") && !question?.answerSource?.startsWith("llm:")) return [];
  const inputTokens = estimateImageTokens(question);
  const outputText = transcription.markdown || transcription.text || question?.explanation || "";
  const outputTokens = estimateTextTokens(outputText);
  return [{
    id: "current-json-llm-state",
    stage: question?.answerSource?.startsWith("llm:") ? "answer_generation" : "ocr_correction",
    tool: "current JSON state",
    model: transcription.engine?.match(/llm:([^:]+)/)?.[1] || question?.answerSource?.replace("llm:", "") || "-",
    mode: transcription.engine?.includes("image-only") ? "image-only" : "-",
    promptName: "-",
    promptVersion: "-",
    promptHash: "-",
    inputImage: question?.image || "-",
    outputImage: "",
    status: transcription.status || question?.answerSource || "-",
    answerLabel: question?.answerLabel || "",
    confidence: question?.answerConfidence ?? "",
    needsReview: Boolean(transcription.needsReview || question?.needsAnswerReview),
    inputTokens,
    outputTokens,
    cost: costFromTokens(inputTokens, outputTokens, pricing),
    outputText,
    raw: {},
  }];
}

function getCropRows(question) {
  const history = Array.isArray(question?.processingHistory) ? question.processingHistory : [];
  const repairRows = history
    .filter((item) => item.stage === "image_repair" || item.mode?.includes("crop") || item.tool?.includes("repair_officer_question_images"))
    .map((item, index) => ({
      id: item.runId || `crop-${index}`,
      source: item.tool || "local crop",
      mode: item.mode || "-",
      inputImage: item.inputImage || question?.originalImage || "-",
      outputImage: item.outputImage || question?.image || "-",
      page: item.page ?? question?.page ?? "-",
      markerText: item.markerText || (item.marker ? JSON.stringify(item.marker) : ""),
      status: item.status || "-",
    }));

  if (repairRows.length) return repairRows;
  return [{
    id: "current-image",
    source: "current JSON image fields",
    mode: question?.image?.includes("/crops/") ? "crop_image_source" : "page_image_source",
    inputImage: question?.originalImage || "-",
    outputImage: question?.image || "-",
    page: question?.page ?? "-",
    markerText: question?.questionNumber ? `questionNumber: ${question.questionNumber}` : "",
    status: question?.image?.includes("/crops/") ? "cropped" : "fallback/page",
  }];
}

function diffStats(rows) {
  const [local, read, solve] = rows;
  const localBody = normalizeText(local?.body);
  const readBody = normalizeText(read?.body);
  const solveExplanation = normalizeText(solve?.explanation);
  const choiceDelta = Math.abs((local?.choices?.length || 0) - (read?.choices?.length || 0));
  return [
    { label: "本文文字数差", value: Math.abs(localBody.length - readBody.length) },
    { label: "選択肢数差", value: choiceDelta },
    { label: "GPT読取レビュー", value: read?.needsReview ? "要確認" : "OK" },
    { label: "解説文字数", value: solveExplanation.length },
  ];
}

function StatusBadge({ status, needsReview }) {
  const label = needsReview ? "要確認" : status === "not-run" ? "未実行" : status === "partial" ? "一部あり" : "利用可";
  return <span className={`pc-status ${needsReview ? "review" : status}`}>{label}</span>;
}

function PipelineCard({ pipeline, row }) {
  const Icon = pipeline.icon;
  return (
    <section className={`pc-card pc-card-${pipeline.color}`}>
      <header className="pc-card-header">
        <div className="pc-card-title">
          <Icon size={18} />
          <div>
            <h2>{pipeline.title}</h2>
            <p>{pipeline.summary}</p>
          </div>
        </div>
        <StatusBadge status={row.status} needsReview={row.needsReview} />
      </header>

      <div className="pc-meta-row">
        <span>{row.engine}</span>
        <span>入力 {formatNumber(row.inputTokens)} tok</span>
        <span>出力 {formatNumber(row.outputTokens)} tok</span>
      </div>

      <div className="pc-section">
        <h3>問題本文</h3>
        <pre>{row.body || "読み取り結果なし"}</pre>
      </div>

      <div className="pc-section">
        <h3>選択肢</h3>
        <ol className="pc-choices">
          {row.choices?.length ? row.choices.map((choice, index) => (
            <li key={`${choice.label}-${index}`}>
              <b>{choice.label}</b>
              <span>{choice.text}</span>
            </li>
          )) : <li className="pc-muted">選択肢なし</li>}
        </ol>
      </div>

      <div className="pc-section">
        <h3>解説</h3>
        <p className="pc-explanation">{row.explanation}</p>
      </div>

      <footer className="pc-card-footer">
        <div>
          <span>推定コスト</span>
          <strong>${row.cost.usd.toFixed(5)} / ¥{row.cost.jpy.toFixed(2)}</strong>
        </div>
        <div className="pc-flags">
          {row.flags?.length ? row.flags.map((flag, index) => <span key={index}>{flag}</span>) : <span>flagsなし</span>}
        </div>
      </footer>
    </section>
  );
}

function CostTable({ rows, pricing }) {
  const total = rows.reduce(
    (acc, row) => ({
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      usd: acc.usd + row.cost.usd,
      jpy: acc.jpy + row.cost.jpy,
    }),
    { inputTokens: 0, outputTokens: 0, usd: 0, jpy: 0 },
  );

  return (
    <section className="pc-table-panel">
      <header>
        <h2><CircleDollarSign size={18} /> コスト比較</h2>
        <p>単価: input ${pricing.inputUsdPerMillion}/1M, output ${pricing.outputUsdPerMillion}/1M, USD/JPY {pricing.usdJpy}</p>
      </header>
      <div className="pc-table-wrap">
        <table>
          <thead>
            <tr>
              <th>パイプライン</th>
              <th>入力tok</th>
              <th>出力tok</th>
              <th>USD</th>
              <th>JPY</th>
              <th>レビュー</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.title}</td>
                <td>{formatNumber(row.inputTokens)}</td>
                <td>{formatNumber(row.outputTokens)}</td>
                <td>${row.cost.usd.toFixed(5)}</td>
                <td>¥{row.cost.jpy.toFixed(2)}</td>
                <td>{row.needsReview ? "要確認" : "OK"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>合計</td>
              <td>{formatNumber(total.inputTokens)}</td>
              <td>{formatNumber(total.outputTokens)}</td>
              <td>${total.usd.toFixed(5)}</td>
              <td>¥{total.jpy.toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function RunLedger({ question, pricing }) {
  const runs = getRunRows(question, pricing);
  return (
    <section className="pc-table-panel pc-wide-panel">
      <header>
        <h2><GitCompare size={18} /> モデル・プロンプト実行履歴</h2>
        <p>今後のrunは model / promptName / promptVersion / promptHash / usage / output sample を履歴に残し、この表で比較できます。</p>
      </header>
      {runs.length ? (
        <>
          <div className="pc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>stage</th>
                  <th>model</th>
                  <th>mode</th>
                  <th>prompt</th>
                  <th>hash</th>
                  <th>input</th>
                  <th>cost</th>
                  <th>review</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.stage}</td>
                    <td>{run.model}</td>
                    <td>{run.mode}</td>
                    <td>{run.promptName}<br /><span className="pc-muted">{run.promptVersion}</span></td>
                    <td>{run.promptHash}</td>
                    <td>{run.inputImage}</td>
                    <td>${run.cost.usd.toFixed(5)}<br />¥{run.cost.jpy.toFixed(2)}</td>
                    <td>{run.needsReview ? "要確認" : "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pc-run-previews">
            {runs.filter((run) => run.outputText).slice(0, 4).map((run) => (
              <article className="pc-run-preview" key={`${run.id}-preview`}>
                <strong>{run.stage} / {run.model} / {run.promptHash}</strong>
                <pre>{run.outputText}</pre>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="pc-empty-panel">この問題にはLLM実行履歴がまだありません。</p>
      )}
    </section>
  );
}

function CropTracePanel({ question }) {
  const rows = getCropRows(question);
  return (
    <section className="pc-table-panel">
      <header>
        <h2><FileImage size={18} /> クロップ・問題番号抽出</h2>
        <p>ローカルOCRで検出した問題番号マーカー、入力ページ画像、出力クロップ画像を確認します。</p>
      </header>
      <div className="pc-crop-preview-grid">
        <div>
          <h3>入力</h3>
          {rows[0]?.inputImage && rows[0].inputImage !== "-" ? <img src={rows[0].inputImage} alt="クロップ入力画像" /> : <p className="pc-muted">入力画像なし</p>}
        </div>
        <div>
          <h3>出力</h3>
          {rows[0]?.outputImage && rows[0].outputImage !== "-" ? <img src={rows[0].outputImage} alt="クロップ出力画像" /> : <p className="pc-muted">出力画像なし</p>}
        </div>
      </div>
      <div className="pc-table-wrap">
        <table>
          <thead>
            <tr>
              <th>source</th>
              <th>mode</th>
              <th>page</th>
              <th>questionNumber</th>
              <th>marker</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.source}</td>
                <td>{row.mode}</td>
                <td>{row.page}</td>
                <td>{question?.questionNumber ?? "-"}</td>
                <td>{row.markerText || "-"}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LocalOcrComparison({ question }) {
  const candidates = getLocalOcrCandidates(question);
  const apple = candidates.find((candidate) => /apple|vision/i.test(candidate.name));
  const tesseract = candidates.find((candidate) => /tess|psm/i.test(candidate.name));
  const fallback = !apple && !tesseract;
  const visible = fallback ? candidates.slice(0, 2) : [apple, tesseract].filter(Boolean);

  return (
    <section className="pc-table-panel">
      <header>
        <h2><GitCompare size={18} /> Apple Vision / Tesseract</h2>
        <p>Apple Vision はmacOS標準の画像認識OCR、Tesseract はオープンソースOCRです。候補がJSONに保存されている場合だけ全文を比較できます。</p>
      </header>
      <div className="pc-local-ocr-grid">
        {visible.map((candidate) => (
          <article className="pc-local-ocr-card" key={candidate.name}>
            <div className="pc-local-ocr-head">
              <strong>{candidate.name}</strong>
              <span>{candidate.score != null ? `score ${candidate.score}` : "scoreなし"}</span>
            </div>
            {candidate.error ? (
              <p className="pc-error-text">{candidate.error}</p>
            ) : (
              <pre>{candidate.text || "候補テキスト未保存"}</pre>
            )}
            <div className="pc-flags">
              {candidate.reasons?.length ? candidate.reasons.slice(0, 5).map((reason, index) => <span key={index}>{reason}</span>) : <span>reasonsなし</span>}
            </div>
          </article>
        ))}
      </div>
      <ul className="pc-notes pc-compact-notes">
        <li><CheckCircle2 size={16} /> Apple Vision: 日本語の自然文や印刷品質のよい画像で強い。macOS依存。</li>
        <li><CheckCircle2 size={16} /> Tesseract: ローカルで再現性が高く、PSMや前処理を変えて試せる。表・横並び・日本語の誤読は起きやすい。</li>
        <li><AlertTriangle size={16} /> 既存JSONに片方しか残っていない問題は、今後 `scripts/apply_ocr_improvements.py` を再実行すると候補比較を保存できます。</li>
      </ul>
    </section>
  );
}

function PromptPanel({ question }) {
  const history = getLatestHistory(question, "scripts/llm_correct_questions.py");
  const mode = history?.mode || (getTranscription(question).engine?.includes("image-only") ? "image-only" : "ocr-plus-image");
  const prompt = mode === "image-only" ? GPT_READ_PROMPTS.imageOnly : GPT_READ_PROMPTS.ocrPlusImage;
  return (
    <section className="pc-table-panel">
      <header>
        <h2><FileText size={18} /> GPT読み取りプロンプト</h2>
        <p>過去実行時の完全なプロンプト本文はJSONに保存されていないため、履歴の mode から現在のスクリプト上の対応プロンプトを表示します。</p>
      </header>
      <div className="pc-prompt-meta">
        <span>mode: {mode}</span>
        <span>model: {history?.model || getTranscription(question).engine?.match(/llm:([^:]+)/)?.[1] || "不明"}</span>
        <span>tool: scripts/llm_correct_questions.py</span>
      </div>
      <pre className="pc-prompt-box">{prompt.body}</pre>
    </section>
  );
}

function FlowNode({ step }) {
  const Icon = step.icon;
  return (
    <article className={`pc-flow-node tone-${step.tone}`}>
      <div className="pc-flow-icon">
        <Icon size={20} />
      </div>
      <h2>{step.title}</h2>
      <p>{step.detail}</p>
    </article>
  );
}

function PipelineGuidePage() {
  return (
    <section className="pc-guide">
      <section className="pc-guide-hero">
        <div>
          <h2>パイプライン全体像</h2>
          <p>
            公式画像を正本にして、ローカル処理で候補を広く作り、怪しい問題だけGPTに送る設計です。
            このページは、どの段階で何を見るかを一画面で追えるようにした運用マップです。
          </p>
        </div>
        <div className="pc-guide-metrics" aria-label="パイプライン要点">
          <span><strong>3</strong> 比較レーン</span>
          <span><strong>2</strong> レビュー段階</span>
          <span><strong>1</strong> 正本画像</span>
        </div>
      </section>

      <section className="pc-flow-map" aria-label="PDFから練習用JSONまでの流れ">
        {GUIDE_STEPS.map((step, index) => (
          <div className="pc-flow-item" key={step.id}>
            <FlowNode step={step} />
            {index < GUIDE_STEPS.length - 1 && (
              <div className="pc-flow-arrow" aria-hidden="true">
                <ArrowRight size={18} />
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="pc-lane-grid">
        {GUIDE_LANES.map((lane) => {
          const Icon = lane.icon;
          return (
            <article className="pc-lane" key={lane.id}>
              <header>
                <Icon size={18} />
                <h2>{lane.title}</h2>
              </header>
              <dl>
                <div>
                  <dt>入力</dt>
                  <dd>{lane.input}</dd>
                </div>
                <div>
                  <dt>出力</dt>
                  <dd>{lane.output}</dd>
                </div>
                <div>
                  <dt>使う場面</dt>
                  <dd>{lane.when}</dd>
                </div>
                <div>
                  <dt>見るポイント</dt>
                  <dd>{lane.watch}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </section>

      <section className="pc-guide-grid">
        <section className="pc-table-panel">
          <header>
            <h2><Gauge size={18} /> 次の一手の判断</h2>
            <p>コストを抑えるため、画像修復、GPT読み取り、人手レビューを切り分けます。</p>
          </header>
          <div className="pc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>判断</th>
                  <th>典型シグナル</th>
                  <th>処理</th>
                </tr>
              </thead>
              <tbody>
                {REVIEW_RULES.map(([decision, signal, action]) => (
                  <tr key={decision}>
                    <td>{decision}</td>
                    <td>{signal}</td>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="pc-table-panel">
          <header>
            <h2><ShieldCheck size={18} /> processingHistory に残すもの</h2>
            <p>あとから比較・再実行・監査できるよう、問題ごとに処理の足跡を残します。</p>
          </header>
          <div className="pc-provenance-list">
            {PROVENANCE_FIELDS.map((field) => <span key={field}>{field}</span>)}
          </div>
          <pre className="pc-provenance-code">{`{
  "stage": "ocr_correction",
  "tool": "scripts/llm_correct_questions.py",
  "model": "gpt-5-mini",
  "mode": "image-only",
  "inputImage": "/officer/crops/...",
  "needsReview": false
}`}</pre>
        </section>
      </section>

      <section className="pc-guide-checklist">
        <h2><CheckCircle2 size={18} /> 完了条件</h2>
        <div>
          <span>問題画像がcropを指している</span>
          <span>本文に選択肢が重複していない</span>
          <span>rawタグやOCRラベルが見えない</span>
          <span>未検証AI解答は official と混ぜない</span>
          <span>履歴から model / prompt / 入力画像を追える</span>
        </div>
      </section>
    </section>
  );
}

function ComparePage() {
  const [datasetId, setDatasetId] = useState("itpass");
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [examId, setExamId] = useState("");
  const [questionId, setQuestionId] = useState("");
  const [pricing, setPricing] = useState(DEFAULT_PRICING);

  const dataset = DATASETS.find((item) => item.id === datasetId) || DATASETS[0];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(dataset.url)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      })
      .then((items) => {
        if (cancelled) return;
        setQuestions(items);
        const firstExam = items[0]?.examId || "";
        const firstQuestion = items.find((item) => item.examId === firstExam) || items[0];
        setExamId(firstExam);
        setQuestionId(firstQuestion?.id || "");
      })
      .catch((loadError) => {
        if (!cancelled) setError(String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset.url]);

  const exams = useMemo(() => {
    const byId = new Map();
    for (const question of questions) {
      if (!byId.has(question.examId)) byId.set(question.examId, []);
      byId.get(question.examId).push(question);
    }
    return [...byId.entries()].map(([id, items]) => ({ id, count: items.length }));
  }, [questions]);

  const filteredQuestions = useMemo(
    () => questions.filter((question) => question.examId === examId),
    [questions, examId],
  );

  useEffect(() => {
    if (!filteredQuestions.length) return;
    if (!filteredQuestions.some((question) => question.id === questionId)) {
      setQuestionId(filteredQuestions[0].id);
    }
  }, [filteredQuestions, questionId]);

  const moveQuestion = (direction) => {
    if (!filteredQuestions.length) return;
    const currentIndex = Math.max(0, filteredQuestions.findIndex((item) => item.id === questionId));
    const nextIndex = (currentIndex + direction + filteredQuestions.length) % filteredQuestions.length;
    setQuestionId(filteredQuestions[nextIndex].id);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const tagName = event.target?.tagName;
      if (tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key === "n") {
        event.preventDefault();
        moveQuestion(1);
      }
      if (event.key === "p") {
        event.preventDefault();
        moveQuestion(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filteredQuestions, questionId]);

  const question = filteredQuestions.find((item) => item.id === questionId) || filteredQuestions[0];
  const rows = useMemo(() => (question ? buildPipelineRows(question, pricing) : []), [question, pricing]);
  const stats = useMemo(() => diffStats(rows), [rows]);

  return (
    <>
      <section className="pc-controls">
        <label htmlFor="pc-dataset">
          <span>データセット</span>
          <select id="pc-dataset" aria-label="データセット" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
            {DATASETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label htmlFor="pc-exam">
          <span>試験回</span>
          <select id="pc-exam" aria-label="試験回" value={examId} onChange={(event) => setExamId(event.target.value)}>
            {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.id} ({exam.count})</option>)}
          </select>
        </label>
        <label htmlFor="pc-question">
          <span>問題</span>
          <select id="pc-question" aria-label="問題" value={questionId} onChange={(event) => setQuestionId(event.target.value)}>
            {filteredQuestions.map((item) => (
              <option key={item.id} value={item.id}>
                問{item.questionNumber ?? "-"} {item.id}
              </option>
            ))}
          </select>
        </label>
        <div className="pc-nav-buttons" aria-label="問題移動">
          <button type="button" onClick={() => moveQuestion(-1)}>
            <Keyboard size={16} /> 前へ p
          </button>
          <button type="button" onClick={() => moveQuestion(1)}>
            <Keyboard size={16} /> 次へ n
          </button>
        </div>
        <button type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={16} /> 再読込
        </button>
      </section>

      <details className="pc-cost-details">
        <summary><CircleDollarSign size={16} /> 単価設定</summary>
        <section className="pc-cost-controls">
          <label htmlFor="pc-input-price">
            <span>Input $/1M</span>
            <input
              id="pc-input-price"
              aria-label="Input $/1M"
              type="number"
              step="0.01"
              value={pricing.inputUsdPerMillion}
              onChange={(event) => setPricing((current) => ({ ...current, inputUsdPerMillion: Number(event.target.value) }))}
            />
          </label>
          <label htmlFor="pc-output-price">
            <span>Output $/1M</span>
            <input
              id="pc-output-price"
              aria-label="Output $/1M"
              type="number"
              step="0.01"
              value={pricing.outputUsdPerMillion}
              onChange={(event) => setPricing((current) => ({ ...current, outputUsdPerMillion: Number(event.target.value) }))}
            />
          </label>
          <label htmlFor="pc-usd-jpy">
            <span>USD/JPY</span>
            <input
              id="pc-usd-jpy"
              aria-label="USD/JPY"
              type="number"
              step="1"
              value={pricing.usdJpy}
              onChange={(event) => setPricing((current) => ({ ...current, usdJpy: Number(event.target.value) }))}
            />
          </label>
        </section>
      </details>

      {loading && (
        <div className="pc-state"><Loader2 className="pc-spin" /> 読み込み中</div>
      )}
      {error && (
        <div className="pc-state pc-error"><AlertTriangle /> {error}</div>
      )}
      {!loading && !error && question && (
        <>
          <section className="pc-summary">
            <div className="pc-image-panel">
              <header>
                <h2><FileImage size={18} /> 公式画像</h2>
                <p>{question.prompt}</p>
              </header>
              <img src={question.image} alt={`${question.prompt} 公式問題画像`} />
            </div>
            <div className="pc-kpi-grid">
              {stats.map((stat) => (
                <div className="pc-kpi" key={stat.label}>
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </div>
              ))}
              <div className="pc-kpi">
                <span>現在の解答</span>
                <strong>{question.answerLabel ?? question.answerKana ?? (Number.isInteger(question.answer) ? question.answer + 1 : "-")}</strong>
              </div>
              <div className="pc-kpi">
                <span>画像種別</span>
                <strong>{question.image?.includes("/crops/") ? "crop" : "page"}</strong>
              </div>
            </div>
          </section>

          <section className="pc-pipelines">
            {PIPELINES.map((pipeline) => (
              <PipelineCard key={pipeline.id} pipeline={pipeline} row={rows.find((row) => row.id === pipeline.id)} />
            ))}
          </section>

          <section className="pc-analysis">
            <CostTable rows={rows} pricing={pricing} />
            <RunLedger question={question} pricing={pricing} />
            <CropTracePanel question={question} />
            <LocalOcrComparison question={question} />
            <PromptPanel question={question} />
            <section className="pc-table-panel">
              <header>
                <h2><Gauge size={18} /> 比較メモ</h2>
                <p>この画面は既存JSONの記録を読みます。未実行パイプラインは推定値と現在値で表示します。</p>
              </header>
              <ul className="pc-notes">
                <li><CheckCircle2 size={16} /> `llm:gpt-5-mini:image-only` の記録がある問題は GPT画像読み取り済みとして表示します。</li>
                <li><Calculator size={16} /> コストは画面上の単価で再計算できます。実API使用量が `processingHistory` にない場合は文字数と画像種別から推定します。</li>
                <li><AlertTriangle size={16} /> `needsReview`、`uncertainSpans`、`answerReviewNotes` がある問題は要確認として扱います。</li>
              </ul>
            </section>
          </section>
        </>
      )}
    </>
  );
}

export default function PipelineCompareApp() {
  const [page, setPage] = useState(getHashPage);
  const title = page === "guide"
    ? "問題読み取り・解説生成 パイプライン理解"
    : "問題読み取り・解説生成 パイプライン比較";
  const description = page === "guide"
    ? "PDFから練習用JSONまでの流れ、判断基準、履歴に残す項目を視覚的に確認します。"
    : "同じ試験回・同じ問題で読み取り品質、レビュー状態、推定コストを比較します。";

  useEffect(() => {
    const onHashChange = () => setPage(getHashPage());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = (nextPage) => {
    window.location.hash = nextPage === "guide" ? "#/guide" : "#/compare";
    setPage(nextPage);
  };

  return (
    <main className="pc-app">
      <header className="pc-topbar">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <PageTabs page={page} onChange={navigate} />
      </header>
      {page === "guide" ? <PipelineGuidePage /> : <ComparePage />}
    </main>
  );
}
