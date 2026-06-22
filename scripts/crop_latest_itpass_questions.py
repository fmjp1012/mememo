#!/usr/bin/env python3
"""Crop the latest IT Passport page images into per-question images.

This stays local and cheap: Tesseract TSV finds the y-position of each "問N"
heading, then Pillow crops from that heading to the next question heading.
"""

from __future__ import annotations

import csv
import json
import re
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
EXAM_IDS = ["2026r08", "2025r07", "2024r06"]
QUESTIONS_JSON = ROOT / "public/itpass/questions.json"
TESSDATA_DIR = ROOT / "data/itpass/.cache/tessdata"
SYSTEM_TESSDATA_DIRS = [
    Path("/opt/homebrew/Cellar/tesseract/5.5.2/share/tessdata"),
    Path("/opt/homebrew/share/tessdata"),
    Path("/usr/local/share/tessdata"),
]


def ensure_tesseract_configs() -> None:
    configs = TESSDATA_DIR / "configs"
    if configs.exists():
        return
    for tessdata_dir in SYSTEM_TESSDATA_DIRS:
        candidate = tessdata_dir / "configs"
        if candidate.exists():
            configs.symlink_to(candidate)
            return
    raise RuntimeError("Tesseract TSV config directory was not found.")


def run_tesseract_tsv(image_path: Path) -> list[dict[str, str]]:
    command = [
        "tesseract",
        "--tessdata-dir",
        str(TESSDATA_DIR),
        "-l",
        "jpn",
        "--psm",
        "6",
        str(image_path),
        "stdout",
        "tsv",
    ]
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    return list(csv.DictReader(completed.stdout.splitlines(), delimiter="\t"))


def detect_question_markers(image_path: Path) -> list[dict[str, int]]:
    rows = run_tesseract_tsv(image_path)
    lines: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        text = (row.get("text") or "").strip()
        if text:
            lines[(row["block_num"], row["par_num"], row["line_num"])].append(row)

    markers: list[dict[str, int]] = []
    for words in lines.values():
        left = min(int(word["left"]) for word in words)
        top = min(int(word["top"]) for word in words)
        bottom = max(int(word["top"]) + int(word["height"]) for word in words)
        text = "".join((word.get("text") or "").strip() for word in sorted(words, key=lambda item: int(item["left"])))
        match = re.search(r"[問間]\s*(\d{1,3})(?!から)", text)
        if not match:
            continue
        # Ignore page-level section headers and incidental references in passages.
        if top < 110 or left > 220:
            continue
        markers.append({"number": int(match.group(1)), "left": left, "top": top, "bottom": bottom})
    return sorted(markers, key=lambda item: (item["top"], item["left"]))


def question_number(question: dict) -> int:
    value = question.get("questionNumber")
    if isinstance(value, int):
        return value
    match = re.search(r"q(\d{3})$", question["id"])
    if not match:
        raise ValueError(f"Cannot find question number for {question['id']}")
    return int(match.group(1))


def crop_question(image_path: Path, marker: dict[str, int], next_marker: dict[str, int] | None, out_path: Path) -> None:
    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    left = 32
    right = width - 32
    top = max(marker["top"] - 34, 0)
    bottom = next_marker["top"] - 24 if next_marker else height - 70
    bottom = min(max(bottom, marker["bottom"] + 180), height)
    cropped = image.crop((left, top, right, bottom))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(out_path, format="JPEG", quality=84, optimize=True, progressive=True)


def synthesize_markers(markers: list[dict[str, int]], questions: list[dict], image_path: Path) -> list[dict[str, int]]:
    numbers = [question_number(question) for question in questions]
    relevant = [marker for marker in markers if marker["number"] in numbers]
    if len(relevant) == len(questions):
        return relevant
    if not relevant:
        return markers
    image_height = Image.open(image_path).height
    start = min(marker["top"] for marker in relevant)
    end = image_height - 120
    if len(questions) == 1:
        return [{"number": numbers[0], "left": 70, "top": start, "bottom": start + 40}]
    step = max((end - start) // len(questions), 240)
    return [
        {"number": number, "left": 70, "top": min(start + index * step, image_height - 220), "bottom": min(start + index * step + 40, image_height - 160)}
        for index, number in enumerate(numbers)
    ]


def main() -> None:
    ensure_tesseract_configs()
    questions = json.loads(QUESTIONS_JSON.read_text(encoding="utf-8"))
    summary = []
    for exam_id in EXAM_IDS:
        latest = [question for question in questions if question.get("examId") == exam_id]
        by_page: dict[str, list[dict]] = defaultdict(list)
        for question in latest:
            source_image = question.get("originalImage") or question["image"]
            by_page[source_image].append(question)

        crop_dir = ROOT / "public/itpass/crops" / exam_id
        if crop_dir.exists():
            shutil.rmtree(crop_dir)
        crop_dir.mkdir(parents=True, exist_ok=True)

        cropped = 0
        fallbacks: list[str] = []
        for image_url, page_questions in sorted(by_page.items()):
            image_path = ROOT / "public" / image_url.lstrip("/")
            ordered_questions = sorted(page_questions, key=question_number)
            markers = synthesize_markers(detect_question_markers(image_path), ordered_questions, image_path)
            markers_by_top = sorted(markers, key=lambda item: item["top"])
            if len(markers_by_top) == len(ordered_questions):
                marker_by_question_id = {
                    question["id"]: marker for question, marker in zip(ordered_questions, markers_by_top)
                }
            else:
                marker_by_number = {marker["number"]: marker for marker in markers_by_top}
                marker_by_question_id = {
                    question["id"]: marker_by_number[question_number(question)]
                    for question in ordered_questions
                    if question_number(question) in marker_by_number
                }

            for question in ordered_questions:
                number = question_number(question)
                marker = marker_by_question_id.get(question["id"])
                if not marker:
                    fallbacks.append(question["id"])
                    continue
                next_marker = next((item for item in markers_by_top if item["top"] > marker["top"] + 20), None)
                out_rel = f"itpass/crops/{exam_id}/q{number:03d}.jpg"
                crop_question(image_path, marker, next_marker, ROOT / "public" / out_rel)
                question["originalImage"] = question.get("originalImage") or question.get("image")
                question["originalImageResource"] = question.get("originalImageResource") or question.get("imageResource")
                question["image"] = f"/{out_rel}"
                question["imageResource"] = out_rel
                cropped += 1
        summary.append({"examId": exam_id, "cropped": cropped, "fallbacks": fallbacks})

    QUESTIONS_JSON.write_text(json.dumps(questions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
