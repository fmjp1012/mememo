#!/usr/bin/env python3
"""Compare low-cost OCR approaches on suspicious IT Passport questions."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.request import urlretrieve

from PIL import Image, ImageOps
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
QUESTIONS_JSON = ROOT / "public/itpass/questions.json"
FAST_TESSDATA_DIR = ROOT / "data/itpass/.cache/tessdata"
BEST_TESSDATA_DIR = ROOT / "data/itpass/.cache/tessdata_best"
BEST_TESSDATA_URL = "https://github.com/tesseract-ocr/tessdata_best/raw/main/jpn.traineddata"
BUNDLED_PDFTOPPM = Path("/Users/fmjp/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm")
REPORT_DIR = ROOT / "tmp/ocr-eval"
APPLE_VISION_SWIFT = ROOT / "scripts/ocr_apple_vision.swift"
APPLE_VISION_BIN = REPORT_DIR / "ocr_apple_vision"


@dataclass
class Candidate:
    score: float
    question: dict
    reasons: list[str]


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def suspicious_score(text: str, choices: list[dict] | None = None) -> tuple[float, list[str]]:
    reasons: list[str] = []
    score = 0.0
    if not text.strip():
        return 100.0, ["empty"]

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    ascii_words = re.findall(r"[A-Za-z]{2,}", text)
    odd_symbols = re.findall(r"[|{}\\_=~^%$#<>`]{1,}", text)
    orphan_lines = [
        line
        for line in lines
        if re.fullmatch(r"[\W_0-9A-Za-z]{1,12}", line)
        and not re.search(r"[ぁ-んァ-ン一-龥]", line)
    ]
    latin_noise = [word for word in ascii_words if word.lower() not in {"sql", "url", "web", "ip", "lan", "wan", "cpu", "ram", "rom", "pc"}]
    japanese_chars = len(re.findall(r"[ぁ-んァ-ン一-龥]", text))
    total_letters = len(re.findall(r"[ぁ-んァ-ン一-龥A-Za-z0-9]", text))
    jp_ratio = japanese_chars / total_letters if total_letters else 0

    if latin_noise:
        score += min(30, len(latin_noise) * 3)
        reasons.append(f"latin={len(latin_noise)}")
    if odd_symbols:
        score += min(25, sum(len(item) for item in odd_symbols) * 1.2)
        reasons.append(f"symbols={len(odd_symbols)}")
    if orphan_lines:
        score += min(20, len(orphan_lines) * 4)
        reasons.append(f"orphan={len(orphan_lines)}")
    if choices is not None and len(choices) != 4:
        score += 18
        reasons.append(f"choices={len(choices)}")
    if jp_ratio < 0.55:
        score += (0.55 - jp_ratio) * 40
        reasons.append(f"jp_ratio={jp_ratio:.2f}")
    if " | " in text or "||" in text:
        score += 8
        reasons.append("table_pipe")
    if len(text) < 80:
        score += 8
        reasons.append("short")
    return score, reasons


def load_candidates(limit: int) -> list[Candidate]:
    questions = json.loads(QUESTIONS_JSON.read_text(encoding="utf-8"))
    candidates: list[Candidate] = []
    for question in questions:
        transcription = question.get("transcription") or {}
        if transcription.get("status") == "human_reviewed":
            continue
        text = transcription.get("rawText") or transcription.get("markdown") or transcription.get("text") or ""
        score, reasons = suspicious_score(text, transcription.get("choices") or [])
        candidates.append(Candidate(score=score, question=question, reasons=reasons))
    return sorted(candidates, key=lambda item: item.score, reverse=True)[:limit]


def ensure_best_tessdata() -> None:
    trained = BEST_TESSDATA_DIR / "jpn.traineddata"
    if trained.exists() and trained.stat().st_size > 0:
        return
    BEST_TESSDATA_DIR.mkdir(parents=True, exist_ok=True)
    urlretrieve(BEST_TESSDATA_URL, trained)


def run_tesseract(image: Path, tessdata_dir: Path, psm: int) -> tuple[str, float]:
    env = os.environ.copy()
    env["TESSDATA_PREFIX"] = str(tessdata_dir)
    start = time.perf_counter()
    completed = subprocess.run(
        ["tesseract", str(image), "stdout", "-l", "jpn", "--psm", str(psm)],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    return completed.stdout.strip(), time.perf_counter() - start


def ensure_apple_vision_bin() -> Path | None:
    if not APPLE_VISION_SWIFT.exists() or not shutil.which("xcrun"):
        return None
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    if APPLE_VISION_BIN.exists() and APPLE_VISION_BIN.stat().st_mtime >= APPLE_VISION_SWIFT.stat().st_mtime:
        return APPLE_VISION_BIN
    subprocess.run(["xcrun", "swiftc", str(APPLE_VISION_SWIFT), "-o", str(APPLE_VISION_BIN)], check=True)
    return APPLE_VISION_BIN


def run_apple_vision(image: Path) -> tuple[str, float]:
    binary = ensure_apple_vision_bin()
    if not binary:
        raise RuntimeError("Apple Vision OCR binary is unavailable.")
    start = time.perf_counter()
    completed = subprocess.run([str(binary), str(image)], check=True, capture_output=True, text=True)
    return completed.stdout.strip(), time.perf_counter() - start


def preprocess_image(source: Path, target: Path) -> Path:
    image = Image.open(source).convert("L")
    image = ImageOps.autocontrast(image)
    image = image.resize((image.width * 2, image.height * 2), Image.Resampling.LANCZOS)
    image = ImageOps.autocontrast(image)
    image = image.point(lambda px: 0 if px < 185 else 255, "1")
    image.save(target)
    return target


def render_high_res_page(question: dict, target: Path, dpi: int) -> Path | None:
    exam_id = question["id"].removeprefix("ip-").rsplit("-q", 1)[0]
    page_match = re.search(r"/page-(\d+)\.jpg$", question["image"])
    if not page_match:
        return None
    page = int(page_match.group(1))
    pdf = ROOT / "data/itpass/raw/pdf" / f"{exam_id}_ip_qs.pdf"
    if not pdf.exists():
        return None
    pdftoppm = BUNDLED_PDFTOPPM if BUNDLED_PDFTOPPM.exists() else shutil.which("pdftoppm")
    if not pdftoppm:
        return None
    prefix = target.with_suffix("")
    subprocess.run(
        [str(pdftoppm), "-r", str(dpi), "-f", str(page), "-l", str(page), "-png", str(pdf), str(prefix)],
        check=True,
        capture_output=True,
    )
    rendered = next(target.parent.glob(f"{prefix.name}-*.png"))
    image = Image.open(rendered).convert("RGB")
    width, height = image.size
    image = image.crop((int(width * 0.07), int(height * 0.04), int(width * 0.93), int(height * 0.96)))
    image.save(target)
    rendered.unlink(missing_ok=True)
    return target


def extract_pdf_page_text(question: dict) -> str:
    exam_id = question["id"].removeprefix("ip-").rsplit("-q", 1)[0]
    page_match = re.search(r"/page-(\d+)\.jpg$", question["image"])
    if not page_match:
        return ""
    page_index = int(page_match.group(1)) - 1
    pdf = ROOT / "data/itpass/raw/pdf" / f"{exam_id}_ip_qs.pdf"
    if not pdf.exists():
        return ""
    reader = PdfReader(str(pdf))
    if page_index >= len(reader.pages):
        return ""
    return (reader.pages[page_index].extract_text() or "").strip()


def resolve_public_image(path: str) -> Path:
    normalized = path.lstrip("/")
    if normalized.startswith("itpass/"):
        return ROOT / "public" / normalized
    return ROOT / normalized


def extract_question_window(text: str, question_number: int) -> str:
    if not text.strip():
        return ""
    marker = re.compile(rf"(?:^|\s)[問間]\s*{question_number}(?!\d)")
    next_marker = re.compile(rf"(?:^|\s)[問間]\s*{question_number + 1}(?!\d)")
    start = marker.search(text)
    if not start:
        return text.strip()
    end = next_marker.search(text, start.end())
    if end:
        return text[start.start() : end.start()].strip()
    return text[start.start() :].strip()


def method_result(name: str, text: str, elapsed: float, question_number: int) -> dict:
    question_text = extract_question_window(text, question_number)
    score, reasons = suspicious_score(question_text)
    return {
        "name": name,
        "score": round(score, 2),
        "seconds": round(elapsed, 2),
        "chars": len(question_text),
        "reasons": reasons,
        "sample": normalize(question_text)[:500],
    }


def evaluate(limit: int) -> dict:
    ensure_best_tessdata()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    candidates = load_candidates(limit)
    all_results = []
    for candidate in candidates:
        question = candidate.question
        qid = question["id"]
        question_number = int(qid.rsplit("-q", 1)[1])
        image = resolve_public_image(question["image"])
        work_dir = REPORT_DIR / qid
        work_dir.mkdir(parents=True, exist_ok=True)
        preprocessed = preprocess_image(image, work_dir / "preprocessed.png")
        highres = render_high_res_page(question, work_dir / "highres-360.png", 360)

        original_text = question.get("transcription", {}).get("rawText", "")
        results = [method_result("current-json", original_text, 0.0, question_number)]
        for name, tessdata, psm, target_image in [
            ("fast-psm6-page-jpeg", FAST_TESSDATA_DIR, 6, image),
            ("best-psm6-page-jpeg", BEST_TESSDATA_DIR, 6, image),
            ("best-psm4-page-jpeg", BEST_TESSDATA_DIR, 4, image),
            ("best-psm11-page-jpeg", BEST_TESSDATA_DIR, 11, image),
            ("best-psm6-preprocessed", BEST_TESSDATA_DIR, 6, preprocessed),
        ]:
            try:
                text, elapsed = run_tesseract(target_image, tessdata, psm)
                results.append(method_result(name, text, elapsed, question_number))
            except Exception as error:
                results.append({"name": name, "error": str(error)})
        try:
            text, elapsed = run_apple_vision(image)
            results.append(method_result("apple-vision-accurate", text, elapsed, question_number))
        except Exception as error:
            results.append({"name": "apple-vision-accurate", "error": str(error)})
        if highres:
            try:
                text, elapsed = run_tesseract(highres, BEST_TESSDATA_DIR, 6)
                results.append(method_result("best-psm6-360dpi", text, elapsed, question_number))
            except Exception as error:
                results.append({"name": "best-psm6-360dpi", "error": str(error)})
        pdf_start = time.perf_counter()
        pdf_text = extract_pdf_page_text(question)
        results.append(method_result("pypdf-page-text", pdf_text, time.perf_counter() - pdf_start, question_number))

        ranked = sorted([item for item in results if "score" in item], key=lambda item: item["score"])
        all_results.append(
            {
                "id": qid,
                "title": question.get("source"),
                "detected_score": round(candidate.score, 2),
                "detected_reasons": candidate.reasons,
                "best": ranked[0]["name"] if ranked else None,
                "results": results,
            }
        )
    return {"candidates": all_results}


def write_markdown(report: dict, target: Path) -> None:
    lines = ["# OCR method evaluation", ""]
    for item in report["candidates"]:
        lines.extend(
            [
                f"## {item['id']} - {item.get('title') or ''}",
                f"- suspicious score: {item['detected_score']} ({', '.join(item['detected_reasons'])})",
                f"- best by heuristic: {item['best']}",
                "",
            ]
        )
        for result in item["results"]:
            if "error" in result:
                lines.append(f"### {result['name']}: ERROR")
                lines.append(result["error"])
                lines.append("")
                continue
            lines.append(f"### {result['name']} - score {result['score']}, {result['seconds']}s, {result['chars']} chars")
            if result["reasons"]:
                lines.append(f"- reasons: {', '.join(result['reasons'])}")
            lines.append("")
            lines.append("```text")
            lines.append(result["sample"])
            lines.append("```")
            lines.append("")
    target.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()
    report = evaluate(args.limit)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = REPORT_DIR / "report.json"
    md_path = REPORT_DIR / "report.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_markdown(report, md_path)
    print(f"Wrote {md_path}")


if __name__ == "__main__":
    main()
