#!/usr/bin/env python3
"""Repair officer-candidate question images using local OCR marker detection.

This script is intentionally local-only. It does not call an LLM. Its job is to
make later OCR/LLM passes cheaper and safer by ensuring each question points to
a target-question crop instead of a broad page fallback whenever possible.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "public/officer"
BUILDER_PATH = ROOT / "scripts/build_officer_latest_datasets.py"


@dataclass(frozen=True)
class Marker:
    page_index: int
    number_text: str
    top: int
    bottom: int
    left: int
    text: str


def load_builder():
    spec = importlib.util.spec_from_file_location("build_officer_latest_datasets", BUILDER_PATH)
    if not spec or not spec.loader:
        raise RuntimeError(f"Could not import {BUILDER_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def marker_numbers(text: str) -> list[str]:
    compact = re.sub(r"\s+", "", text).upper()
    compact = compact.replace("Ｏ", "O").replace("０", "0")
    candidates: list[str] = []
    for match in re.finditer(r"N[O0Q][.]?0*([1-9][0-9]{0,2})", compact):
        candidates.append(match.group(1))
    return candidates


def detect_markers(builder, page: Path, page_index: int) -> list[Marker]:
    markers: list[Marker] = []
    for line in builder.ocr_lines(page):
        if not 20 <= line["top"] <= 1750:
            continue
        # Some valid markers are partially clipped at the left edge. Avoid the
        # old strict left limit, but still reject body text far from the margin.
        if line["left"] > 340:
            continue
        if "解答" in line["text"] and ("No" in line["text"] or "NO" in line["text"]):
            continue
        numbers = marker_numbers(line["text"])
        if not numbers:
            continue
        markers.append(
            Marker(
                page_index=page_index,
                number_text=numbers[0],
                top=int(line["top"]),
                bottom=int(line["bottom"]),
                left=int(line["left"]),
                text=line["text"],
            )
        )
    return markers


def expected_items(part) -> list[tuple[str, int]]:
    items: list[tuple[str, int]] = []
    for section in part.sections:
        for number in range(1, section.count + 1):
            items.append((section.id, number))
    return items


def marker_matches_expected(marker: Marker, expected: int, section_count: int) -> bool:
    raw = marker.number_text
    if raw == str(expected):
        return True
    # Tesseract often attaches adjacent formula/table digits to the marker:
    # "No.4" -> "41", "No.8" -> "84", "NO 1 27..." -> "12".
    if expected < 10 and raw.startswith(str(expected)):
        return True
    value = int(raw)
    if value == expected:
        return True
    # If OCR reads a leading zero block as a large number, prefer the trailing
    # in-range number when it matches the expected sequence.
    return value > section_count and str(value).endswith(str(expected))


def marker_min_order_value(marker: Marker) -> int:
    raw = marker.number_text
    values = [int(raw)]
    if len(raw) > 1:
        values.append(int(raw[0]))
        values.append(int(raw[:2]))
    return min(values)


def marker_section_start_value(marker: Marker) -> int:
    raw = marker.number_text
    if len(raw) > 1:
        return int(raw[0])
    return int(raw)


def section_marker_ranges(part, markers: list[Marker]) -> dict[str, list[Marker]]:
    if not part.sections:
        return {}
    if len(part.sections) == 1:
        return {part.sections[0].id: markers}
    starts: list[int] = []
    search_from = 0
    previous_start_page = 0
    for index, _section in enumerate(part.sections):
        start_index = None
        for marker_index in range(search_from, len(markers)):
            marker = markers[marker_index]
            if index == 0:
                if marker_matches_expected(marker, 1, _section.count):
                    start_index = marker_index
                    break
            elif marker_section_start_value(marker) <= 3 and marker.page_index >= previous_start_page + 3:
                start_index = marker_index
                break
        if start_index is None:
            start_index = search_from
        starts.append(start_index)
        previous_start_page = markers[start_index].page_index if markers else previous_start_page
        search_from = start_index + 1
    ranges: dict[str, list[Marker]] = {}
    for section_index, section in enumerate(part.sections):
        start = starts[section_index]
        end = starts[section_index + 1] if section_index + 1 < len(starts) else len(markers)
        ranges[section.id] = markers[start:end]
    return ranges


def assign_markers(part, pages: list[Path], builder) -> dict[tuple[str, int], Marker]:
    markers: list[Marker] = []
    for page_index, page in enumerate(pages, start=1):
        markers.extend(detect_markers(builder, page, page_index))
    markers.sort(key=lambda item: (item.page_index, item.top, item.left))
    section_counts = {section.id: section.count for section in part.sections}
    assigned: dict[tuple[str, int], Marker] = {}
    ranges = section_marker_ranges(part, markers)
    for section in part.sections:
        section_markers = ranges.get(section.id, [])
        cursor = 0
        for number in range(1, section.count + 1):
            match_index = None
            for index in range(cursor, len(section_markers)):
                marker = section_markers[index]
                if marker_matches_expected(marker, number, section_counts[section.id]):
                    match_index = index
                    break
                if marker_min_order_value(marker) > number + 1:
                    break
            if match_index is None:
                continue
            assigned[(section.id, number)] = section_markers[match_index]
            cursor = match_index + 1
    return assigned


def crop_question(part, pages: list[Path], assigned: dict[tuple[str, int], Marker], section_id: str, number: int) -> str | None:
    marker = assigned.get((section_id, number))
    if not marker:
        return None
    ordered = [(key, item) for key, item in assigned.items()]
    ordered.sort(key=lambda pair: (pair[1].page_index, pair[1].top, pair[1].left))
    current_index = next((index for index, pair in enumerate(ordered) if pair[0] == (section_id, number)), None)
    next_marker = ordered[current_index + 1][1] if current_index is not None and current_index + 1 < len(ordered) else None
    image = Image.open(pages[marker.page_index - 1]).convert("RGB")
    width, height = image.size
    top = max(marker.top - 20, 0)
    bottom = height - 42
    if next_marker and next_marker.page_index == marker.page_index:
        bottom = min(max(next_marker.top - 20, marker.bottom + 120), height)
    crop = image.crop((28, top, width - 28, bottom))
    out_dir = WEB_DIR / "crops" / part.part_id
    out_dir.mkdir(parents=True, exist_ok=True)
    rel = f"officer/crops/{part.part_id}/{section_id}-q{number:03d}.jpg"
    crop.save(ROOT / "public" / rel, format="JPEG", quality=84, optimize=True, progressive=True)
    return f"/{rel}"


def question_section_id(question: dict) -> str:
    qid = question.get("id", "")
    match = re.search(r"-(part[12]|humanities|social|science)-q\d{3}$", qid)
    if match:
        return match.group(1)
    category = question.get("category")
    return {
        "その1": "part1",
        "その2": "part2",
        "人文科学": "humanities",
        "社会科学": "social",
        "理・工学": "science",
    }.get(category, "")


def append_history(question: dict, *, previous_image: str, next_image: str, page: int, marker: Marker) -> None:
    history = question.setdefault("processingHistory", [])
    history.append(
        {
            "stage": "image_repair",
            "tool": "scripts/repair_officer_question_images.py",
            "mode": "local-ocr-marker-crop",
            "inputImage": previous_image,
            "outputImage": next_image,
            "page": page,
            "markerText": marker.text[:160],
            "marker": {
                "numberText": marker.number_text,
                "left": marker.left,
                "top": marker.top,
                "bottom": marker.bottom,
                "pageIndex": marker.page_index,
            },
            "status": "updated",
        }
    )


def latest_solver_input_image(question: dict) -> str | None:
    for item in reversed(question.get("processingHistory") or []):
        if item.get("tool") == "scripts/solve_officer_questions.py" and item.get("inputImage"):
            return str(item.get("inputImage"))
    return None


def mark_stale_if_needed(question: dict, *, previous_image: str, next_image: str) -> None:
    solver_input = latest_solver_input_image(question)
    if not solver_input or solver_input == next_image:
        return
    if solver_input != previous_image:
        return
    note = (
        "Image was repaired after answer generation; rerun transcription/answer "
        "for this question before treating the answer as final."
    )
    question["needsAnswerReview"] = True
    notes = question.setdefault("answerReviewNotes", [])
    if note not in notes:
        notes.append(note)
    transcription = question.setdefault("transcription", {})
    transcription["needsReview"] = True
    review_notes = transcription.setdefault("reviewNotes", [])
    if note not in review_notes:
        review_notes.append(note)


def repair_questions_for_part(part, questions: list[dict], builder, apply: bool) -> dict:
    pages = sorted((WEB_DIR / "pages" / part.part_id).glob("page-*.jpg"))
    if not pages:
        return {"part": part.part_id, "error": "missing rendered pages", "updated": 0, "missing": 0}
    assigned = assign_markers(part, pages, builder)
    updated = 0
    missing: list[str] = []
    updated_ids: list[str] = []
    for question in questions:
        if question.get("examId") != part.exam_id:
            continue
        section_id = question_section_id(question)
        number = int(question.get("questionNumber") or 0)
        marker = assigned.get((section_id, number))
        if not section_id or not marker:
            missing.append(question.get("id", ""))
            continue
        next_image = crop_question(part, pages, assigned, section_id, number)
        if not next_image:
            missing.append(question.get("id", ""))
            continue
        previous_image = question.get("image", "")
        if previous_image == next_image and Path(ROOT / "public" / next_image.lstrip("/")).exists():
            continue
        if apply:
            question["page"] = marker.page_index
            question["image"] = next_image
            question["images"] = [next_image]
            question["imageResource"] = next_image.lstrip("/")
            transcription = question.setdefault("transcription", {})
            flags = set(transcription.get("layoutFlags") or [])
            flags.discard("page_image_source")
            flags.add("crop_image_source")
            transcription["layoutFlags"] = sorted(flags)
            append_history(
                question,
                previous_image=previous_image,
                next_image=next_image,
                page=marker.page_index,
                marker=marker,
            )
            mark_stale_if_needed(question, previous_image=previous_image, next_image=next_image)
        updated += 1
        updated_ids.append(question.get("id", ""))
    return {
        "part": part.part_id,
        "assigned": len(assigned),
        "updated": updated,
        "updatedIds": updated_ids[:60],
        "missing": len(missing),
        "missingIds": missing[:40],
    }


def rebuild_combined() -> None:
    kyouyou = json.loads((WEB_DIR / "kyouyou/questions.json").read_text(encoding="utf-8"))
    senmon = json.loads((WEB_DIR / "senmon/questions.json").read_text(encoding="utf-8"))
    (WEB_DIR / "questions.json").write_text(json.dumps([*kyouyou, *senmon], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def selected_parts(builder, exam_prefix: str, part_ids: Iterable[str]) -> list:
    allowed = set(part_ids)
    parts = [part for part in builder.PARTS if (not allowed or part.part_id in allowed)]
    if exam_prefix:
        parts = [part for part in parts if part.exam_id.startswith(exam_prefix)]
    return parts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exam-prefix", default="r7-")
    parser.add_argument("--part-id", action="append", default=[])
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    builder = load_builder()
    kyouyou_path = WEB_DIR / "kyouyou/questions.json"
    senmon_path = WEB_DIR / "senmon/questions.json"
    kyouyou = json.loads(kyouyou_path.read_text(encoding="utf-8"))
    senmon = json.loads(senmon_path.read_text(encoding="utf-8"))
    by_pack = {"officer-kyouyou": kyouyou, "officer-senmon": senmon}
    results = []
    for part in selected_parts(builder, args.exam_prefix, args.part_id):
        results.append(repair_questions_for_part(part, by_pack[part.pack_id], builder, args.apply))
    if args.apply:
        kyouyou_path.write_text(json.dumps(kyouyou, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        senmon_path.write_text(json.dumps(senmon, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        rebuild_combined()
    print(json.dumps({"apply": args.apply, "results": results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
