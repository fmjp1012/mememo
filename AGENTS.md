# Agent Notes

This repository is a local React/Vite learning app for official exam questions.
When adding or refreshing exam datasets, keep the current IT Passport latest
exam UI as the reference shape: one clean problem text box, separate answer
choice cards, official PDF image per target question, and no OCR/debug labels in
the visible UI.

## Dataset Generation Flow

For future dataset refreshes, compare multiple local OCR candidates first,
score their quality, then use GPT-5 mini only for suspicious questions. Do not
rely on a single Tesseract pass for image-based official PDFs when Apple Vision
OCR is available on the Mac.

1. Download/render official PDFs and build initial datasets:

```sh
/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build_ipa_latest_datasets.py
```

For only one pack:

```sh
/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build_ipa_latest_datasets.py --pack-id applied-info
```

Current generated IPA datasets:

- `public/basic-info/questions.json`
- `public/applied-info/questions.json`
- rendered pages under `public/{basic-info,applied-info}/pages/...`
- per-question crops under `public/{basic-info,applied-info}/crops/...`

IT Passport latest crop generation is handled separately:

```sh
/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/crop_latest_itpass_questions.py
```

## OCR Details

The local OCR stack is:

- PDF rendering: `pdftoppm`
- OCR candidates: Apple Vision OCR and Tesseract with Japanese model
- tessdata path: `data/itpass/.cache/tessdata`

The preferred local OCR improvement flow is:

1. Run multiple OCR candidates for each target image/page, including Apple
   Vision (`scripts/ocr_apple_vision.swift`) and Tesseract best PSM variants.
2. Score each candidate with `suspicious_score()` from
   `scripts/evaluate_ocr_methods.py`.
3. Select the lowest-score candidate as the local OCR result.
4. Mark questions as `ocr_needs_review` when layout flags are present, the
   quality score is high, or the expected choice count is missing.
5. Send suspicious cropped question images to GPT-5 mini in `--image-only` mode
   when possible, so the model is not anchored by bad local OCR.

For 4-choice exams, the expected choice count is 4. For JSDF
officer-candidate questions, adjust the quality checks for numeric 5-choice
questions.

The IPA builder first tries `pypdf` text extraction. If the PDF is image-based
or has poor embedded text, it falls back to Tesseract OCR on rendered page
images and then on per-question crops.

Known OCR problems:

- `問` is often recognized as `間`.
- question numbers may be misread, such as `問19` -> `問194`.
- tables, formulas, diagrams, and horizontally aligned choices often break
choice extraction.
- Applied Information PDFs are image-heavy; do not trust Tesseract-only output
for all questions.

## GPT-5 Mini Correction Flow

Use GPT-5 mini via `scripts/llm_correct_questions.py` only after local OCR/crops
exist. Do not print `.env` or API key values.

The correction script loads `.env` automatically and defaults to `gpt-5-mini`.
Use image-only mode when OCR is suspicious:

```sh
/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/llm_correct_questions.py \
  --questions-json public/applied-info/questions.json \
  --ids-file tmp/applied-info-llm-targets.txt \
  --image-only \
  --apply \
  --timeout 180 \
  --sleep 0.3
```

Recommended target selection:

- choices are only `ア|イ|ウ|エ`
- OCR text is very short
- text starts with a question number that clearly matches the target
- image path is a per-question crop (`/crops/`), not a fallback page image

Avoid sending fallback page images like `/applied-info/pages/.../page-01.jpg`
unless the target question is definitely visible in that image. Wrong images
lead to plausible but incorrect transcriptions.

For JSDF officer-candidate datasets, generate local OCR/crops first:

```sh
/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build_officer_latest_datasets.py
```

The officer-candidate PDFs are image-based and require OCR. The Defense
Ministry PDF download path must use a browser-like `User-Agent`, which
`scripts/build_officer_latest_datasets.py` already sets. Current officer packs
are:

- `public/officer/kyouyou/questions.json` for 一般教養, 6 exams x 60 questions
- `public/officer/senmon/questions.json` for 専門択一, 6 exams x 90 questions
- `public/officer/questions.json` combined from the two files

## Low-Cost Officer Cleanup Pipeline

Before sending officer-candidate questions to an LLM, run the local repair and
audit passes. This is the preferred low-cost pipeline for R7, older officer
exam rounds, and future public-service exam PDFs with similar scanned layouts:

1. Render/build the raw dataset with `scripts/build_officer_latest_datasets.py`.
2. Repair question images locally by detecting `No.` markers from rendered page
   OCR and creating per-question crops:

```sh
/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/repair_officer_question_images.py \
  --exam-prefix r7- \
  --apply
```

For one PDF/part during debugging:

```sh
/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/repair_officer_question_images.py \
  --part-id r7_2_senmon \
  --apply
```

Run without `--apply` first when changing marker logic. The repair script is
local-only and must preserve existing transcription/answer fields; it updates
`image`, `images`, `imageResource`, `page`, and appends `processingHistory`.
If a section has repeated numbering, keep marker assignment section-scoped so
`その1 No.17` can never be repaired with `その2 No.17`.

3. Audit readiness and write focused target lists:

```sh
/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/audit_officer_dataset.py \
  --exam-prefix r7- \
  --write-targets \
  --target-prefix officer-r7
```

This writes lists such as:

- `tmp/officer-r7-generic-choices.txt`
- `tmp/officer-r7-page-fallbacks.txt`
- `tmp/officer-r7-no-answer.txt`
- `tmp/officer-r7-answer-review.txt`

Use those lists to decide the cheapest next pass:

- Fix page/crop problems locally first; do not send fallback page images to an
  LLM unless the target question is definitely visible and isolated enough.
- Send cropped `generic_choices` and `no_answer` IDs to GPT-5 mini first.
- Treat `answer_review` as a smaller second pass for manual/LLM verification.
- Keep `copyright_blocked` questions excluded unless the missing passage is not
  required to answer.

Current R7 visibility policy: `src/learningContent.js` only exposes latest
officer exam IDs (`r7-1-kyouyou`, `r7-2-kyouyou`, `r7-1-senmon`,
`r7-2-senmon`). Older rounds remain in JSON but are hidden until their cleanup
quality is acceptable.

For officer GPT-5 mini correction, target cropped images first. Avoid sending
fallback page images such as `/officer/pages/.../page-01.jpg` unless the target
question is definitely visible and isolated enough for reliable transcription.

Example target-list generation for officer crops with numeric placeholder
choices:

```sh
node - <<'NODE'
const fs = require('fs');
for (const [input, output] of [
  ['public/officer/kyouyou/questions.json', 'tmp/officer-kyouyou-llm-targets.txt'],
  ['public/officer/senmon/questions.json', 'tmp/officer-senmon-llm-targets.txt'],
]) {
  const qs = JSON.parse(fs.readFileSync(input, 'utf8'));
  const ids = qs.filter(q =>
    q.image.includes('/crops/') &&
    (q.choices || []).join('|') === '1|2|3|4|5'
  ).map(q => q.id);
  fs.writeFileSync(output, ids.join('\n') + (ids.length ? '\n' : ''));
  console.log(output, ids.length);
}
NODE
```

Then run image-only correction per pack:

```sh
/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/llm_correct_questions.py \
  --questions-json public/officer/kyouyou/questions.json \
  --ids-file tmp/officer-kyouyou-llm-targets.txt \
  --image-only \
  --apply \
  --timeout 180 \
  --sleep 0.25

/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/llm_correct_questions.py \
  --questions-json public/officer/senmon/questions.json \
  --ids-file tmp/officer-senmon-llm-targets.txt \
  --image-only \
  --apply \
  --timeout 180 \
  --sleep 0.25
```

After correcting the two officer pack files, rebuild the combined file:

```sh
node - <<'NODE'
const fs = require('fs');
const k = JSON.parse(fs.readFileSync('public/officer/kyouyou/questions.json', 'utf8'));
const s = JSON.parse(fs.readFileSync('public/officer/senmon/questions.json', 'utf8'));
fs.writeFileSync('public/officer/questions.json', JSON.stringify([...k, ...s], null, 2) + '\n');
NODE
```

## AI-Estimated Answer Flow

Official answer keys are not currently available for the officer-candidate
PDFs. If generating answers with an LLM, treat them as AI-estimated answers, not
official answers.

Use `scripts/solve_officer_questions.py` after OCR/correction and page-image
cleanup:

```sh
/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/solve_officer_questions.py \
  --questions-json public/officer/kyouyou/questions.json \
  --exam-prefix r7- \
  --apply \
  --timeout 180 \
  --sleep 0.25

/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/solve_officer_questions.py \
  --questions-json public/officer/senmon/questions.json \
  --exam-prefix r7- \
  --apply \
  --timeout 180 \
  --sleep 0.25
```

The solver sends the target image plus OCR context to GPT-5 mini and writes:

- `answer` as a zero-based choice index when solvable
- `answerLabel` as `"1"` through `"5"`
- `explanation` prefixed with `AI推定解答は...`
- `answerSource`, `answerVerified: false`, `answerConfidence`
- `needsAnswerReview` and `answerReviewNotes`

For English questions, the solver explanation must include Japanese
translations for every English sentence, phrase, quoted passage, and answer
choice needed to review the problem. Do not translate only the correct choice.
Keep the translation block easy to scan, then explain why the selected answer
is best and why the other choices are wrong.

Do not mark LLM-generated answers as official or verified. Keep
`answerVerified: false` unless a real answer key or manual review confirms the
answer. Questions with missing copyrighted source passages should remain
unanswered and flagged for review.

If a solver run reports that the target question is not visible, fix the
question's `image`/`images` page or create a crop, clear the answer metadata for
that ID, and rerun with `--ids` or `--ids-file`.

Every OCR/correction/answer-generation step must leave traceable per-question
metadata. Preserve or append `processingHistory` entries with at least:

- `stage`
- `tool`
- `model` when an LLM is used
- `mode`
- `inputImage`
- output status such as `outputEngine`, `answerSource`, `answerConfidence`, and
  review flags when applicable

Do not replace a question's text, choices, image, or answer without keeping a
history entry that explains which script/model produced the current state.

Example target-list generation:

```sh
node - <<'NODE' > tmp/applied-info-llm-targets.txt
const fs = require('fs');
const qs = JSON.parse(fs.readFileSync('public/applied-info/questions.json', 'utf8'));
const ids = qs.filter(q => {
  const choices = (q.choices || []).join('|');
  const raw = (q.transcription?.rawText || '').trim();
  const found = raw.match(/^[間問]\s*(\d{1,3})/);
  const mismatch = found && Number(found[1]) !== Number(q.questionNumber);
  return q.image.includes('/crops/') && choices === 'ア|イ|ウ|エ' && !mismatch;
}).map(q => q.id);
process.stdout.write(ids.join('\n'));
NODE
```

## Validation Checklist

Run structural validation after generation and LLM correction:

```sh
node - <<'NODE'
const fs = require('fs');
for (const f of [
  'public/itpass/questions.json',
  'public/basic-info/questions.json',
  'public/applied-info/questions.json',
]) {
  const qs = JSON.parse(fs.readFileSync(f, 'utf8'));
  const missing = qs.filter(q => !fs.existsSync('public' + q.image));
  const badChoices = qs.filter(q => !Array.isArray(q.choices) || q.choices.length < 4);
  const noAnswer = qs.filter(q => !Number.isInteger(q.answer));
  const generic = qs.filter(q =>
    Array.isArray(q.choices) &&
    ['ア|イ|ウ|エ', 'ア|イ|ウ|エ|オ|カ|キ|ク'].includes(q.choices.join('|'))
  );
  const fallback = qs.filter(q => (q.image || '').includes('/pages/'));
  const byExam = Object.fromEntries([...new Set(qs.map(q => q.examId))]
    .map(e => [e, qs.filter(q => q.examId === e).length]));
  console.log(f, JSON.stringify({
    count: qs.length,
    byExam,
    missingImages: missing.length,
    badChoices: badChoices.length,
    noAnswer: noAnswer.length,
    genericChoices: generic.length,
    pageFallbacks: fallback.length,
  }, null, 2));
}
NODE
```

For IT Passport latest three exams, also verify all 100 questions per exam use
cropped images:

```sh
node - <<'NODE'
const fs = require('fs');
const it = JSON.parse(fs.readFileSync('public/itpass/questions.json', 'utf8'));
for (const exam of ['2026r08', '2025r07', '2024r06']) {
  const qs = it.filter(q => q.examId === exam);
  console.log(exam, {
    count: qs.length,
    cropped: qs.filter(q => q.image.startsWith(`/itpass/crops/${exam}/`)).length,
    missing: qs.filter(q => !fs.existsSync('public' + q.image)).length,
  });
}
NODE
```

For officer-candidate datasets, run these cleanup checks after every OCR or
GPT correction pass. Investigate unexpected IDs before treating the pass as
complete. Source text may still contain question numbers or `<u>` tags only when
the UI cleanup/rendering handlers below are present and verified:

```sh
node - <<'NODE'
const fs = require('fs');
const app = fs.readFileSync('src/App.jsx', 'utf8');
const content = fs.readFileSync('src/learningContent.js', 'utf8');
const requiredUiHandlers = {
  officerNumberRemoval: /function removeOfficerQuestionNumber/.test(app),
  choiceInlineFormatting: /<FormattedInline text=\{choice\}/.test(app),
  underlineRendering: /part\.type === "underline"/.test(app),
  copyrightFilter: /function isUsableQuestion/.test(content),
};
for (const f of [
  'public/officer/kyouyou/questions.json',
  'public/officer/senmon/questions.json',
  'public/officer/questions.json',
]) {
  const qs = JSON.parse(fs.readFileSync(f, 'utf8'));
  const joinedText = q => [
    q.transcription?.rawText,
    q.transcription?.text,
    q.transcription?.markdown,
  ].filter(Boolean).join('\n');
  const generic = qs.filter(q => (q.choices || []).join('|') === '1|2|3|4|5');
  const missing = qs.filter(q => !fs.existsSync('public' + q.image));
  const fallback = qs.filter(q => (q.image || '').includes('/pages/'));
  const copyrightBlocked = qs.filter(q =>
    /著作権の関係[^。\n]*(掲載できません|掲載できない)/.test(joinedText(q))
  );
  const prefixedChoices = qs.filter(q =>
    (q.choices || []).some(choice => /^\(?[1-5]\)?[\s　:：.．、]/.test(String(choice)))
  );
  const badChoiceCount = qs.filter(q => !Array.isArray(q.choices) || q.choices.length !== 5);
  const visibleNumberPrefix = qs.filter(q => {
    const text = (q.transcription?.markdown || q.transcription?.text || q.transcription?.rawText || '')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/\*\*/g, '')
      .trim();
    return /^(?:No\.?|問)?\s*\d{1,3}\s*(?:[:：.]|\n|$)/i.test(text);
  });
  const underlineTaggedChoices = qs.filter(q =>
    (q.choices || []).some(choice => String(choice).includes('<u>') || String(choice).includes('</u>'))
  );
  console.log(f, {
    requiredUiHandlers,
    count: qs.length,
    missing: missing.length,
    generic: generic.length,
    fallback: fallback.length,
    copyrightBlocked: copyrightBlocked.length,
    prefixedChoices: prefixedChoices.map(q => q.id),
    badChoiceCount: badChoiceCount.map(q => [q.id, q.choices?.length ?? 0]),
    sourceNumberPrefixHandledByUi: visibleNumberPrefix.map(q => q.id),
    underlineTagsHandledByUi: underlineTaggedChoices.map(q => q.id),
  });
}
NODE
```

Also verify processing provenance is present:

```sh
node - <<'NODE'
const fs = require('fs');
for (const f of [
  'public/officer/kyouyou/questions.json',
  'public/officer/senmon/questions.json',
  'public/officer/questions.json',
]) {
  const qs = JSON.parse(fs.readFileSync(f, 'utf8'));
  const missingHistory = qs.filter(q => !Array.isArray(q.processingHistory) || q.processingHistory.length === 0);
  const answeredWithoutSource = qs.filter(q => Number.isInteger(q.answer) && !q.answerSource);
  const llmWithoutModel = qs.filter(q =>
    (q.processingHistory || []).some(item => String(item.tool || '').includes('llm') && !item.model)
  );
  console.log(f, {
    count: qs.length,
    missingHistory: missingHistory.map(q => q.id),
    answeredWithoutSource: answeredWithoutSource.map(q => q.id),
    llmWithoutModel: llmWithoutModel.map(q => q.id),
  });
}
NODE
```

Officer-candidate cleanup rules:

- The visible problem text must not start with `No.3`, `問3`, or a standalone
  `3` line. Strip these in the UI or source text before final verification.
- Questions whose required passage is unavailable because of copyright, such as
  `著作権の関係のため掲載できません`, must be excluded from practice unless
  the missing passage is not needed to answer.
- Preserve underline information from OCR/GPT output. If GPT returns
  `<u>...</u>`, keep the tag in structured text if useful, but the UI must
  render it as an underline in both problem text and choice cards, not as
  literal tag text.
- Render simple mathematical exponent notation cleanly in the UI. Plain OCR/GPT
  output such as `x^2`, `2x^4`, or `amp^{r}` must not appear as raw caret text
  when shown to learners. Use KaTeX for inline math-like expressions such as
  `2x^4 + 2x^2 + x + 1` or `x - 1`, vector and inner-product OCR such as
  `|OA|` / `<OA>・<OB>`, plain integrals such as `∫_1^e log x dx`, and Greek
  variable expressions such as `(α-1)(β-1)`. Use structured KaTeX when
  available, and keep the inline fallback that turns remaining caret exponents
  into superscripts.
- Choice cards must not duplicate labels. Keep labels in `choiceLabels`; remove
  leading `(1)` / `1` / `1.` from `choices` text.
- If choices are present both inside `transcription.markdown` and in
  `choices`, the visible problem text box must hide the embedded choice block.
  Check numeric lists, `(1)` labels, Markdown numbered lists, and answer
  combination tables such as `a | b | c | d`.
- Avoid page fallback images for officer questions. If a question falls back to
  `/officer/pages/...`, create a per-question crop or leave it flagged for
  review.

## UI Validation

Start the dev server:

```sh
npm run dev -- --host 127.0.0.1 --port 5175
```

Then verify in the in-app browser:

- IT Passport latest exam displays cropped images and clean problem text.
- problem text does not contain `###`, `**`, or `選択肢:`.
- choices are not duplicated inside the problem text for polished IT Passport
  exams.
- Basic Information latest exam can be selected and displays image + choices.
- Applied Information latest exam can be selected and displays image + choices.
- Officer-candidate questions do not show `No.`, `問`, or standalone numeric
  prefixes inside the problem text box.
- Officer-candidate questions with unavailable copyrighted source passages are
  not shown as practice questions.
- Underlined terms render with a visible underline in both the problem text and
  choice cards; raw `<u>` tags must not be visible.
- Choice cards show the app's label badge only once; the choice text itself must
  not start with `(1)` or duplicate numeric labels.
- Choices must not be duplicated in the problem text box and the choice cards.
  This includes numbered choice lists and answer matrix tables.
- filter `出題順` defaults to `問題番号順`.
- default exam is the latest IT Passport exam when no saved settings interfere.

If localStorage has old settings, UI state may show previously enabled packs or
filters. Test default behavior in a fresh browser profile or after clearing app
storage.

## Current Caveats

- Basic Information uses the official public CBT sample releases. Each latest
  annual release currently contains 科目A 20 questions and 科目B 6 questions.
- Applied Information includes morning multiple-choice questions only. Afternoon
  questions are written-response style and do not fit the current choice-card UI.
- Applied Information OCR remains the most fragile area. As of this note, some
  fallback page images and generic choices may remain after local OCR and GPT
  correction; inspect those manually before treating the set as fully polished.
- `npm run build` may be slow because the app includes large JSON datasets.
  Browser verification against the Vite dev server is the primary local check
  during dataset work.
