#!/usr/bin/env python3
"""Build latest three years of JSDF officer-candidate datasets."""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import subprocess
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data/officer/raw"
WEB_DIR = ROOT / "public/officer"
TESSDATA_DIR = ROOT / "data/itpass/.cache/tessdata"
PDFTOPPM = Path("/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm")


@dataclass(frozen=True)
class Section:
    id: str
    label: str
    count: int


@dataclass(frozen=True)
class Part:
    part_id: str
    exam_id: str
    exam_title: str
    kind: str
    pack_id: str
    pack_label: str
    title_prefix: str
    url: str
    sections: tuple[Section, ...]


PARTS = [
    Part("r7_1_kyouyou", "r7-1-kyouyou", "令和7年度 第1回 幹部候補生等試験", "kyouyou", "officer-kyouyou", "一般教養", "令和7年度 第1回 幹部候補生等試験 一般教養", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r7_1sikenkyouyou_0001.pdf", (Section("part1", "その1", 26), Section("part2", "その2", 34))),
    Part("r7_1_senmon", "r7-1-senmon", "令和7年度 第1回 幹部候補生等試験", "senmon", "officer-senmon", "専門択一", "令和7年度 第1回 幹部候補生等試験 専門択一", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r7_1sikensenmon_0001.pdf", (Section("humanities", "人文科学", 27), Section("social", "社会科学", 27), Section("science", "理・工学", 36))),
    Part("r7_2_kyouyou", "r7-2-kyouyou", "令和7年度 第2回 幹部候補生等試験", "kyouyou", "officer-kyouyou", "一般教養", "令和7年度 第2回 幹部候補生等試験 一般教養", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r7_2sikenkyouyou_0001.pdf", (Section("part1", "その1", 26), Section("part2", "その2", 34))),
    Part("r7_2_senmon", "r7-2-senmon", "令和7年度 第2回 幹部候補生等試験", "senmon", "officer-senmon", "専門択一", "令和7年度 第2回 幹部候補生等試験 専門択一", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r7_2sikensenmon_0001.pdf", (Section("humanities", "人文科学", 27), Section("social", "社会科学", 27), Section("science", "理・工学", 36))),
    Part("r6_1_kyouyou", "r6-1-kyouyou", "令和6年度 第1回 幹部候補生試験", "kyouyou", "officer-kyouyou", "一般教養", "令和6年度 第1回 幹部候補生試験 一般教養", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r6_1sikenkyouyou_0001.pdf", (Section("part1", "その1", 26), Section("part2", "その2", 34))),
    Part("r6_1_senmon", "r6-1-senmon", "令和6年度 第1回 幹部候補生試験", "senmon", "officer-senmon", "専門択一", "令和6年度 第1回 幹部候補生試験 専門択一", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r6_1sikensenmon_0001.pdf", (Section("humanities", "人文科学", 27), Section("social", "社会科学", 27), Section("science", "理・工学", 36))),
    Part("r6_2_kyouyou", "r6-2-kyouyou", "令和6年度 第2回 幹部候補生試験", "kyouyou", "officer-kyouyou", "一般教養", "令和6年度 第2回 幹部候補生試験 一般教養", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r6_2sikenkyouyou_0001.pdf", (Section("part1", "その1", 26), Section("part2", "その2", 34))),
    Part("r6_2_senmon", "r6-2-senmon", "令和6年度 第2回 幹部候補生試験", "senmon", "officer-senmon", "専門択一", "令和6年度 第2回 幹部候補生試験 専門択一", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r6_2sikensenmon_0001.pdf", (Section("humanities", "人文科学", 27), Section("social", "社会科学", 27), Section("science", "理・工学", 36))),
    Part("r5_1_kyouyou", "r5-1-kyouyou", "令和5年度 第1回 幹部候補生試験", "kyouyou", "officer-kyouyou", "一般教養", "令和5年度 第1回 幹部候補生試験 一般教養", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r5_1sikenkyouyou_0001.pdf", (Section("part1", "その1", 26), Section("part2", "その2", 34))),
    Part("r5_1_senmon", "r5-1-senmon", "令和5年度 第1回 幹部候補生試験", "senmon", "officer-senmon", "専門択一", "令和5年度 第1回 幹部候補生試験 専門択一", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r5_1sikensenmon_0001.pdf", (Section("humanities", "人文科学", 27), Section("social", "社会科学", 27), Section("science", "理・工学", 36))),
    Part("r5_2_kyouyou", "r5-2-kyouyou", "令和5年度 第2回 幹部候補生試験", "kyouyou", "officer-kyouyou", "一般教養", "令和5年度 第2回 幹部候補生試験 一般教養", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r5_2sikenkyouyou_0001.pdf", (Section("part1", "その1", 26), Section("part2", "その2", 34))),
    Part("r5_2_senmon", "r5-2-senmon", "令和5年度 第2回 幹部候補生試験", "senmon", "officer-senmon", "専門択一", "令和5年度 第2回 幹部候補生試験 専門択一", "https://www.mod.go.jp/gsdf/jieikanbosyu/examination/kakomon/r5_2sikensenmon_0001.pdf", (Section("humanities", "人文科学", 27), Section("social", "社会科学", 27), Section("science", "理・工学", 36))),
]


def download(url: str) -> Path:
    dest = RAW_DIR / Path(url).name
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or dest.stat().st_size == 0:
        request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
        dest.write_bytes(urlopen(request, timeout=120).read())
    return dest


def render_pages(pdf_path: Path, out_dir: Path) -> list[Path]:
    if out_dir.exists() and list(out_dir.glob("page-*.jpg")):
        return sorted(out_dir.glob("page-*.jpg"))
    if out_dir.exists():
        shutil.rmtree(out_dir)
    tmp_dir = ROOT / "tmp/officer-render" / out_dir.name
    shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(PDFTOPPM), "-r", "220", "-png", str(pdf_path), str(tmp_dir / "page")], check=True)
    paths: list[Path] = []
    for index, png_path in enumerate(sorted(tmp_dir.glob("page-*.png")), start=1):
        image = Image.open(png_path).convert("RGB")
        width, height = image.size
        image = image.crop((int(width * 0.045), int(height * 0.035), int(width * 0.955), int(height * 0.965)))
        if image.width > 1500:
            ratio = 1500 / image.width
            image = image.resize((1500, int(image.height * ratio)), Image.Resampling.LANCZOS)
        out_path = out_dir / f"page-{index:02d}.jpg"
        image.save(out_path, format="JPEG", quality=82, optimize=True, progressive=True)
        paths.append(out_path)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    return paths


def ocr_tsv(image_path: Path) -> list[dict[str, str]]:
    completed = subprocess.run(
        ["tesseract", "--tessdata-dir", str(TESSDATA_DIR), "-l", "jpn+eng", "--psm", "6", str(image_path), "stdout", "tsv"],
        check=True,
        capture_output=True,
        text=True,
    )
    return list(csv.DictReader(completed.stdout.splitlines(), delimiter="\t"))


def ocr_text(image_path: Path) -> str:
    completed = subprocess.run(
        ["tesseract", "--tessdata-dir", str(TESSDATA_DIR), "-l", "jpn+eng", "--psm", "6", str(image_path), "stdout"],
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout


def ocr_lines(image_path: Path) -> list[dict]:
    rows = ocr_tsv(image_path)
    grouped: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        if (row.get("text") or "").strip():
            grouped[(row["block_num"], row["par_num"], row["line_num"])].append(row)
    lines = []
    for words in grouped.values():
        sorted_words = sorted(words, key=lambda item: int(item["left"]))
        text = " ".join((word.get("text") or "").strip() for word in sorted_words)
        lines.append({
            "text": text,
            "compact": re.sub(r"\s+", "", text),
            "left": min(int(word["left"]) for word in words),
            "top": min(int(word["top"]) for word in words),
            "bottom": max(int(word["top"]) + int(word["height"]) for word in words),
        })
    return sorted(lines, key=lambda item: (item["top"], item["left"]))


def detect_markers(page: Path) -> list[dict]:
    markers = []
    for line in ocr_lines(page):
        compact = line["compact"].upper().replace("Ｏ", "O").replace("０", "0")
        match = re.match(r"^[^A-Z0-9]{0,4}(?:NO|N0|NQ|NＯ)\.?(\d{1,3})", compact)
        if not match:
            continue
        number = int(match.group(1))
        if number > 99:
            number = int(str(number)[:2])
        if not 30 <= line["top"] <= 1700 or line["left"] > 260:
            continue
        markers.append({**line, "number": number})
    return markers


def expected_items(part: Part) -> list[tuple[Section, int]]:
    items = []
    for section in part.sections:
        for number in range(1, section.count + 1):
            items.append((section, number))
    return items


def assign_markers(part: Part, pages: list[Path]) -> dict[tuple[str, int], tuple[int, dict]]:
    flattened = []
    for page_index, page in enumerate(pages, start=1):
        for marker in detect_markers(page):
            flattened.append((page_index, marker))
    flattened.sort(key=lambda item: (item[0], item[1]["top"], item[1]["left"]))
    items = expected_items(part)
    assigned: dict[tuple[str, int], tuple[int, dict]] = {}
    used: set[int] = set()
    cursor = 0
    for item_index, (section, number) in enumerate(items):
        match_index = None
        for marker_index in range(cursor, len(flattened)):
            if marker_index in used:
                continue
            observed = flattened[marker_index][1]["number"]
            if observed == number:
                match_index = marker_index
                break
            if item_index > 0 and observed > number + 6:
                break
        if match_index is None:
            continue
        used.add(match_index)
        cursor = match_index + 1
        assigned[(section.id, number)] = flattened[match_index]
    return assigned


def crop_question(part: Part, pages: list[Path], assigned: dict[tuple[str, int], tuple[int, dict]], section: Section, number: int) -> list[str]:
    current = assigned.get((section.id, number))
    if not current:
        return []
    flattened = [(page_index, marker, key) for key, (page_index, marker) in assigned.items()]
    flattened.sort(key=lambda item: (item[0], item[1]["top"], item[1]["left"]))
    current_index = next((index for index, item in enumerate(flattened) if item[2] == (section.id, number)), None)
    next_item = flattened[current_index + 1] if current_index is not None and current_index + 1 < len(flattened) else None
    page_index, marker = current
    image = Image.open(pages[page_index - 1]).convert("RGB")
    width, height = image.size
    top = max(marker["top"] - 18, 0)
    bottom = height - 42
    if next_item and next_item[0] == page_index:
        bottom = min(max(next_item[1]["top"] - 18, marker["bottom"] + 120), height)
    cropped = image.crop((28, top, width - 28, bottom))
    out_dir = WEB_DIR / "crops" / part.part_id
    out_dir.mkdir(parents=True, exist_ok=True)
    rel = f"officer/crops/{part.part_id}/{section.id}-q{number:03d}.jpg"
    cropped.save(ROOT / "public" / rel, format="JPEG", quality=84, optimize=True, progressive=True)
    return [f"/{rel}"]


def clean_text(value: str) -> str:
    value = value.replace("\u3000", " ")
    value = re.sub(r"[ \\t]+", " ", value)
    value = re.sub(r"\\n{3,}", "\\n\\n", value)
    return value.strip()


def split_choices(raw: str) -> tuple[str, list[str]]:
    text = re.sub(r"^\\s*(?:No|NO|N0)\\.?\\s*\\d{1,2}\\s*", "", raw, flags=re.I).strip()
    matches = list(re.finditer(r"(?m)(?:^|[\\s　])(?:[（(]?([1-5①②③④⑤])[）)]?)[\\s　:：]*(.+?)(?=(?:\\n|\\s)(?:[（(]?[1-5①②③④⑤][）)]?)[\\s　:：]|$)", text, re.S))
    normalized = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
    choices = []
    seen = []
    for match in matches:
        label = normalized.get(match.group(1), match.group(1))
        if label in seen:
            continue
        seen.append(label)
        choices.append(clean_text(match.group(2)))
    if len(choices) == 5:
        prompt_end = matches[0].start()
        return clean_text(text[:prompt_end]), choices
    return clean_text(text), ["1", "2", "3", "4", "5"]


def build_part(part: Part) -> list[dict]:
    pdf = download(part.url)
    pages = render_pages(pdf, WEB_DIR / "pages" / part.part_id)
    assigned = assign_markers(part, pages)
    questions = []
    for section in part.sections:
        for number in range(1, section.count + 1):
            images = crop_question(part, pages, assigned, section, number)
            page = assigned.get((section.id, number), (1, {}))[0]
            if not images:
                images = [f"/officer/pages/{part.part_id}/page-{page:02d}.jpg"]
            raw = ocr_text(ROOT / "public" / images[0].lstrip("/")) if "/crops/" in images[0] else f"No.{number}"
            prompt_text, choices = split_choices(raw)
            qid = f"officer-{part.part_id.replace('_', '-')}-{section.id}-q{number:03d}"
            question = {
                "id": qid,
                "packId": part.pack_id,
                "subject": part.pack_label,
                "category": section.label,
                "difficulty": "公式公開問題 / 解答未収録",
                "prompt": f"{part.title_prefix} {section.label} 問{number}",
                "choices": choices,
                "choiceLabels": ["1", "2", "3", "4", "5"],
                "answer": None,
                "explanation": "公式PDFに解答キーが含まれていないため、正誤判定は未対応です。選択肢を選ぶと演習記録だけ残ります。",
                "source": f"出典：{part.title_prefix} {section.label} 問{number}",
                "sourceUrl": part.url,
                "examId": part.exam_id,
                "examTitle": part.exam_title,
                "questionNumber": number,
                "page": page,
                "image": images[0],
                "images": images,
                "imageResource": images[0].lstrip("/"),
                "modified": False,
                "copyright": "出典：防衛省・自衛隊 自衛官募集サイト 過去の採用試験問題",
                "transcription": {
                    "status": "ocr_generated",
                    "language": "ja",
                    "format": "plain",
                    "engine": "tesseract-jpn-eng-crop",
                    "rawText": raw,
                    "text": prompt_text,
                    "markdown": prompt_text,
                    "choices": [{"label": label, "text": choice} for label, choice in zip(["1", "2", "3", "4", "5"], choices)],
                    "layoutFlags": ["crop_image_source"] if "/crops/" in images[0] else ["page_image_source"],
                    "needsReview": choices == ["1", "2", "3", "4", "5"] or len(prompt_text) < 20 or "/pages/" in images[0],
                },
                "searchText": f"{prompt_text} {' '.join(choices)}",
            }
            questions.append(question)
    return questions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--part-id", default="")
    args = parser.parse_args()
    selected = [part for part in PARTS if not args.part_id or part.part_id == args.part_id]
    by_pack: dict[str, list[dict]] = defaultdict(list)
    summary = []
    for part in selected:
        questions = build_part(part)
        by_pack[part.pack_id].extend(questions)
        summary.append({"part": part.part_id, "count": len(questions), "expected": sum(section.count for section in part.sections)})
    for pack_id, questions in by_pack.items():
        out_dir = WEB_DIR / ("kyouyou" if pack_id == "officer-kyouyou" else "senmon")
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "questions.json").write_text(json.dumps(questions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    combined = []
    for pack_id in ["officer-kyouyou", "officer-senmon"]:
        combined.extend(by_pack.get(pack_id, []))
    if combined:
        (WEB_DIR / "questions.json").write_text(json.dumps(combined, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
