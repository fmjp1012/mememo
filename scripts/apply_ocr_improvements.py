#!/usr/bin/env python3
"""Apply cheap local OCR improvements to suspicious or all questions."""

from __future__ import annotations

import argparse
from collections.abc import Iterable
import json
import re
import sys
from pathlib import Path

from evaluate_ocr_methods import (
    BEST_TESSDATA_DIR,
    ensure_best_tessdata,
    extract_question_window,
    load_candidates,
    resolve_public_image,
    run_apple_vision,
    run_tesseract,
    suspicious_score,
)


ROOT = Path(__file__).resolve().parents[1]
WEB_QUESTIONS_JSON = ROOT / "public/itpass/questions.json"
PROCESSED_JSON = ROOT / "data/itpass/processed/itpass-questions.json"
IOS_QUESTIONS_JSON = ROOT / "ios/Mememo/Resources/itpass/questions.json"
KANA_CHOICES = ["ア", "イ", "ウ", "エ"]


def normalize_text(value: str) -> str:
    value = value.replace("\u3000", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def split_choice_texts(text: str) -> tuple[str, list[dict]]:
    matches = list(re.finditer(r"(?m)(^|[ \t　、。．\n])([アイウエ])(?:[ \t　:：]|(?=\S))", text))
    ordered = []
    search_start = 0
    for label in KANA_CHOICES:
        match = next((item for item in matches if item.group(2) == label and item.start(2) >= search_start), None)
        if not match:
            return text.strip(), []
        ordered.append(match)
        search_start = match.end(2)
    body = text[: ordered[0].start(2)].strip()
    choices = []
    for index, match in enumerate(ordered):
        next_start = ordered[index + 1].start(2) if index + 1 < len(ordered) else len(text)
        choice_text = text[match.end(2) : next_start].strip(" \n\t:：。．、")
        choices.append({"label": match.group(2), "text": normalize_text(choice_text)})
    return body, choices


def detect_layout_flags(text: str) -> list[str]:
    flags: list[str] = []
    compact = re.sub(r"\s+", "", text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    tableish_lines = [
        line
        for line in lines
        if "|" in line
        or len(re.findall(r"(?:\d+(?:,\d{3})*|[A-Z]\$?\d+|[年月火水木金土日])", line)) >= 3
        or re.fullmatch(r"[\d,.\-+\sA-Za-z$～〜]+", line)
    ]
    mathish = re.search(r"[$=+\-*/^<>％%]|×|÷|√|Σ|∑|合計|平均|余り|true|false|if|while|endif", text, re.IGNORECASE)
    codeish = re.search(r"\b(if|else|while|endif|return|true|false)\b|整数型|論理型|文字列型", text, re.IGNORECASE)
    if len(tableish_lines) >= 3 or re.search(r"次の表|表のとおり|図\d*|ワークシート|カレンダ|一覧", compact):
        flags.append("table_candidate")
    if mathish:
        flags.append("math_candidate")
    if codeish:
        flags.append("program_candidate")
    return flags


def build_markdown(body: str, choices: list[dict], flags: list[str]) -> str:
    parts = [format_detectable_tables(body.strip())]
    if choices:
        parts.append("")
        parts.extend(f"- {choice['label']}: {choice['text']}" for choice in choices)
    markdown = "\n".join(part for part in parts if part != "").strip()
    if "table_candidate" in flags and "|" in body and not re.search(r"^\|.+\|\n\|[-:| ]+\|", body, re.MULTILINE):
        # Keep raw OCR table lines for now; reviewed overrides can replace this with a real Markdown table.
        return markdown
    return markdown


def parse_pipe_table(lines: list[str]) -> tuple[int, list[list[str]]] | None:
    rows: list[list[str]] = []
    for line in lines:
        if "|" not in line:
            continue
        cells = [normalize_text(cell.strip()) for cell in line.strip().strip("|").split("|")]
        cells = [cell for cell in cells if cell]
        if len(cells) >= 2:
            rows.append(cells)
    if len(rows) < 2:
        return None
    width_counts: dict[int, int] = {}
    for row in rows:
        width_counts[len(row)] = width_counts.get(len(row), 0) + 1
    width = max(width_counts, key=width_counts.get)
    if width < 2 or width_counts[width] < 2:
        return None
    normalized_rows = [row[:width] + [""] * max(0, width - len(row)) for row in rows if len(row) >= 2]
    return width, normalized_rows


def format_detectable_tables(text: str) -> str:
    lines = text.splitlines()
    output: list[str] = []
    index = 0
    while index < len(lines):
        if "|" not in lines[index]:
            output.append(lines[index])
            index += 1
            continue

        start = index
        while index < len(lines) and ("|" in lines[index] or not lines[index].strip()):
            index += 1
        chunk = lines[start:index]
        parsed = parse_pipe_table(chunk)
        if not parsed:
            output.extend(chunk)
            continue
        width, rows = parsed
        header, body_rows = rows[0], rows[1:]
        output.append("| " + " | ".join(header) + " |")
        output.append("| " + " | ".join("---" for _ in range(width)) + " |")
        for row in body_rows:
            output.append("| " + " | ".join(row) + " |")
    return "\n".join(output).strip()


def latex_math_candidates(text: str) -> list[str]:
    candidates: list[str] = []
    for line in text.splitlines():
        compact = normalize_text(line)
        if not compact:
            continue
        if re.search(r"[$=+\-*/^<>％%]|×|÷|√|Σ|∑|合計|平均|余り|true|false|if|while|return", compact, re.IGNORECASE):
            candidates.append(latex_escape(compact))
    return candidates[:20]


def latex_escape(value: str) -> str:
    replacements = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    return "".join(replacements.get(char, char) for char in value)


def build_latex(question_number: int, body: str, choices: list[dict]) -> str:
    lines = [rf"\paragraph{{問{question_number}}}", latex_escape(body).replace("\n", r"\\ " + "\n")]
    if choices:
        lines.append(r"\begin{description}")
        for choice in choices:
            lines.append(rf"\item[{choice['label']}] {latex_escape(choice['text'])}")
        lines.append(r"\end{description}")
    return "\n".join(lines).strip()


def build_math_latex(question_number: int, body: str, choices: list[dict], flags: list[str]) -> str:
    latex = build_latex(question_number, body, choices)
    if "math_candidate" not in flags and "program_candidate" not in flags:
        return latex
    candidates = latex_math_candidates(body)
    if not candidates:
        return latex
    return "\n".join(
        [
            latex,
            "",
            r"% OCR-derived math/code candidates. Review before treating as canonical LaTeX.",
            r"\begin{verbatim}",
            *candidates,
            r"\end{verbatim}",
        ]
    ).strip()


def score_text(name: str, text: str, qnum: int, choices: list[dict] | None = None, seconds: float = 0.0) -> dict:
    window = extract_question_window(text, qnum)
    score, reasons = suspicious_score(window, choices)
    return {
        "name": name,
        "score": round(score, 2),
        "seconds": round(seconds, 2),
        "chars": len(window),
        "reasons": reasons,
        "text": window,
    }


def page_ocr_texts(question: dict, cache: dict[str, dict[str, str]]) -> dict[str, str]:
    image = resolve_public_image(question["image"])
    image_key = str(image)
    if image_key in cache:
        return cache[image_key]
    page_results: dict[str, str] = {}
    try:
        text, _elapsed = run_apple_vision(image)
        page_results["apple-vision-accurate"] = text
    except Exception as error:
        page_results["apple-vision-accurate:error"] = str(error)
    try:
        ensure_best_tessdata()
        text, _elapsed = run_tesseract(image, BEST_TESSDATA_DIR, 4)
        page_results["tesseract-best-psm4"] = text
    except Exception as error:
        page_results["tesseract-best-psm4:error"] = str(error)
    cache[image_key] = page_results
    return page_results


def ocr_candidates(question: dict, cache: dict[str, dict[str, str]] | None = None) -> list[dict]:
    qnum = int(question["id"].rsplit("-q", 1)[1])
    current_text = question.get("transcription", {}).get("rawText", "")
    results = [score_text("current-json", current_text, qnum, question.get("transcription", {}).get("choices") or [])]
    if cache is None:
        cache = {}
    for name, text in page_ocr_texts(question, cache).items():
        if name.endswith(":error"):
            results.append({"name": name.removesuffix(":error"), "error": text})
        else:
            results.append(score_text(name, text, qnum))
    return results


def improved_transcription(question: dict, cache: dict[str, dict[str, str]] | None = None) -> tuple[dict, dict]:
    qnum = int(question["id"].rsplit("-q", 1)[1])
    results = ocr_candidates(question, cache)
    scored = [item for item in results if "score" in item]
    best = min(scored, key=lambda item: item["score"])
    raw_text = normalize_text(best["text"])
    body, choices = split_choice_texts(raw_text)
    flags = detect_layout_flags(raw_text)
    score, reasons = suspicious_score(raw_text, choices)
    needs_review = bool(flags) or score >= 35 or len(choices) != 4
    transcription = {
        **(question.get("transcription") or {}),
        "status": "ocr_needs_review" if needs_review else "ocr_unreviewed",
        "language": "ja",
        "format": "markdown+latex",
        "engine": best["name"],
        "rawText": raw_text,
        "text": body,
        "markdown": build_markdown(body, choices, flags),
        "latex": build_math_latex(qnum, body, choices, flags),
        "choices": choices,
        "layoutFlags": flags,
        "needsReview": needs_review,
        "qualityScore": round(score, 2),
        "qualityReasons": reasons,
    }
    return transcription, {"best": best, "results": results}


def load_all_questions() -> list[dict]:
    return json.loads(WEB_QUESTIONS_JSON.read_text(encoding="utf-8"))


def all_targets(questions: list[dict]) -> Iterable[dict]:
    return [
        question
        for question in questions
        if (question.get("transcription") or {}).get("status") != "human_reviewed"
    ]


def write_outputs(questions: list[dict]) -> None:
    WEB_QUESTIONS_JSON.write_text(json.dumps(questions, ensure_ascii=False) + "\n", encoding="utf-8")
    if PROCESSED_JSON.exists():
        payload = json.loads(PROCESSED_JSON.read_text(encoding="utf-8"))
        by_id = {item["id"]: item for item in questions}
        payload["questions"] = [by_id.get(item["id"], item) for item in payload.get("questions", [])]
        PROCESSED_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if IOS_QUESTIONS_JSON.exists():
        ios_records = json.loads(IOS_QUESTIONS_JSON.read_text(encoding="utf-8"))
        by_id = {item["id"]: item for item in questions}
        for item in ios_records:
            source = by_id.get(item["id"])
            if source:
                transcription = source.get("transcription") or {}
                item["transcriptionText"] = transcription.get("text") or transcription.get("markdown") or item.get("transcriptionText", "")
        IOS_QUESTIONS_JSON.write_text(json.dumps(ios_records, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--ids", nargs="*", default=[])
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    questions = load_all_questions()
    by_id = {item["id"]: item for item in questions}
    if args.ids:
        targets = [by_id[item_id] for item_id in args.ids if item_id in by_id]
    elif args.all:
        targets = list(all_targets(questions))
    else:
        targets = [
            by_id[candidate.question["id"]]
            for candidate in load_candidates(args.limit)
            if candidate.question["id"] in by_id
        ]

    improved = []
    page_cache: dict[str, dict[str, str]] = {}
    for index, target in enumerate(targets, start=1):
        print(f"Improving {target['id']} ({index}/{len(targets)})", file=sys.stderr)
        transcription, report = improved_transcription(target, page_cache)
        target["transcription"] = transcription
        target["searchText"] = normalize_text(
            " ".join(
                str(transcription.get(key, ""))
                for key in ["rawText", "text", "markdown", "latex"]
            )
        )
        if len(transcription["choices"]) == 4 and all(choice["text"] for choice in transcription["choices"]):
            target["choices"] = [choice["text"] for choice in transcription["choices"]]
        improved.append(
            {
                "id": target["id"],
                "engine": transcription["engine"],
                "qualityScore": transcription["qualityScore"],
                "layoutFlags": transcription["layoutFlags"],
                "needsReview": transcription["needsReview"],
                "sample": transcription["rawText"][:260],
            }
        )

    report_path = ROOT / "tmp/ocr-eval/applied-improvements.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(improved, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not args.dry_run:
        write_outputs(questions)
    print(json.dumps(improved, ensure_ascii=False, indent=2))
    print(f"Wrote {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
