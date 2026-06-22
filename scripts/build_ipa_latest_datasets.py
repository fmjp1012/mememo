#!/usr/bin/env python3
"""Build FE/AP latest public-question datasets from official IPA PDFs."""

from __future__ import annotations

import csv
import argparse
import json
import re
import shutil
import subprocess
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from urllib.request import urlopen

from PIL import Image
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
PY_PDF_DIR = ROOT / "data/ipa/raw/pdf"
WEB_DIR = ROOT / "public"
TESSDATA_DIR = ROOT / "data/itpass/.cache/tessdata"
PDFTOPPM = Path("/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm")
SYSTEM_TESSDATA_DIRS = [
    Path("/opt/homebrew/Cellar/tesseract/5.5.2/share/tessdata"),
    Path("/opt/homebrew/share/tessdata"),
    Path("/usr/local/share/tessdata"),
]

KANA = ["ア", "イ", "ウ", "エ"]
KANA_EXTENDED = ["ア", "イ", "ウ", "エ", "オ", "カ", "キ", "ク"]


@dataclass(frozen=True)
class Part:
    pack_id: str
    exam_id: str
    exam_title: str
    part_id: str
    part_label: str
    qs_url: str
    ans_url: str
    expected_count: int
    pack_label: str
    title_prefix: str


PARTS = [
    Part("basic-info", "fe-2025r07", "令和7年度", "2025r07-fe-a", "科目A", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/tbl5kb0000005r9r-att/2025r07_fe_kamoku_a_qs.pdf", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/tbl5kb0000005r9r-att/2025r07_fe_kamoku_a_ans.pdf", 20, "基本情報", "令和7年度 基本情報技術者試験 科目A"),
    Part("basic-info", "fe-2025r07", "令和7年度", "2025r07-fe-b", "科目B", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/tbl5kb0000005r9r-att/2025r07_fe_kamoku_b_qs.pdf", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/tbl5kb0000005r9r-att/2025r07_fe_kamoku_b_ans.pdf", 6, "基本情報", "令和7年度 基本情報技術者試験 科目B"),
    Part("basic-info", "fe-2024r06", "令和6年度", "2024r06-fe-a", "科目A", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/eid2eo0000007g1d-att/2024r06_fe_kamoku_a_qs.pdf", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/eid2eo0000007g1d-att/2024r06_fe_kamoku_a_ans.pdf", 20, "基本情報", "令和6年度 基本情報技術者試験 科目A"),
    Part("basic-info", "fe-2024r06", "令和6年度", "2024r06-fe-b", "科目B", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/eid2eo0000007g1d-att/2024r06_fe_kamoku_b_qs.pdf", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/eid2eo0000007g1d-att/2024r06_fe_kamoku_b_ans.pdf", 6, "基本情報", "令和6年度 基本情報技術者試験 科目B"),
    Part("basic-info", "fe-2023r05", "令和5年度", "2023r05-fe-a", "科目A", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/t6hhco0000003zx0-att/2023r05_fe_kamoku_a_qs.pdf", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/t6hhco0000003zx0-att/2023r05_fe_kamoku_a_ans.pdf", 20, "基本情報", "令和5年度 基本情報技術者試験 科目A"),
    Part("basic-info", "fe-2023r05", "令和5年度", "2023r05-fe-b", "科目B", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/t6hhco0000003zx0-att/2023r05_fe_kamoku_b_qs.pdf", "https://www.ipa.go.jp/shiken/mondai-kaiotu/sg_fe/koukai/t6hhco0000003zx0-att/2023r05_fe_kamoku_b_ans.pdf", 6, "基本情報", "令和5年度 基本情報技術者試験 科目B"),
    Part("applied-info", "ap-2025r07a", "令和7年度 秋期", "2025r07a-ap-am", "午前", "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07a_ap_am_qs.pdf", "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07a_ap_am_ans.pdf", 80, "応用情報", "令和7年度 秋期 応用情報技術者試験 午前"),
    Part("applied-info", "ap-2025r07h", "令和7年度 春期", "2025r07h-ap-am", "午前", "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07h_ap_am_qs.pdf", "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07h_ap_am_ans.pdf", 80, "応用情報", "令和7年度 春期 応用情報技術者試験 午前"),
    Part("applied-info", "ap-2024r06a", "令和6年度 秋期", "2024r06a-ap-am", "午前", "https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06a_ap_am_qs.pdf", "https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06a_ap_am_ans.pdf", 80, "応用情報", "令和6年度 秋期 応用情報技術者試験 午前"),
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
    raise RuntimeError("Tesseract configs were not found.")


def download(url: str) -> Path:
    dest = PY_PDF_DIR / Path(url).name
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or dest.stat().st_size == 0:
        dest.write_bytes(urlopen(url, timeout=90).read())
    return dest


def render_pages(pdf_path: Path, out_dir: Path) -> list[Path]:
    if out_dir.exists() and list(out_dir.glob("page-*.jpg")):
        return sorted(out_dir.glob("page-*.jpg"))
    if out_dir.exists():
        shutil.rmtree(out_dir)
    tmp_dir = ROOT / "tmp/ipa-render" / out_dir.name
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(PDFTOPPM), "-r", "220", "-png", str(pdf_path), str(tmp_dir / "page")], check=True)
    paths: list[Path] = []
    for index, png_path in enumerate(sorted(tmp_dir.glob("page-*.png")), start=1):
        image = Image.open(png_path).convert("RGB")
        width, height = image.size
        image = image.crop((int(width * 0.055), int(height * 0.035), int(width * 0.945), int(height * 0.965)))
        if image.width > 1500:
            ratio = 1500 / image.width
            image = image.resize((1500, int(image.height * ratio)), Image.Resampling.LANCZOS)
        out_path = out_dir / f"page-{index:02d}.jpg"
        image.save(out_path, format="JPEG", quality=82, optimize=True, progressive=True)
        paths.append(out_path)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    return paths


def pdf_text(pdf_path: Path) -> str:
    return "\n".join(page.extract_text() or "" for page in PdfReader(str(pdf_path)).pages)


def ocr_text(image_path: Path) -> str:
    completed = subprocess.run(
        ["tesseract", "--tessdata-dir", str(TESSDATA_DIR), "-l", "jpn", "--psm", "6", str(image_path), "stdout"],
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout


def ocr_tsv(image_path: Path) -> list[dict[str, str]]:
    completed = subprocess.run(
        ["tesseract", "--tessdata-dir", str(TESSDATA_DIR), "-l", "jpn", "--psm", "6", str(image_path), "stdout", "tsv"],
        check=True,
        capture_output=True,
        text=True,
    )
    return list(csv.DictReader(completed.stdout.splitlines(), delimiter="\t"))


def detect_markers(image_path: Path) -> list[dict[str, int]]:
    rows = ocr_tsv(image_path)
    lines: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        if (row.get("text") or "").strip():
            lines[(row["block_num"], row["par_num"], row["line_num"])].append(row)
    markers = []
    for words in lines.values():
        left = min(int(word["left"]) for word in words)
        top = min(int(word["top"]) for word in words)
        bottom = max(int(word["top"]) + int(word["height"]) for word in words)
        text = "".join((word.get("text") or "").strip() for word in sorted(words, key=lambda item: int(item["left"])))
        match = re.search(r"^[問間]\s*(\d{1,3})(?![から～〜])", text)
        if match and 70 <= top and left <= 240:
            markers.append({"number": int(match.group(1)), "left": left, "top": top, "bottom": bottom})
    return sorted(markers, key=lambda item: (item["top"], item["left"]))


def normalize_marker_numbers(markers_by_page: dict[int, list[dict[str, int]]], expected_count: int) -> dict[int, list[dict[str, int]]]:
    normalized: dict[int, list[dict[str, int]]] = defaultdict(list)
    seen_numbers: set[int] = set()
    for page_index, markers in markers_by_page.items():
        for marker in markers:
            number = marker["number"]
            if number > expected_count:
                digits = str(number)
                candidates = [int(digits[:take]) for take in range(len(digits) - 1, 0, -1)]
                number = next((candidate for candidate in candidates if 1 <= candidate <= expected_count), number)
            if not 1 <= number <= expected_count or number in seen_numbers:
                continue
            corrected = dict(marker)
            corrected["number"] = number
            normalized[page_index].append(corrected)
            seen_numbers.add(number)
    return dict(normalized)


def extract_answers(ans_pdf: Path, count: int) -> list[str]:
    text = pdf_text(ans_pdf)
    pairs = [(int(n), a) for n, a in re.findall(r"問\s*(\d{1,3})\s*([アイウエオカキク])", text)]
    by_number = {n: a for n, a in pairs}
    answers = [by_number.get(index) for index in range(1, count + 1)]
    if all(answers):
        return [str(answer) for answer in answers]
    raw = re.findall(r"[アイウエオカキク]", text)
    if len(raw) >= count:
        return raw[:count]
    return [""] * count


def clean_text(value: str) -> str:
    value = value.replace("\u3000", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def split_questions(text: str, count: int) -> dict[int, str]:
    normalized = text.replace("－", "-")
    matches = list(re.finditer(r"(?m)^問\s*(\d{1,3})\s+", normalized))
    result: dict[int, str] = {}
    for index, match in enumerate(matches):
        number = int(match.group(1))
        if number < 1 or number > count:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(normalized)
        result[number] = clean_text(normalized[match.start() : end])
    return result


def split_choices(question_text: str, labels: list[str]) -> tuple[str, list[str]]:
    text = re.sub(r"^\s*問\s*\d{1,3}\s*", "", question_text).strip()
    label_class = "".join(labels)
    choice_start = re.search(r"(?m)^[ \t]*ア\s+", text)
    if not choice_start:
        choice_start = re.search(r"\sア\s+", text)
    if not choice_start:
        return clean_text(text), KANA[:]
    prompt = clean_text(text[: choice_start.start()])
    choices_text = text[choice_start.start() :]
    matches = list(re.finditer(rf"(?s)([{label_class}])\s+(.+?)(?=(?:\n?[ \t]*[{label_class}]\s+)|$)", choices_text))
    choices = [clean_text(match.group(2)) for match in matches[: len(labels)]]
    if len(choices) < 4 or any(not choice for choice in choices):
        choices = labels[:]
    return prompt, choices


def crop_segments(part: Part, pages: list[Path], markers_by_page: dict[int, list[dict[str, int]]], number: int) -> list[str]:
    flattened = []
    for page_index, markers in markers_by_page.items():
        for marker in markers:
            flattened.append((page_index, marker))
    flattened.sort(key=lambda item: (item[0], item[1]["top"]))
    current_index = next((i for i, (_, marker) in enumerate(flattened) if marker["number"] == number), None)
    if current_index is None:
        return []
    page_index, marker = flattened[current_index]
    next_item = flattened[current_index + 1] if current_index + 1 < len(flattened) else None
    image = Image.open(pages[page_index - 1]).convert("RGB")
    width, height = image.size
    top = max(marker["top"] - 28, 0)
    bottom = height - 55
    if next_item and next_item[0] == page_index:
        bottom = min(max(next_item[1]["top"] - 22, marker["bottom"] + 140), height)
    cropped = image.crop((32, top, width - 32, bottom))
    out_dir = WEB_DIR / part.pack_id / "crops" / part.part_id
    out_dir.mkdir(parents=True, exist_ok=True)
    rel = f"{part.pack_id}/crops/{part.part_id}/q{number:03d}.jpg"
    cropped.save(WEB_DIR / rel, format="JPEG", quality=84, optimize=True, progressive=True)
    return [f"/{rel}"]


def build_part(part: Part) -> list[dict]:
    qs_pdf = download(part.qs_url)
    ans_pdf = download(part.ans_url)
    page_dir = WEB_DIR / part.pack_id / "pages" / part.part_id
    pages = render_pages(qs_pdf, page_dir)
    text = pdf_text(qs_pdf)
    use_crop_ocr = len(text.strip()) < 200
    if use_crop_ocr:
        text = "\n".join(ocr_text(page) for page in pages)
    question_texts = split_questions(text, part.expected_count)
    answers = extract_answers(ans_pdf, part.expected_count)
    markers_by_page = {index: detect_markers(page) for index, page in enumerate(pages, start=1)}
    markers_by_page = normalize_marker_numbers(markers_by_page, part.expected_count)
    labels = KANA_EXTENDED if part.part_label == "科目B" else KANA

    questions = []
    for number in range(1, part.expected_count + 1):
        raw = question_texts.get(number, f"問{number}")
        images = crop_segments(part, pages, markers_by_page, number)
        if not images:
            fallback = f"/{part.pack_id}/pages/{part.part_id}/page-01.jpg"
            images = [fallback]
        if use_crop_ocr and images and "/crops/" in images[0]:
            raw = ocr_text(WEB_DIR / images[0].lstrip("/"))
        prompt, choices = split_choices(raw, labels)
        answer_kana = answers[number - 1] if number - 1 < len(answers) else ""
        answer_index = labels.index(answer_kana) if answer_kana in labels else None
        question = {
            "id": f"{part.pack_id}-{part.part_id}-q{number:03d}",
            "packId": part.pack_id,
            "subject": part.pack_label,
            "category": part.part_label,
            "difficulty": "公式公開問題",
            "prompt": f"{part.title_prefix} 問{number}",
            "choices": choices,
            "choiceLabels": labels[: len(choices)],
            "answer": answer_index,
            "answerKana": answer_kana,
            "explanation": f"公式解答は「{answer_kana}」です。出典：{part.title_prefix} 問{number}",
            "source": f"出典：{part.title_prefix} 問{number}",
            "sourceUrl": part.qs_url,
            "answerUrl": part.ans_url,
            "examId": part.exam_id,
            "examTitle": part.exam_title,
            "questionNumber": number,
            "image": images[0],
            "images": images,
            "imageResource": images[0].lstrip("/"),
            "copyright": "独立行政法人情報処理推進機構",
            "transcription": {
                "status": "ocr_generated",
                "format": "plain",
                "rawText": raw,
                "text": prompt,
                "markdown": prompt,
                "choices": [{"label": label, "text": choice} for label, choice in zip(labels, choices)],
            },
            "searchText": f"{prompt} {' '.join(choices)}",
        }
        questions.append(question)
    return questions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack-id", default="")
    parser.add_argument("--part-id", default="")
    args = parser.parse_args()
    ensure_tesseract_configs()
    by_pack: dict[str, list[dict]] = defaultdict(list)
    summary = []
    selected_parts = [
        part
        for part in PARTS
        if (not args.pack_id or part.pack_id == args.pack_id) and (not args.part_id or part.part_id == args.part_id)
    ]
    for part in selected_parts:
        questions = build_part(part)
        by_pack[part.pack_id].extend(questions)
        summary.append({"part": part.part_id, "count": len(questions), "expected": part.expected_count})
    for pack_id, questions in by_pack.items():
        out_dir = WEB_DIR / pack_id
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "questions.json").write_text(json.dumps(questions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
