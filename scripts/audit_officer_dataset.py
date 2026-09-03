#!/usr/bin/env python3
"""Audit officer-candidate dataset readiness and emit focused target lists."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OFFICER_DIR = ROOT / "public/officer"
TMP_DIR = ROOT / "tmp"


def load_questions() -> list[dict]:
    questions: list[dict] = []
    for rel in ["kyouyou/questions.json", "senmon/questions.json"]:
        questions.extend(json.loads((OFFICER_DIR / rel).read_text(encoding="utf-8")))
    return questions


def joined_text(question: dict) -> str:
    transcription = question.get("transcription") or {}
    return "\n".join(str(value) for value in [
        transcription.get("rawText"),
        transcription.get("text"),
        transcription.get("markdown"),
    ] if value)


def is_copyright_blocked(question: dict) -> bool:
    return bool(re.search(r"著作権の関係[^。\n]*(掲載できません|掲載できない)", joined_text(question)))


def is_generic_choices(question: dict) -> bool:
    return (question.get("choices") or []) == ["1", "2", "3", "4", "5"]


def has_placeholder_choices(question: dict) -> bool:
    choices = question.get("choices") or []
    return len(choices) == 5 and all("選択肢は画像に含まれていません" in str(choice) for choice in choices)


def extract_numbered_choices(text: str) -> list[str]:
    markers = list(re.finditer(r"(?m)^[ \t　]*[（(]([1-5])[）)][ \t　]*", text or ""))
    if [marker.group(1) for marker in markers] != ["1", "2", "3", "4", "5"]:
        return []
    choices = []
    for index, marker in enumerate(markers):
        start = marker.end()
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        value = re.sub(r"\s+", " ", text[start:end]).strip()
        if not value:
            return []
        choices.append(value)
    return choices


def has_recoverable_embedded_choices(question: dict) -> bool:
    return is_generic_choices(question) and len(extract_numbered_choices(joined_text(question))) == 5


def latest_solver_input_image(question: dict) -> str | None:
    for item in reversed(question.get("processingHistory") or []):
        if item.get("tool") == "scripts/solve_officer_questions.py" and item.get("inputImage"):
            return str(item.get("inputImage"))
    return None


def has_image_repair_after_solver(question: dict) -> bool:
    history = question.get("processingHistory") or []
    solver_index = None
    for index, item in enumerate(history):
        if item.get("tool") == "scripts/solve_officer_questions.py" and item.get("inputImage"):
            solver_index = index
    if solver_index is None:
        return False
    return any(
        item.get("tool") == "scripts/repair_officer_question_images.py"
        and item.get("status") == "updated"
        for item in history[solver_index + 1 :]
    )


def has_stale_solver_image(question: dict) -> bool:
    current_image = str(question.get("image") or "")
    solver_input = latest_solver_input_image(question)
    if not current_image or not solver_input or current_image == solver_input:
        return False
    if not has_image_repair_after_solver(question):
        return False
    history = question.get("processingHistory") or []
    latest_repair_index = None
    for index, item in enumerate(history):
        if item.get("tool") == "scripts/repair_officer_question_images.py" and item.get("status") == "updated":
            latest_repair_index = index
    if latest_repair_index is None:
        return False
    for item in history[latest_repair_index + 1 :]:
        if item.get("inputImage") == current_image and item.get("stage") in {"answer_generation", "manual_data_repair"}:
            return False
    return True


def bucket_questions(questions: list[dict]) -> dict[str, list[dict]]:
    visible = [question for question in questions if not is_copyright_blocked(question)]
    practice_visible = [question for question in visible if isinstance(question.get("answer"), int)]
    return {
        "visible": visible,
        "practice_visible": practice_visible,
        "copyright_blocked": [question for question in questions if is_copyright_blocked(question)],
        "missing_images": [question for question in visible if not (ROOT / "public" / str(question.get("image", "")).lstrip("/")).exists()],
        "bad_choice_count": [question for question in visible if len(question.get("choices") or []) != 5],
        "generic_choices": [question for question in visible if is_generic_choices(question)],
        "embedded_choices_recoverable": [question for question in visible if has_recoverable_embedded_choices(question)],
        "placeholder_choices": [question for question in visible if has_placeholder_choices(question)],
        "stale_after_image_repair": [question for question in visible if has_stale_solver_image(question)],
        "page_fallbacks": [question for question in visible if "/pages/" in str(question.get("image") or "")],
        "no_answer": [question for question in visible if not isinstance(question.get("answer"), int)],
        "answer_review": [question for question in visible if question.get("needsAnswerReview")],
    }


def summarize(questions: list[dict], buckets: dict[str, list[dict]]) -> dict:
    by_exam: dict[str, dict[str, int]] = defaultdict(lambda: {
        "count": 0,
        "visible": 0,
        "crops": 0,
        "pageFallbacks": 0,
        "genericChoices": 0,
        "staleAfterImageRepair": 0,
        "embeddedChoicesRecoverable": 0,
        "placeholderChoices": 0,
        "noAnswer": 0,
        "answerReview": 0,
        "copyrightBlocked": 0,
        "practiceVisible": 0,
    })
    copyright_ids = {question["id"] for question in buckets["copyright_blocked"]}
    for question in questions:
        exam = question.get("examId") or "unknown"
        by_exam[exam]["count"] += 1
        if question["id"] in copyright_ids:
            by_exam[exam]["copyrightBlocked"] += 1
            continue
        by_exam[exam]["visible"] += 1
        if "/crops/" in str(question.get("image") or ""):
            by_exam[exam]["crops"] += 1
        if "/pages/" in str(question.get("image") or ""):
            by_exam[exam]["pageFallbacks"] += 1
        if (question.get("choices") or []) == ["1", "2", "3", "4", "5"]:
            by_exam[exam]["genericChoices"] += 1
        if has_stale_solver_image(question):
            by_exam[exam]["staleAfterImageRepair"] += 1
        if has_recoverable_embedded_choices(question):
            by_exam[exam]["embeddedChoicesRecoverable"] += 1
        if has_placeholder_choices(question):
            by_exam[exam]["placeholderChoices"] += 1
        if not isinstance(question.get("answer"), int):
            by_exam[exam]["noAnswer"] += 1
        else:
            by_exam[exam]["practiceVisible"] += 1
        if question.get("needsAnswerReview"):
            by_exam[exam]["answerReview"] += 1
    return {
        "count": len(questions),
        **{name: len(items) for name, items in buckets.items()},
        "byExam": dict(sorted(by_exam.items())),
    }


def write_targets(prefix: str, buckets: dict[str, list[dict]]) -> dict[str, str]:
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, str] = {}
    for name in [
        "generic_choices",
        "embedded_choices_recoverable",
        "placeholder_choices",
        "stale_after_image_repair",
        "page_fallbacks",
        "no_answer",
        "answer_review",
    ]:
        path = TMP_DIR / f"{prefix}-{name.replace('_', '-')}.txt"
        ids = [question["id"] for question in buckets[name]]
        path.write_text("\n".join(ids) + ("\n" if ids else ""), encoding="utf-8")
        outputs[name] = str(path.relative_to(ROOT))
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exam-prefix", default="r7-")
    parser.add_argument("--write-targets", action="store_true")
    parser.add_argument("--target-prefix", default="officer-r7")
    args = parser.parse_args()

    questions = [question for question in load_questions() if str(question.get("examId") or "").startswith(args.exam_prefix)]
    buckets = bucket_questions(questions)
    report = summarize(questions, buckets)
    if args.write_targets:
        report["targetFiles"] = write_targets(args.target_prefix, buckets)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
