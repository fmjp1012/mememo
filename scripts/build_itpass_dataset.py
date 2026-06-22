#!/usr/bin/env python3
"""Build an IT Passport question dataset from official IPA PDFs.

The authoritative question body is preserved as a rendered page image to avoid
OCR errors in diagrams, tables, formulas, or long Japanese text. OCR is used
only for page/question indexing and search text.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from PIL import Image
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
OFFICIAL_QUESTIONS_PAGE = "https://www3.jitec.ipa.go.jp/JitesCbt/html/openinfo/questions.html"
IPA_EXAM_PAGE = "https://www.ipa.go.jp/shiken/mondai-kaiotu/index.html"
TESSDATA_URL = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/jpn.traineddata"
PDFTOPPM = ROOT / ".cache/nonexistent"
BUNDLED_PDFTOPPM = Path("/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm")
TESSDATA_DIR = ROOT / "data/itpass/.cache/tessdata"
RAW_PDF_DIR = ROOT / "data/itpass/raw/pdf"
RAW_TEXT_DIR = ROOT / "data/itpass/raw/text"
RAW_MANIFEST_HTML = ROOT / "data/itpass/raw/questions.html"
PROCESSED_DIR = ROOT / "data/itpass/processed"
OVERRIDES_JSON = ROOT / "data/itpass/overrides.json"
WEB_PAGE_DIR = ROOT / "public/itpass/pages"
WEB_QUESTIONS_JSON = ROOT / "public/itpass/questions.json"
IOS_RESOURCE_DIR = ROOT / "ios/Mememo/Resources/itpass/pages"
IOS_QUESTIONS_JSON = ROOT / "ios/Mememo/Resources/itpass/questions.json"
GENERATED_IOS_FILE = ROOT / "ios/Mememo/LearningData.swift"


@dataclass(frozen=True)
class ExamPdf:
    exam_id: str
    title: str
    qs_url: str
    ans_url: str
    display_year: str
    copyright_year: str


@dataclass(frozen=True)
class QuestionLocation:
    page: int
    line_index: int
    raw_number: str
    line: str


KANA_CHOICES = ["ア", "イ", "ウ", "エ"]


def load_overrides() -> dict:
    if not OVERRIDES_JSON.exists():
        return {}
    return json.loads(OVERRIDES_JSON.read_text(encoding="utf-8"))


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def scrape_manifest() -> list[ExamPdf]:
    if RAW_MANIFEST_HTML.exists():
        html = RAW_MANIFEST_HTML.read_text(encoding="utf-8")
    else:
        response = requests.get(OFFICIAL_QUESTIONS_PAGE, timeout=90)
        response.raise_for_status()
        response.encoding = "utf-8"
        html = response.text
        RAW_MANIFEST_HTML.parent.mkdir(parents=True, exist_ok=True)
        RAW_MANIFEST_HTML.write_text(html, encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")
    rows: list[ExamPdf] = []
    for tr in soup.select("table.table_10 tr"):
        cells = tr.find_all("td")
        if len(cells) < 3:
            continue
        title = normalize_text(cells[0].get_text(" "))
        links = [a.get("href") for a in tr.find_all("a", href=True)]
        qs = next((href for href in links if href and href.endswith("_qs.pdf")), None)
        ans = next((href for href in links if href and href.endswith("_ans.pdf")), None)
        if not qs or not ans:
            continue
        exam_id = Path(qs).name.replace("_ip_qs.pdf", "")
        display_year = title.replace("ITパスポート試験 ", "").replace("分", "")
        rows.append(
            ExamPdf(
                exam_id=exam_id,
                title=title,
                qs_url=urljoin(OFFICIAL_QUESTIONS_PAGE, qs),
                ans_url=urljoin(OFFICIAL_QUESTIONS_PAGE, ans),
                display_year=display_year,
                copyright_year=exam_id[:4],
            )
        )
    if not rows:
        raise RuntimeError("No IT Passport PDF links found on the official page.")
    return rows


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    dest.write_bytes(response.content)


def ensure_japanese_ocr_data() -> None:
    trained = TESSDATA_DIR / "jpn.traineddata"
    if trained.exists() and trained.stat().st_size > 0:
        return
    TESSDATA_DIR.mkdir(parents=True, exist_ok=True)
    response = requests.get(TESSDATA_URL, timeout=60)
    response.raise_for_status()
    trained.write_bytes(response.content)


def extract_answers(answer_pdf: Path) -> list[str]:
    text = "\n".join(page.extract_text() or "" for page in PdfReader(str(answer_pdf)).pages)
    answers = re.findall(r"[アイウエ]", text)
    if len(answers) >= 100:
        # pypdf returns this answer sheet in question order, with extra header text stripped by the regex.
        return answers[:100]

    mixed_marker_answers: list[str] = []
    mojibake_text_markers = {
        "0¢": "ア",
        "0¤": "イ",
        "0¦": "ウ",
        "0¨": "エ",
    }
    for line in text.splitlines():
        stripped = line.strip()
        if stripped in KANA_CHOICES:
            mixed_marker_answers.append(stripped)
        elif stripped in mojibake_text_markers:
            mixed_marker_answers.append(mojibake_text_markers[stripped])
    if len(mixed_marker_answers) == 100:
        return mixed_marker_answers

    mojibake_bytes = text.encode("latin1", errors="ignore")
    for encoding in ("cp932", "shift_jis"):
        decoded = mojibake_bytes.decode(encoding, errors="ignore")
        decoded_answers = re.findall(r"[アイウエ]", decoded)
        if len(decoded_answers) >= 100:
            return decoded_answers[:100]

    byte_markers = {
        b"\x30\xa2": "ア",
        b"\x30\xa4": "イ",
        b"\x30\xa6": "ウ",
        b"\x30\xa8": "エ",
    }
    byte_answers: list[tuple[int, str]] = []
    for marker, answer in byte_markers.items():
        start = 0
        while True:
            position = mojibake_bytes.find(marker, start)
            if position == -1:
                break
            byte_answers.append((position, answer))
            start = position + len(marker)
    if len(byte_answers) == 100:
        return [answer for _, answer in sorted(byte_answers)]

    raise RuntimeError(f"Expected 100 answers in {answer_pdf}, found {len(answers)}.")


def render_pages(exam: ExamPdf, qs_pdf: Path, overwrite: bool) -> list[Path]:
    out_dir = WEB_PAGE_DIR / exam.exam_id
    ios_dir = IOS_RESOURCE_DIR / exam.exam_id
    out_dir.mkdir(parents=True, exist_ok=True)
    ios_dir.mkdir(parents=True, exist_ok=True)
    if not overwrite:
        existing = sorted(out_dir.glob("page-*.jpg"))
        if existing:
            for image in existing:
                ios_target = ios_dir / image.name
                if not ios_target.exists():
                    shutil.copy2(image, ios_target)
            return existing

    tmp_dir = ROOT / "tmp/itpass-render" / exam.exam_id
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True)

    pdftoppm = BUNDLED_PDFTOPPM if BUNDLED_PDFTOPPM.exists() else shutil.which("pdftoppm")
    if not pdftoppm:
        raise RuntimeError("pdftoppm is required to render question PDFs.")
    subprocess.run([str(pdftoppm), "-r", "260", "-png", str(qs_pdf), str(tmp_dir / "page")], check=True)

    output_paths: list[Path] = []
    for index, png_path in enumerate(sorted(tmp_dir.glob("page-*.png")), start=1):
        image = Image.open(png_path).convert("RGB")
        width, height = image.size
        # Remove broad scanner margins while keeping page number and section headers.
        left = int(width * 0.07)
        top = int(height * 0.04)
        right = int(width * 0.93)
        bottom = int(height * 0.96)
        image = image.crop((left, top, right, bottom))
        if image.width > 1500:
            ratio = 1500 / image.width
            image = image.resize((1500, int(image.height * ratio)), Image.Resampling.LANCZOS)
        out_path = out_dir / f"page-{index:02d}.jpg"
        image.save(out_path, format="JPEG", quality=80, optimize=True, progressive=True)
        shutil.copy2(out_path, ios_dir / out_path.name)
        output_paths.append(out_path)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    return output_paths


def ocr_pages(exam: ExamPdf, page_images: list[Path], overwrite: bool) -> dict[int, str]:
    ensure_japanese_ocr_data()
    out_dir = RAW_TEXT_DIR / exam.exam_id
    out_dir.mkdir(parents=True, exist_ok=True)
    result: dict[int, str] = {}
    env = os.environ.copy()
    env["TESSDATA_PREFIX"] = str(TESSDATA_DIR)
    for index, image_path in enumerate(page_images, start=1):
        text_path = out_dir / f"page-{index:02d}.txt"
        if overwrite or not text_path.exists():
            completed = subprocess.run(
                ["tesseract", str(image_path), "stdout", "-l", "jpn", "--psm", "6"],
                check=True,
                capture_output=True,
                text=True,
                env=env,
            )
            text_path.write_text(completed.stdout, encoding="utf-8")
        result[index] = text_path.read_text(encoding="utf-8")
    return result


def parse_domain_ranges(page_texts: dict[int, str]) -> list[tuple[int, int, str]]:
    ranges: list[tuple[int, int, str]] = []
    domain_names = [
        ("ストラテジ", "ストラテジ"),
        ("マネジメント", "マネジメント"),
        ("テクノロジ", "テクノロジ"),
    ]
    for text in page_texts.values():
        normalized = text.replace(" ", "")
        for match in re.finditer(r"[問間同賠](\d{1,3})から[問間岡](\d{1,3})まで[は,、]*(.{0,14})", normalized):
            label = match.group(3)
            domain = next((name for needle, name in domain_names if needle in label), "")
            if domain:
                ranges.append((int(match.group(1)), min(int(match.group(2)), 100), domain))
    if ranges:
        normalized_ranges: list[tuple[int, int, str]] = []
        for start, end, domain in sorted(set(ranges)):
            if normalized_ranges:
                previous_start, previous_end, previous_domain = normalized_ranges[-1]
                if domain == "テクノロジ" and domain != previous_domain and 1 < start - previous_end <= 10:
                    start = previous_end + 1
            normalized_ranges.append((start, end, domain))
        return normalized_ranges
    # Current IT Passport public questions use this structure; keep this only as a fallback.
    return [(1, 34, "ストラテジ"), (35, 55, "マネジメント"), (56, 100, "テクノロジ")]


def domain_for(question_number: int, ranges: list[tuple[int, int, str]]) -> str:
    matches = [(start, domain) for start, end, domain in ranges if start <= question_number <= end]
    if matches:
        return sorted(matches)[-1][1]
    return "未分類"


def infer_domain_from_page_context(location: QuestionLocation, page_texts: dict[int, str]) -> str:
    domain_label = re.compile(r"^[\s\[\]【】〔〕\(\)（）\{｛]+(ストラテジ|マネジメント|テクノロジ)")
    checked_lines = 0
    for page in range(location.page, max(0, location.page - 4), -1):
        lines = page_texts.get(page, "").splitlines()
        start_index = location.line_index if page == location.page else len(lines) - 1
        for line in reversed(lines[: start_index + 1]):
            checked_lines += 1
            compact_line = line.replace(" ", "").replace("\u3000", "")
            if "ドラテジ" in compact_line:
                return "ストラテジ"
            match = domain_label.match(line)
            if match:
                return match.group(1)
            if checked_lines >= 90:
                break
        if checked_lines >= 90:
            break

    lines = page_texts.get(location.page, "").splitlines()
    context = "\n".join(lines[max(0, location.line_index - 6) : location.line_index + 2])
    for domain in ["ストラテジ", "マネジメント", "テクノロジ"]:
        if domain in context:
            return domain
    return "未分類"


def normalize_question_number(raw_text: str, expected_number: int, next_raw_text: str | None) -> int:
    if raw_text in {"]", "|", "I", "i", "l"}:
        raw_text = "1"
    raw_number = int(raw_text)
    if raw_number == expected_number:
        return expected_number
    if expected_number == 100 and raw_number in {100, 109, 169, 199}:
        return 100
    expected_text = str(expected_number)
    if len(raw_text) > len(expected_text):
        for index in range(len(raw_text)):
            if raw_text[:index] + raw_text[index + 1 :] == expected_text:
                return expected_number
    if expected_number >= 10 and raw_number > 100 and raw_text.startswith(str(expected_number)):
        return expected_number
    if raw_number > expected_number and raw_text.startswith(str(expected_number)):
        if next_raw_text and int(next_raw_text) == expected_number + 1:
            return expected_number
    if next_raw_text and int(next_raw_text) == expected_number + 1:
        if raw_number == expected_number - 1:
            return expected_number
        if len(raw_text) == len(expected_text) and raw_text[-1] == expected_text[-1]:
            return expected_number
        if expected_number // 10 == raw_number // 10:
            return expected_number
    if expected_number % 10 == 0:
        expected_next = next_raw_text and int(next_raw_text) == expected_number + 1
        expected_tens = str(expected_number // 10)
        if expected_next and (
            expected_number < raw_number < expected_number + 10
            or raw_number == expected_number // 10
            or raw_text.startswith(expected_tens)
        ):
            return expected_number
    return raw_number

def parse_question_locations(page_texts: dict[int, str]) -> dict[int, QuestionLocation]:
    candidates: list[tuple[int, int, str, str]] = []
    for page in sorted(page_texts):
        text = page_texts[page]
        for line_index, line in enumerate(text.splitlines()):
            match = re.match(r"^[\s、。・\._\-ー−―]*[問間癌同周則向]\s*(\d{1,3}|[\]\|Iil])(?!\d)(?!\s*から)", line)
            if match:
                candidates.append((page, line_index, match.group(1), line))

    mapping: dict[int, QuestionLocation] = {}
    expected = 1
    for index, (page, line_index, raw_text, line) in enumerate(candidates):
        next_raw_text = candidates[index + 1][2] if index + 1 < len(candidates) else None
        number = normalize_question_number(raw_text, expected, next_raw_text)
        if number == expected and 1 <= number <= 100:
            mapping[number] = QuestionLocation(page=page, line_index=line_index, raw_number=raw_text, line=line)
            expected += 1
    missing = [number for number in range(1, 101) if number not in mapping]
    if missing:
        raise RuntimeError(f"OCR did not locate question numbers: {missing[:20]}{'...' if len(missing) > 20 else ''}")
    return mapping


def parse_question_pages(page_texts: dict[int, str]) -> dict[int, int]:
    return {number: location.page for number, location in parse_question_locations(page_texts).items()}


def clean_ocr_line(line: str, question_number: int, is_first_line: bool) -> str:
    value = line.replace("\u3000", " ").strip()
    if is_first_line:
        value = re.sub(r"^[\s、。・\._\-ー−―]*[問間癌同周則向]\s*(?:\d{1,3}|[\]\|Iil])", f"問{question_number}", value)
    value = re.sub(r"\s+", " ", value)
    if re.match(r"^[ー\-−―=\s]*(\d{1,3}|[a-z]{1,4})[ー\-−―=\s]*(一|mm|we|ee|ca|se)?$", value, re.IGNORECASE):
        return ""
    return value.strip()


def extract_question_ocr_text(question_number: int, page_texts: dict[int, str], locations: dict[int, QuestionLocation]) -> str:
    start = locations[question_number]
    end = locations.get(question_number + 1)
    last_page = end.page if end else start.page
    lines_by_page = {page: text.splitlines() for page, text in page_texts.items()}
    captured: list[str] = []

    for page in range(start.page, last_page + 1):
        page_lines = lines_by_page.get(page, [])
        start_index = start.line_index if page == start.page else 0
        end_index = end.line_index if end and page == end.page else len(page_lines)
        for line_index, line in enumerate(page_lines[start_index:end_index], start=start_index):
            cleaned = clean_ocr_line(line, question_number, page == start.page and line_index == start.line_index)
            if cleaned:
                captured.append(cleaned)

    return "\n".join(captured).strip()


def split_choice_texts(text: str) -> tuple[str, list[dict]]:
    matches = list(re.finditer(r"(?m)(^|[ \t　])([アイウエ])[\s　]+", text))
    ordered_matches = []
    search_start = 0
    for label in KANA_CHOICES:
        match = next((item for item in matches if item.group(2) == label and item.start(2) >= search_start), None)
        if not match:
            return text.strip(), []
        ordered_matches.append(match)
        search_start = match.end()

    body = text[: ordered_matches[0].start(2)].strip()
    choices: list[dict] = []
    for index, match in enumerate(ordered_matches):
        next_start = ordered_matches[index + 1].start(2) if index + 1 < len(ordered_matches) else len(text)
        choice_text = text[match.end() : next_start]
        choice_text = normalize_text(choice_text.strip(" \n\t。．、,"))
        choices.append({"label": match.group(2), "text": choice_text})
    return body, choices


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


def build_markdown_transcription(body: str, choices: list[dict]) -> str:
    parts = [body.strip()]
    if choices:
        parts.append("")
        parts.extend(f"- {choice['label']}: {choice['text']}" for choice in choices)
    return "\n".join(part for part in parts if part != "").strip()


def build_latex_transcription(question_number: int, body: str, choices: list[dict]) -> str:
    lines = [rf"\paragraph{{問{question_number}}}", latex_escape(body).replace("\n", r"\\ " + "\n")]
    if choices:
        lines.append(r"\begin{description}")
        for choice in choices:
            lines.append(rf"\item[{choice['label']}] {latex_escape(choice['text'])}")
        lines.append(r"\end{description}")
    return "\n".join(lines).strip()


def build_question_transcription(question_number: int, page_texts: dict[int, str], locations: dict[int, QuestionLocation]) -> dict:
    raw_text = extract_question_ocr_text(question_number, page_texts, locations)
    body, choices = split_choice_texts(raw_text)
    markdown = build_markdown_transcription(body, choices)
    return {
        "status": "ocr_unreviewed",
        "language": "ja",
        "format": "markdown+latex",
        "engine": "tesseract-jpn",
        "rawText": raw_text,
        "text": body,
        "markdown": markdown,
        "latex": build_latex_transcription(question_number, body, choices),
        "choices": choices,
    }


def apply_override(record: dict, override: dict) -> dict:
    if not override:
        return record
    result = {**record, **{key: value for key, value in override.items() if key != "transcription"}}
    if "transcription" in override:
        result["transcription"] = {**record["transcription"], **override["transcription"]}
        result["searchText"] = normalize_text(
            " ".join(
                str(result["transcription"].get(key, ""))
                for key in ["rawText", "text", "markdown", "latex"]
            )
        )
        override_choices = result["transcription"].get("choices", [])
        transcribed_choices = [choice["text"] for choice in override_choices]
        if len(transcribed_choices) == 4 and all(transcribed_choices):
            result["choices"] = transcribed_choices
    return result


def build_exam_records(exam: ExamPdf, answers: list[str], page_texts: dict[int, str], page_paths: list[Path]) -> list[dict]:
    question_locations = parse_question_locations(page_texts)
    question_pages = {number: location.page for number, location in question_locations.items()}
    ranges = parse_domain_ranges(page_texts)
    overrides = load_overrides()
    records: list[dict] = []
    for number in range(1, 101):
        page_number = question_pages[number]
        domain = domain_for(number, ranges)
        if domain == "未分類":
            domain = infer_domain_from_page_context(question_locations[number], page_texts)
        transcription = build_question_transcription(number, page_texts, question_locations)
        transcribed_choices = [choice["text"] for choice in transcription["choices"]]
        choices = transcribed_choices if len(transcribed_choices) == 4 and all(transcribed_choices) else KANA_CHOICES
        image_path = f"/itpass/pages/{exam.exam_id}/page-{page_number:02d}.jpg"
        image_resource_path = f"itpass/pages/{exam.exam_id}/page-{page_number:02d}.jpg"
        source = f"出典：{exam.display_year} ITパスポート試験 問{number}"
        prompt = f"{exam.display_year} ITパスポート試験 問{number}"
        record_id = f"ip-{exam.exam_id}-q{number:03d}"
        record = {
                "id": record_id,
                "packId": "itpass",
                "subject": domain,
                "category": domain,
                "difficulty": "公式公開問題",
                "prompt": prompt,
                "choices": choices,
                "choiceLabels": KANA_CHOICES,
                "answer": KANA_CHOICES.index(answers[number - 1]),
                "answerKana": answers[number - 1],
                "explanation": f"公式解答は「{answers[number - 1]}」です。{source}",
                "source": source,
                "sourceUrl": exam.qs_url,
                "answerUrl": exam.ans_url,
                "examId": exam.exam_id,
                "examTitle": exam.display_year,
                "questionNumber": number,
                "page": page_number,
                "image": image_path,
                "imageResource": image_resource_path,
                "modified": False,
                "copyright": f"©{exam.copyright_year} 独立行政法人情報処理推進機構",
                "transcription": transcription,
                "searchText": normalize_text(transcription["rawText"]),
            }
        records.append(apply_override(record, overrides.get(record_id, {})))
    return records


def write_json(records: list[dict], exams: list[ExamPdf]) -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": 2,
        "generatedFrom": OFFICIAL_QUESTIONS_PAGE,
        "usageNote": "IPA公開過去問題を出典付きで使用。公式PDFページ画像を確認用正本として保持し、問題本文はOCR文字起こし、Markdown、LaTeX形式でも保持する。OCR文字起こしは未校正。",
        "exams": [exam.__dict__ for exam in exams],
        "questions": records,
    }
    (PROCESSED_DIR / "itpass-questions.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_web_json(records: list[dict]) -> None:
    WEB_QUESTIONS_JSON.parent.mkdir(parents=True, exist_ok=True)
    WEB_QUESTIONS_JSON.write_text(json.dumps(records, ensure_ascii=False) + "\n", encoding="utf-8")


def write_swift(records: list[dict]) -> None:
    IOS_QUESTIONS_JSON.parent.mkdir(parents=True, exist_ok=True)
    ios_records = [
        {
            "id": item["id"],
            "packID": "itpass",
            "subject": item["subject"],
            "category": item["category"],
            "difficulty": "公式公開問題",
            "prompt": item["prompt"],
            "choices": item["choices"],
            "answerIndex": item["answer"],
            "explanation": item["explanation"],
            "source": item["source"],
            "sourceURL": item["sourceUrl"],
            "examId": item["examId"],
            "examTitle": item["examTitle"],
            "imagePath": item["imageResource"],
            "transcriptionText": item["transcription"]["text"] or item["transcription"]["markdown"],
        }
        for item in records
    ]
    IOS_QUESTIONS_JSON.write_text(json.dumps(ios_records, ensure_ascii=False) + "\n", encoding="utf-8")

    swift = f"""import Foundation

enum LearningData {{
    static let packs: [LearningPack] = [
        LearningPack(
            id: "itpass",
            label: "ITパスポート",
            title: "ITパスポート公式公開問題",
            description: "IPAが公開しているITパスポート試験の公式過去問題。",
            exam: "{len(records):,}問 / 四肢択一",
            systemImage: "bolt.badge.checkmark"
        ),
    ]

    static let questions: [QuizQuestion] = loadQuestions()

    static func pack(for id: String) -> LearningPack? {{
        packs.first {{ $0.id == id }}
    }}

    private static func loadQuestions() -> [QuizQuestion] {{
        guard let url = Bundle.main.url(forResource: "questions", withExtension: "json", subdirectory: "itpass") else {{
            assertionFailure("Missing itpass/questions.json resource")
            return []
        }}
        do {{
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode([QuizQuestion].self, from: data)
        }} catch {{
            assertionFailure("Failed to decode itpass/questions.json: \\(error)")
            return []
        }}
    }}
}}
"""
    GENERATED_IOS_FILE.write_text(swift, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="Build all official PDFs. Default builds latest only.")
    parser.add_argument("--limit", type=int, default=None, help="Build the first N official entries from the manifest.")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    manifest = scrape_manifest()
    selected = manifest if args.all else manifest[:1]
    if args.limit:
        selected = manifest[: args.limit]

    all_records: list[dict] = []
    for exam in selected:
        print(f"Building {exam.exam_id}: {exam.title}", file=sys.stderr)
        qs_pdf = RAW_PDF_DIR / f"{exam.exam_id}_ip_qs.pdf"
        ans_pdf = RAW_PDF_DIR / f"{exam.exam_id}_ip_ans.pdf"
        download(exam.qs_url, qs_pdf)
        download(exam.ans_url, ans_pdf)
        answers = extract_answers(ans_pdf)
        page_images = render_pages(exam, qs_pdf, args.overwrite)
        page_texts = ocr_pages(exam, page_images, args.overwrite)
        all_records.extend(build_exam_records(exam, answers, page_texts, page_images))

    write_json(all_records, selected)
    write_web_json(all_records)
    write_swift(all_records)
    print(f"Wrote {len(all_records)} IT Passport questions from {len(selected)} official PDF set(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
