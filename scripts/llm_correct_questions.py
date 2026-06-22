#!/usr/bin/env python3
"""LLM-review OCR transcriptions for exam questions.

This script is intentionally opt-in for network calls. It only sends data to an
external LLM when --apply is passed and OPENAI_API_KEY is present.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib import request
from urllib.error import HTTPError, URLError


ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
DEFAULT_QUESTIONS_JSON = ROOT / "public/itpass/questions.json"
PROCESSED_JSON = ROOT / "data/itpass/processed/itpass-questions.json"
IOS_QUESTIONS_JSON = ROOT / "ios/Mememo/Resources/itpass/questions.json"
REPORT_DIR = ROOT / "tmp/llm-correction"
DEFAULT_MODEL = "gpt-5-mini"
KANA_CHOICES = ["ア", "イ", "ウ", "エ"]
NUMERIC_CHOICES = ["1", "2", "3", "4", "5"]


SYSTEM_PROMPT = """You are a meticulous Japanese exam transcription corrector.
Correct OCR text for a Japanese information-technology exam question using the supplied OCR text and, when present, the official page image.
Return only JSON that matches the requested schema.

Rules:
- Preserve the original Japanese meaning. Do not solve or explain the problem.
- Output polished Markdown in Japanese.
- Convert clear tables to GitHub-flavored Markdown tables.
- Convert formulas and spreadsheet expressions into clear text and LaTeX where appropriate.
- Preserve pseudo-code indentation when visible.
- Keep answer choices with the same labels as the original question when they exist.
- If the image/OCR is insufficient, still return your best correction and set needsReview=true.
- Never invent omitted numbers, table cells, or formulas. Mark uncertain fields in reviewNotes.
"""


IMAGE_ONLY_SYSTEM_PROMPT = """You are a meticulous Japanese exam transcription specialist.
Transcribe the supplied official Japanese information-technology exam question image from scratch and return only JSON that matches the requested schema.

Rules:
- Treat the image as the only source of truth. Do not rely on any previous OCR or existing choices.
- Transcribe only the target question specified by questionNumber/source. Ignore other questions visible on the same page.
- The first question heading in text/markdown/latex must be the target question number. Do not include preceding or following questions.
- Preserve the original Japanese meaning. Do not solve or explain the problem.
- Output polished Markdown in Japanese.
- Convert clear tables to GitHub-flavored Markdown tables.
- Convert formulas and spreadsheet expressions into clear text and LaTeX where appropriate.
- Preserve pseudo-code indentation when visible.
- Keep answer choices with the same labels as the original question when they exist.
- If text, diagrams, table cells, shaded areas, paths, formulas, or symbols are not fully readable, return your best transcription and set needsReview=true.
- Never invent omitted numbers, table cells, paths, or formulas. Mark uncertain fields in reviewNotes.
"""


JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "text",
        "markdown",
        "latex",
        "choices",
        "layoutFlags",
        "needsReview",
        "reviewNotes",
    ],
    "properties": {
        "text": {"type": "string"},
        "markdown": {"type": "string"},
        "latex": {"type": "string"},
        "choices": {
            "type": "array",
            "minItems": 0,
            "maxItems": 5,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "text"],
                "properties": {
                    "label": {"type": "string"},
                    "text": {"type": "string"},
                },
            },
        },
        "layoutFlags": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["table_candidate", "math_candidate", "program_candidate"],
            },
        },
        "needsReview": {"type": "boolean"},
        "reviewNotes": {"type": "array", "items": {"type": "string"}},
    },
}


def load_dotenv(path: Path = ENV_FILE) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def load_questions(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_text(value: str) -> str:
    value = value.replace("\u3000", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def is_suspicious(question: dict) -> bool:
    choices = question.get("choices") or []
    raw = ((question.get("transcription") or {}).get("rawText") or "").strip()
    markdown = ((question.get("transcription") or {}).get("markdown") or "").strip()
    generic_choices = choices in [["ア", "イ", "ウ", "エ"], ["ア", "イ", "ウ", "エ", "オ", "カ", "キ", "ク"]]
    if generic_choices:
        return True
    if len(raw) < 40 or len(markdown) < 20:
        return True
    if question.get("image", "").startswith(f"/{question.get('packId')}/pages/"):
        return True
    if re.search(r"^[間問]\s*\d{2,3}", raw) and question.get("questionNumber"):
        found = re.search(r"^[間問]\s*(\d{1,3})", raw)
        if found and int(found.group(1)) != int(question["questionNumber"]):
            return True
    return False


def select_targets(questions: list[dict], args: argparse.Namespace) -> list[dict]:
    by_id = {question["id"]: question for question in questions}
    if args.ids_file:
        ids_path = args.ids_file if args.ids_file.is_absolute() else ROOT / args.ids_file
        args.ids = [line.strip() for line in ids_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if args.ids:
        return [by_id[item_id] for item_id in args.ids if item_id in by_id]
    if args.suspicious:
        candidates = [question for question in questions if is_suspicious(question)]
        if args.exam_id:
            candidates = [question for question in candidates if question.get("examId") == args.exam_id]
        if args.limit:
            candidates = candidates[: args.limit]
        return candidates
    if args.exam_id:
        candidates = [question for question in questions if question.get("examId") == args.exam_id]
        if not args.reprocess_reviewed:
            candidates = [
                question
                for question in candidates
                if (question.get("transcription") or {}).get("status") not in {"human_reviewed", "llm_reviewed"}
            ]
        if args.limit:
            candidates = candidates[: args.limit]
        return candidates
    candidates = [
        question
        for question in questions
        if (question.get("transcription") or {}).get("needsReview")
        and (question.get("transcription") or {}).get("status")
        not in {"human_reviewed", "llm_reviewed", "llm_needs_review"}
    ]
    candidates.sort(
        key=lambda item: (
            -float((item.get("transcription") or {}).get("qualityScore") or 0),
            item["id"],
        )
    )
    if args.limit:
        candidates = candidates[: args.limit]
    return candidates


def image_data_url(question: dict) -> str | None:
    image_path = ROOT / question["image"].lstrip("/")
    if not image_path.exists():
        image_path = ROOT / "public" / question["image"].lstrip("/")
    if not image_path.exists():
        return None
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def user_payload(question: dict, include_image: bool, image_only: bool) -> list[dict]:
    transcription = question.get("transcription") or {}
    if image_only:
        payload = {
            "id": question["id"],
            "source": question.get("source", ""),
            "questionNumber": question.get("questionNumber"),
            "answerKana": question.get("answerKana"),
            "choiceLabels": question.get("choiceLabels", []),
            "instruction": "Transcribe only this target question from the image from scratch. Ignore other questions visible on the same page. Return Markdown/LaTeX and choices for the target question only. Use needsReview=true for any uncertainty.",
        }
    else:
        payload = {
            "id": question["id"],
            "source": question.get("source", ""),
            "questionNumber": question.get("questionNumber"),
            "answerKana": question.get("answerKana"),
            "ocr": {
                "engine": transcription.get("engine"),
                "rawText": transcription.get("rawText", ""),
                "markdown": transcription.get("markdown", ""),
                "latex": transcription.get("latex", ""),
                "layoutFlags": transcription.get("layoutFlags", []),
                "qualityScore": transcription.get("qualityScore"),
                "qualityReasons": transcription.get("qualityReasons", []),
            },
            "existingChoices": question.get("choices", []),
            "choiceLabels": question.get("choiceLabels", []),
            "instruction": "Correct the transcription and return Markdown/LaTeX. Use the image as source of truth when included.",
        }
    content: list[dict] = [
        {
            "type": "input_text",
            "text": json.dumps(payload, ensure_ascii=False),
        }
    ]
    if include_image:
        data_url = image_data_url(question)
        if data_url:
            content.append({"type": "input_image", "image_url": data_url})
    return content


def openai_response(question: dict, model: str, include_image: bool, image_only: bool, timeout: int) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    payload = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": [{"type": "input_text", "text": IMAGE_ONLY_SYSTEM_PROMPT if image_only else SYSTEM_PROMPT}],
            },
            {"role": "user", "content": user_payload(question, include_image, image_only)},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "corrected_question",
                "strict": True,
                "schema": JSON_SCHEMA,
            }
        },
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        "https://api.openai.com/v1/responses",
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI API error {error.code}: {body}") from error
    except URLError as error:
        raise RuntimeError(f"OpenAI API request failed: {error}") from error


def extract_output_json(response: dict) -> dict:
    if response.get("output_text"):
        return json.loads(response["output_text"])
    texts: list[str] = []
    for item in response.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                texts.append(content["text"])
    if not texts:
        raise RuntimeError("Response did not contain output text.")
    return json.loads("\n".join(texts))


def expected_choice_labels(question: dict) -> list[str]:
    labels = question.get("choiceLabels") or []
    if labels:
        return [str(label) for label in labels]
    choices = question.get("choices") or []
    if len(choices) == 5:
        return NUMERIC_CHOICES
    return KANA_CHOICES


def validate_correction(value: dict, question: dict | None = None) -> dict:
    choices = value.get("choices") or []
    labels = [choice.get("label") for choice in choices]
    expected_labels = expected_choice_labels(question or {})
    if choices and labels != expected_labels:
        value["needsReview"] = True
        notes = list(value.get("reviewNotes") or [])
        notes.append(f"Choice labels are not exactly {expected_labels}: {labels}")
        value["reviewNotes"] = notes
    for key in ["text", "markdown", "latex"]:
        value[key] = normalize_text(str(value.get(key) or ""))
    value["layoutFlags"] = [
        flag
        for flag in value.get("layoutFlags", [])
        if flag in {"table_candidate", "math_candidate", "program_candidate"}
    ]
    value["needsReview"] = bool(value.get("needsReview"))
    value["reviewNotes"] = [str(note) for note in value.get("reviewNotes", [])]
    return value


def apply_correction(question: dict, correction: dict, model: str, image_only: bool) -> None:
    transcription = question.get("transcription") or {}
    previous = {
        "engine": transcription.get("engine"),
        "qualityScore": transcription.get("qualityScore"),
        "needsReview": transcription.get("needsReview"),
    }
    transcription.update(
        {
            "status": "llm_needs_review" if correction["needsReview"] else "llm_reviewed",
            "engine": f"llm:{model}:image-only" if image_only else f"llm:{model}",
            "rawText": correction["text"],
            "text": correction["text"],
            "markdown": correction["markdown"],
            "latex": correction["latex"],
            "choices": correction["choices"],
            "layoutFlags": correction["layoutFlags"],
            "needsReview": correction["needsReview"],
            "reviewNotes": correction["reviewNotes"],
            "previousOcr": previous,
        }
    )
    question["transcription"] = transcription
    question["searchText"] = normalize_text(
        " ".join(str(transcription.get(key, "")) for key in ["rawText", "text", "markdown", "latex"])
    )
    if len(correction["choices"]) >= 4 and all(choice["text"] for choice in correction["choices"]):
        question["choices"] = [choice["text"] for choice in correction["choices"]]
        question["choiceLabels"] = [choice["label"] for choice in correction["choices"]]
    history = question.setdefault("processingHistory", [])
    history.append(
        {
            "stage": "ocr_correction",
            "tool": "scripts/llm_correct_questions.py",
            "model": model,
            "mode": "image-only" if image_only else "ocr-plus-image",
            "inputImage": question.get("image"),
            "outputEngine": transcription.get("engine"),
            "status": transcription.get("status"),
            "needsReview": transcription.get("needsReview"),
        }
    )


def usage_from_response(response: dict) -> dict:
    usage = response.get("usage") or {}
    if not isinstance(usage, dict):
        return {}
    return {
        "input_tokens": int(usage.get("input_tokens") or 0),
        "output_tokens": int(usage.get("output_tokens") or 0),
        "total_tokens": int(usage.get("total_tokens") or 0),
    }


def write_outputs(questions: list[dict], questions_json: Path) -> None:
    questions_json.write_text(json.dumps(questions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if questions_json != DEFAULT_QUESTIONS_JSON:
        return
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


def estimate_tokens(targets: list[dict], include_image: bool, image_only: bool) -> dict:
    text_chars = 0
    for question in targets:
        if not image_only:
            transcription = question.get("transcription") or {}
            text_chars += len(transcription.get("rawText", ""))
            text_chars += len(transcription.get("markdown", ""))
        text_chars += 600
    input_tokens = max(1, int(text_chars / 2.2))
    output_tokens = max(1, len(targets) * 900)
    return {
        "questions": len(targets),
        "estimatedInputTokens": input_tokens,
        "estimatedOutputTokens": output_tokens,
        "includeImage": include_image,
    }


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--questions-json", type=Path, default=DEFAULT_QUESTIONS_JSON)
    parser.add_argument("--ids", nargs="*", default=[])
    parser.add_argument("--ids-file", type=Path)
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--suspicious", action="store_true")
    parser.add_argument("--all-needs-review", action="store_true")
    parser.add_argument("--exam-id", default="")
    parser.add_argument("--reprocess-reviewed", action="store_true")
    parser.add_argument("--model", default=os.environ.get("LLM_MODEL", DEFAULT_MODEL))
    parser.add_argument("--include-image", action="store_true")
    parser.add_argument("--image-only", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Actually call the LLM API and write results.")
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--sleep", type=float, default=0.2)
    args = parser.parse_args()

    questions_json = args.questions_json if args.questions_json.is_absolute() else ROOT / args.questions_json
    questions = load_questions(questions_json)
    if args.all_needs_review:
        args.limit = 0
    if args.exam_id and args.limit == 10:
        args.limit = 0
    if args.image_only:
        args.include_image = True
    targets = select_targets(questions, args)
    estimate = estimate_tokens(targets, args.include_image, args.image_only)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / "last-selection.json").write_text(json.dumps(estimate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if not args.apply:
        print(json.dumps(estimate, ensure_ascii=False, indent=2))
        print("Dry run only. Re-run with --apply after setting OPENAI_API_KEY and explicitly approving external API use.")
        return 0

    corrections: list[dict] = []
    errors: list[dict] = []
    usage_totals = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    by_id = {question["id"]: question for question in questions}
    for index, question in enumerate(targets, start=1):
        print(f"LLM correcting {question['id']} ({index}/{len(targets)})", file=sys.stderr)
        try:
            response = openai_response(question, args.model, args.include_image, args.image_only, args.timeout)
            correction = validate_correction(extract_output_json(response), question)
            apply_correction(by_id[question["id"]], correction, args.model, args.image_only)
            usage = usage_from_response(response)
            for key in usage_totals:
                usage_totals[key] += usage.get(key, 0)
            corrections.append({"id": question["id"], "correction": correction, "usage": usage})
            (REPORT_DIR / "corrections.jsonl").open("a", encoding="utf-8").write(
                json.dumps({"id": question["id"], "correction": correction, "usage": usage}, ensure_ascii=False) + "\n"
            )
        except Exception as error:
            errors.append({"id": question["id"], "error": str(error)})
            (REPORT_DIR / "errors.jsonl").open("a", encoding="utf-8").write(
                json.dumps({"id": question["id"], "error": str(error)}, ensure_ascii=False) + "\n"
            )
        time.sleep(args.sleep)

    write_outputs(questions, questions_json)
    summary = {"corrected": len(corrections), "errors": len(errors), **estimate, "usage": usage_totals}
    (REPORT_DIR / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main())
