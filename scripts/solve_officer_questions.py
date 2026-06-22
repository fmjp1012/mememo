#!/usr/bin/env python3
"""Generate AI-estimated answers and explanations for officer questions.

The output is intentionally marked as unverified. It is not an official answer
key and should not be presented as one.
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
REPORT_DIR = ROOT / "tmp/officer-answer-solver"
DEFAULT_MODEL = "gpt-5-mini"
NUMERIC_LABELS = ["1", "2", "3", "4", "5"]


SYSTEM_PROMPT = """You are a meticulous Japanese exam solver and transcription reviewer.
Use the supplied official exam image and existing OCR data to transcribe the target question, identify the best answer, and write a concise Japanese explanation.
Return only JSON matching the schema.

Rules:
- Treat the image as the source of truth. Use existing OCR only as a hint.
- Solve only the target question specified by id/source/questionNumber/category. Ignore other visible questions.
- Preserve underline information as <u>...</u> when it is relevant.
- Do not solve questions whose required source passage is unavailable due to copyright. Set solvable=false and answerLabel=null.
- If the image is insufficient, still return your best transcription and set needsReview=true.
- The answer is AI-estimated, not official. Calibrate confidence honestly.
- Explanations should be concise, useful for review, and in Japanese.
- For English questions, include Japanese translations for every English sentence, phrase, and choice needed to review the problem. Do not only translate the correct choice; cover all English answer choices and quoted English text visible in the target question.
- For English questions, structure the explanation so the translation block is easy to scan, then explain why the selected answer is best and why the other choices are wrong.
- Do not use web knowledge for current events unless the information is already present in the question; this run has no web tool.
"""


JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "text",
        "markdown",
        "choices",
        "solvable",
        "answerLabel",
        "confidence",
        "explanation",
        "needsReview",
        "reviewNotes",
    ],
    "properties": {
        "text": {"type": "string"},
        "markdown": {"type": "string"},
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
        "solvable": {"type": "boolean"},
        "answerLabel": {"type": ["string", "null"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "explanation": {"type": "string"},
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


def normalize_text(value: str) -> str:
    value = value.replace("\u3000", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def is_copyright_blocked(question: dict) -> bool:
    text = "\n".join(
        str(value)
        for value in [
            question.get("transcription", {}).get("rawText"),
            question.get("transcription", {}).get("text"),
            question.get("transcription", {}).get("markdown"),
        ]
        if value
    )
    return bool(re.search(r"著作権の関係[^。\n]*(掲載できません|掲載できない)", text))


def question_image_path(question: dict) -> Path | None:
    for image in [question.get("image"), *(question.get("images") or [])]:
        if not image:
            continue
        path = ROOT / image.lstrip("/")
        if not path.exists():
            path = ROOT / "public" / image.lstrip("/")
        if path.exists():
            return path
    return None


def image_data_url(question: dict) -> str | None:
    path = question_image_path(question)
    if not path:
        return None
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def user_content(question: dict) -> list[dict]:
    transcription = question.get("transcription") or {}
    payload = {
        "id": question["id"],
        "source": question.get("source", ""),
        "examId": question.get("examId"),
        "category": question.get("category"),
        "questionNumber": question.get("questionNumber"),
        "choiceLabels": question.get("choiceLabels") or NUMERIC_LABELS,
        "existingChoices": question.get("choices") or [],
        "ocr": {
            "engine": transcription.get("engine"),
            "rawText": transcription.get("rawText", ""),
            "markdown": transcription.get("markdown", ""),
            "choices": transcription.get("choices", []),
            "needsReview": transcription.get("needsReview"),
        },
        "instruction": "Transcribe and solve only this target question. Return answerLabel as one of 1,2,3,4,5 when solvable.",
    }
    content: list[dict] = [{"type": "input_text", "text": json.dumps(payload, ensure_ascii=False)}]
    data_url = image_data_url(question)
    if data_url:
        content.append({"type": "input_image", "image_url": data_url})
    return content


def openai_response(question: dict, model: str, timeout: int) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    payload = {
        "model": model,
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": SYSTEM_PROMPT}]},
            {"role": "user", "content": user_content(question)},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "officer_answer",
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


def usage_from_response(response: dict) -> dict:
    usage = response.get("usage") or {}
    if not isinstance(usage, dict):
        return {}
    return {
        "input_tokens": int(usage.get("input_tokens") or 0),
        "output_tokens": int(usage.get("output_tokens") or 0),
        "total_tokens": int(usage.get("total_tokens") or 0),
    }


def clean_choice_text(value: str) -> str:
    return re.sub(r"^\(?[1-5]\)?[\s　:：.．、]+", "", normalize_text(value))


def validate_solution(solution: dict) -> dict:
    solution["text"] = normalize_text(str(solution.get("text") or ""))
    solution["markdown"] = normalize_text(str(solution.get("markdown") or ""))
    solution["explanation"] = normalize_text(str(solution.get("explanation") or ""))
    choices = solution.get("choices") or []
    normalized_choices = []
    for choice in choices:
        label = str(choice.get("label") or "")
        text = clean_choice_text(str(choice.get("text") or ""))
        if label in NUMERIC_LABELS:
            normalized_choices.append({"label": label, "text": text})
    solution["choices"] = normalized_choices
    solution["solvable"] = bool(solution.get("solvable"))
    answer_label = solution.get("answerLabel")
    solution["answerLabel"] = str(answer_label) if str(answer_label) in NUMERIC_LABELS else None
    solution["confidence"] = max(0.0, min(1.0, float(solution.get("confidence") or 0)))
    solution["needsReview"] = bool(solution.get("needsReview"))
    solution["reviewNotes"] = [str(note) for note in solution.get("reviewNotes", [])]
    if solution["solvable"] and solution["answerLabel"] is None:
        solution["needsReview"] = True
        solution["reviewNotes"].append("solvable=true but answerLabel is missing or invalid.")
    if len(solution["choices"]) != 5:
        solution["needsReview"] = True
        solution["reviewNotes"].append(f"Expected 5 choices, got {len(solution['choices'])}.")
    if solution["confidence"] < 0.72:
        solution["needsReview"] = True
    return solution


def apply_solution(question: dict, solution: dict, model: str) -> None:
    transcription = question.get("transcription") or {}
    previous = {
        "engine": transcription.get("engine"),
        "status": transcription.get("status"),
        "needsReview": transcription.get("needsReview"),
    }
    if solution["text"] or solution["markdown"]:
        transcription.update(
            {
                "status": "llm_solved_needs_review" if solution["needsReview"] else "llm_solved",
                "engine": f"llm:{model}:solve-image",
                "rawText": solution["text"] or transcription.get("rawText", ""),
                "text": solution["text"] or transcription.get("text", ""),
                "markdown": solution["markdown"] or transcription.get("markdown", ""),
                "choices": solution["choices"] or transcription.get("choices", []),
                "needsReview": solution["needsReview"],
                "reviewNotes": solution["reviewNotes"],
                "previousOcr": previous,
            }
        )
        question["transcription"] = transcription
    if len(solution["choices"]) == 5:
        question["choices"] = [choice["text"] for choice in solution["choices"]]
        question["choiceLabels"] = [choice["label"] for choice in solution["choices"]]
    question["answerSource"] = f"llm:{model}"
    question["answerVerified"] = False
    question["answerConfidence"] = round(solution["confidence"], 3)
    question["needsAnswerReview"] = solution["needsReview"] or not solution["solvable"]
    question["answerReviewNotes"] = solution["reviewNotes"]
    if solution["solvable"] and solution["answerLabel"] in NUMERIC_LABELS:
        question["answer"] = NUMERIC_LABELS.index(solution["answerLabel"])
        question["answerLabel"] = solution["answerLabel"]
        question["difficulty"] = "公式公開問題 / AI推定解答"
        question["explanation"] = f"AI推定解答は「{solution['answerLabel']}」です。{solution['explanation']}"
    else:
        question["answer"] = None
        question["answerLabel"] = None
        question["difficulty"] = "公式公開問題 / 解答未収録"
        question["explanation"] = solution["explanation"] or "この問題はAI推定解答の対象外です。"
    question["searchText"] = normalize_text(
        " ".join(
            str(value)
            for value in [
                transcription.get("rawText", ""),
                transcription.get("text", ""),
                transcription.get("markdown", ""),
                " ".join(question.get("choices") or []),
                question.get("explanation", ""),
            ]
        )
    )
    history = question.setdefault("processingHistory", [])
    history.append(
        {
            "stage": "answer_generation",
            "tool": "scripts/solve_officer_questions.py",
            "model": model,
            "mode": "image-plus-ocr",
            "inputImage": question.get("image"),
            "answerLabel": question.get("answerLabel"),
            "answerSource": question.get("answerSource"),
            "answerVerified": question.get("answerVerified"),
            "answerConfidence": question.get("answerConfidence"),
            "needsAnswerReview": question.get("needsAnswerReview"),
        }
    )


def load_questions(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_questions(path: Path, questions: list[dict]) -> None:
    path.write_text(json.dumps(questions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def select_targets(questions: list[dict], exam_prefix: str, include_reviewed: bool, ids: list[str]) -> list[dict]:
    if ids:
        by_id = {q["id"]: q for q in questions}
        return [by_id[item_id] for item_id in ids if item_id in by_id]
    targets = [q for q in questions if str(q.get("examId", "")).startswith(exam_prefix)]
    if not include_reviewed:
        targets = [q for q in targets if not q.get("answerSource")]
    return targets


def mark_copyright_blocked(question: dict, model: str) -> None:
    question["answer"] = None
    question["answerLabel"] = None
    question["answerSource"] = f"llm:{model}"
    question["answerVerified"] = False
    question["answerConfidence"] = 0
    question["needsAnswerReview"] = True
    question["answerReviewNotes"] = ["Required source passage is unavailable due to copyright."]
    question["explanation"] = "著作権の関係で必要な本文が掲載されていないため、AI推定解答の対象外です。"
    question.setdefault("processingHistory", []).append(
        {
            "stage": "answer_generation",
            "tool": "scripts/solve_officer_questions.py",
            "model": model,
            "mode": "copyright-skip",
            "inputImage": question.get("image"),
            "answerLabel": None,
            "answerSource": question.get("answerSource"),
            "answerVerified": False,
            "answerConfidence": 0,
            "needsAnswerReview": True,
        }
    )


def estimate_tokens(targets: list[dict]) -> dict:
    chars = 0
    for question in targets:
        transcription = question.get("transcription") or {}
        chars += len(transcription.get("rawText", ""))
        chars += len(transcription.get("markdown", ""))
        chars += len(" ".join(question.get("choices") or []))
        chars += 800
    return {
        "questions": len(targets),
        "estimatedInputTokensTextOnly": max(1, int(chars / 2.2)),
        "estimatedOutputTokens": len(targets) * 900,
        "includesImages": True,
    }


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--questions-json", type=Path, required=True)
    parser.add_argument("--exam-prefix", default="r7-")
    parser.add_argument("--model", default=os.environ.get("LLM_MODEL", DEFAULT_MODEL))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--ids", nargs="*", default=[])
    parser.add_argument("--ids-file", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--include-reviewed", action="store_true")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--sleep", type=float, default=0.25)
    args = parser.parse_args()

    questions_json = args.questions_json if args.questions_json.is_absolute() else ROOT / args.questions_json
    questions = load_questions(questions_json)
    ids = list(args.ids)
    if args.ids_file:
        ids_path = args.ids_file if args.ids_file.is_absolute() else ROOT / args.ids_file
        ids.extend(line.strip() for line in ids_path.read_text(encoding="utf-8").splitlines() if line.strip())
    targets = select_targets(questions, args.exam_prefix, args.include_reviewed, ids)
    if args.limit:
        targets = targets[: args.limit]
    estimate = estimate_tokens(targets)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / "last-selection.json").write_text(json.dumps(estimate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not args.apply:
        print(json.dumps(estimate, ensure_ascii=False, indent=2))
        return 0

    corrections = []
    errors = []
    skipped = []
    usage_totals = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    by_id = {q["id"]: q for q in questions}
    for index, question in enumerate(targets, start=1):
        print(f"Solving {question['id']} ({index}/{len(targets)})", file=sys.stderr)
        target = by_id[question["id"]]
        if is_copyright_blocked(target):
            mark_copyright_blocked(target, args.model)
            skipped.append({"id": target["id"], "reason": "copyright_blocked"})
            continue
        try:
            response = openai_response(target, args.model, args.timeout)
            solution = validate_solution(extract_output_json(response))
            apply_solution(target, solution, args.model)
            usage = usage_from_response(response)
            for key in usage_totals:
                usage_totals[key] += usage.get(key, 0)
            record = {"id": target["id"], "solution": solution, "usage": usage}
            corrections.append(record)
            (REPORT_DIR / "solutions.jsonl").open("a", encoding="utf-8").write(json.dumps(record, ensure_ascii=False) + "\n")
        except Exception as error:
            errors.append({"id": target["id"], "error": str(error)})
            (REPORT_DIR / "errors.jsonl").open("a", encoding="utf-8").write(
                json.dumps({"id": target["id"], "error": str(error)}, ensure_ascii=False) + "\n"
            )
        time.sleep(args.sleep)

    write_questions(questions_json, questions)
    summary = {
        "corrected": len(corrections),
        "skipped": len(skipped),
        "errors": len(errors),
        **estimate,
        "usage": usage_totals,
    }
    (REPORT_DIR / f"summary-{questions_json.stem}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main())
