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


def bucket_questions(questions: list[dict]) -> dict[str, list[dict]]:
    visible = [question for question in questions if not is_copyright_blocked(question)]
    return {
        "visible": visible,
        "copyright_blocked": [question for question in questions if is_copyright_blocked(question)],
        "missing_images": [question for question in visible if not (ROOT / "public" / str(question.get("image", "")).lstrip("/")).exists()],
        "bad_choice_count": [question for question in visible if len(question.get("choices") or []) != 5],
        "generic_choices": [question for question in visible if (question.get("choices") or []) == ["1", "2", "3", "4", "5"]],
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
        "noAnswer": 0,
        "answerReview": 0,
        "copyrightBlocked": 0,
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
        if not isinstance(question.get("answer"), int):
            by_exam[exam]["noAnswer"] += 1
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
    for name in ["generic_choices", "page_fallbacks", "no_answer", "answer_review"]:
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
