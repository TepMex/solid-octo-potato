#!/usr/bin/env python3
"""
Preprocess exam images in RawData/ using a vision-language model (OpenAI-compatible API).

Setup:
  cd /path/to/EnergyTests
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
  cp .env.example .env
  # Set BASE_URL, API_TOKEN, MODEL in .env

Run:
  python scripts/preprocess_vlm.py

Environment (see .env.example):
  BASE_URL, API_TOKEN, MODEL — required
  RAW_DATA_DIR, OUTPUT_PATH, REQUEST_TIMEOUT, MAX_RETRIES — optional
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import APIConnectionError, APIStatusError, OpenAI, RateLimitError

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

REPO_ROOT = Path(__file__).resolve().parent.parent

SYSTEM_PROMPT = """You extract a single multiple-choice (or short-answer) examination item from a photo.
Transcribe the question and every answer option as faithfully as possible to the source language and wording.
If the image shows multiple questions, use only the first complete question and its options.
Set isCorrect to true only for options that are clearly marked correct in the image (e.g. checkmark, answer key, bold highlight). If nothing is marked, set all isCorrect to false.
Respond with a single JSON object only. No markdown, no code fences, no text before or after the JSON."""

USER_PROMPT = """Return exactly this JSON shape (keys and types):
{
  "img": "<filename will be set by the pipeline; you may use a placeholder>",
  "question": "<string>",
  "answers": [
    {"id": <integer 1,2,3,...>, "answer": "<string>", "isCorrect": <true or false>}
  ]
}
Number answer ids from 1 upward in display order."""


def load_config() -> dict:
    load_dotenv()
    base_url = os.environ.get("BASE_URL", "").strip()
    api_token = os.environ.get("API_TOKEN", "").strip()
    model = os.environ.get("MODEL", "").strip()
    if not base_url or not api_token or not model:
        print(
            "Missing required env: BASE_URL, API_TOKEN, MODEL. Copy .env.example to .env and fill values.",
            file=sys.stderr,
        )
        sys.exit(1)
    raw_dir = Path(os.environ.get("RAW_DATA_DIR", str(REPO_ROOT / "RawData"))).expanduser()
    out_path = Path(os.environ.get("OUTPUT_PATH", str(REPO_ROOT / "processed" / "tasks.jsonl"))).expanduser()
    timeout = float(os.environ.get("REQUEST_TIMEOUT", "120"))
    max_retries = int(os.environ.get("MAX_RETRIES", "5"))
    return {
        "base_url": base_url.rstrip("/"),
        "api_token": api_token,
        "model": model,
        "raw_dir": raw_dir,
        "output_path": out_path,
        "timeout": timeout,
        "max_retries": max_retries,
    }


def list_images(raw_dir: Path) -> list[Path]:
    if not raw_dir.is_dir():
        print(f"RAW_DATA_DIR is not a directory: {raw_dir}", file=sys.stderr)
        sys.exit(1)
    paths = []
    for p in raw_dir.iterdir():
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS:
            paths.append(p)
    return sorted(paths, key=lambda x: x.name.lower())


def load_processed_basenames(output_path: Path) -> set[str]:
    if not output_path.is_file():
        return set()
    done: set[str] = set()
    with output_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                img = obj.get("img")
                if isinstance(img, str) and img:
                    done.add(Path(img).name)
            except json.JSONDecodeError:
                continue
    return done


def image_to_data_url(path: Path) -> str:
    ext = path.suffix.lower()
    mime = MIME_BY_EXT.get(ext, "image/jpeg")
    data = path.read_bytes()
    b64 = base64.standard_b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"


def strip_json_fence(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```(?:json)?\s*\n?", text, re.IGNORECASE)
    if m:
        text = text[m.end() :]
    if text.endswith("```"):
        text = text[: -3].strip()
    return text.strip()


def parse_model_json(content: str) -> dict:
    content = strip_json_fence(content)
    return json.loads(content)


def as_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in ("true", "1", "yes")
    return False


def normalize_answer_id(v) -> int:
    if isinstance(v, bool):
        raise ValueError("answer id cannot be boolean")
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v == int(v):
        return int(v)
    if isinstance(v, str):
        s = v.strip()
        if s.isdigit() or (s.startswith("-") and s[1:].isdigit()):
            return int(s)
    raise ValueError(f"invalid answer id: {v!r}")


def validate_and_normalize_record(obj: dict, basename: str) -> dict:
    if not isinstance(obj, dict):
        raise ValueError("root must be a JSON object")
    q = obj.get("question")
    if not isinstance(q, str) or not q.strip():
        raise ValueError('"question" must be a non-empty string')
    answers = obj.get("answers")
    if not isinstance(answers, list) or not answers:
        raise ValueError('"answers" must be a non-empty array')
    norm_answers = []
    for i, a in enumerate(answers):
        if not isinstance(a, dict):
            raise ValueError(f"answers[{i}] must be an object")
        aid = normalize_answer_id(a.get("id"))
        ans = a.get("answer")
        if not isinstance(ans, str):
            raise ValueError(f"answers[{i}].answer must be a string")
        correct = as_bool(a.get("isCorrect"))
        norm_answers.append({"id": aid, "answer": ans, "isCorrect": correct})
    return {
        "img": basename,
        "question": q.strip(),
        "answers": norm_answers,
    }


def call_vlm(
    client: OpenAI,
    model: str,
    image_path: Path,
    max_retries: int,
) -> str:
    data_url = image_to_data_url(image_path)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": USER_PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        },
    ]
    attempt = 0
    last_err: Exception | None = None
    while attempt <= max_retries:
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.1,
            )
            choice = resp.choices[0]
            content = choice.message.content
            if not content or not str(content).strip():
                raise ValueError("empty model response")
            return str(content).strip()
        except RateLimitError as e:
            last_err = e
        except APIConnectionError as e:
            last_err = e
        except APIStatusError as e:
            last_err = e
            code = getattr(e, "status_code", None) or getattr(e, "code", None)
            if code is not None and code not in (429, 500, 502, 503, 504):
                raise
        attempt += 1
        if attempt > max_retries:
            break
        delay = min(2**attempt, 60)
        print(f"  retry {attempt}/{max_retries} after {delay}s ({last_err})", file=sys.stderr)
        time.sleep(delay)
    assert last_err is not None
    raise last_err


def append_jsonl(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def main() -> None:
    cfg = load_config()
    raw_dir = cfg["raw_dir"]
    output_path = cfg["output_path"]
    client = OpenAI(
        base_url=cfg["base_url"],
        api_key=cfg["api_token"],
        timeout=cfg["timeout"],
    )

    images = list_images(raw_dir)
    if not images:
        print(f"No images found under {raw_dir}", file=sys.stderr)
        sys.exit(1)

    done = load_processed_basenames(output_path)
    to_run = [p for p in images if p.name not in done]
    print(f"Images total: {len(images)}, already done: {len(done)}, to process: {len(to_run)}", file=sys.stderr)

    failed: list[tuple[str, str]] = []
    for i, path in enumerate(to_run, start=1):
        print(f"[{i}/{len(to_run)}] {path.name}", file=sys.stderr)
        try:
            content = call_vlm(client, cfg["model"], path, cfg["max_retries"])
            raw = parse_model_json(content)
            record = validate_and_normalize_record(raw, path.name)
            append_jsonl(output_path, record)
            print(f"  OK -> {output_path}", file=sys.stderr)
        except Exception as e:
            msg = str(e)
            print(f"  FAIL: {msg}", file=sys.stderr)
            failed.append((path.name, msg))

    if failed:
        print("\nFailed images:", file=sys.stderr)
        for name, err in failed:
            print(f"  {name}: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
