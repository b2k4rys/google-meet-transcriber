import asyncio
import mimetypes
import os
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

SUMMARY_PROMPT = """
You are summarizing a Google Meet audio recording from Google Meet.

Return:
1. A concise meeting summary in 5-8 sentences.
2. A flat bullet list of key points.
3. A flat bullet list of action items with owners if they are mentioned.

If the recording has little or no intelligible speech, say that clearly.
""".strip()
FILE_ACTIVE_TIMEOUT_SECONDS = 60
FILE_ACTIVE_POLL_INTERVAL_SECONDS = 2


app = FastAPI(title="Meet Recording Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def detect_mime_type(file_path: Path, uploaded_content_type: str | None) -> str:
    if uploaded_content_type and uploaded_content_type != "application/octet-stream":
        return uploaded_content_type

    guessed_type, _ = mimetypes.guess_type(file_path.name)
    return guessed_type or "video/webm"


def normalize_gemini_mime_type(file_path: Path, detected_mime_type: str) -> str:
    if file_path.suffix.lower() == ".webm":
        return "video/webm"

    return detected_mime_type


def build_gemini_client() -> genai.Client:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    return genai.Client(api_key=GEMINI_API_KEY)


def wait_for_file_active(client: genai.Client, file_name: str):
    deadline = time.monotonic() + FILE_ACTIVE_TIMEOUT_SECONDS

    while time.monotonic() < deadline:
        current = client.files.get(name=file_name)
        state = getattr(current.state, "name", None) or str(current.state)

        if state == "ACTIVE":
            return current

        if state in {"FAILED", "CANCELLED"}:
            raise RuntimeError(f"Gemini file processing failed with state {state}.")

        time.sleep(FILE_ACTIVE_POLL_INTERVAL_SECONDS)

    raise RuntimeError("Timed out waiting for Gemini file processing to become ACTIVE.")


def summarize_recording_with_gemini(file_path: Path, mime_type: str) -> dict[str, Any]:
    client = build_gemini_client()
    gemini_mime_type = normalize_gemini_mime_type(file_path, mime_type)
    uploaded_file = client.files.upload(
        file=str(file_path),
        config={"mime_type": gemini_mime_type},
    )
    active_file = wait_for_file_active(client, uploaded_file.name)

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[active_file, SUMMARY_PROMPT],
    )

    summary_text = (response.text or "").strip()
    if not summary_text:
        raise RuntimeError("Gemini returned an empty summary.")

    return {
        "summary": summary_text,
        "model": GEMINI_MODEL,
        "mime_type": mime_type,
        "gemini_mime_type": gemini_mime_type,
        "file_name": active_file.name,
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/recordings")
async def upload_recording(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing uploaded filename.")

    suffix = Path(file.filename).suffix or ".webm"
    stored_name = f"{uuid4().hex}{suffix}"
    destination = UPLOAD_DIR / stored_name

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded recording is empty.")

    destination.write_bytes(content)
    mime_type = detect_mime_type(destination, file.content_type)

    summary_status = "skipped"
    summary_result: dict[str, Any] | None = None
    summary_error: str | None = None

    try:
        summary_result = await asyncio.to_thread(summarize_recording_with_gemini, destination, mime_type)
        summary_status = "completed"
    except Exception as error:
        summary_status = "failed"
        summary_error = str(error)

    return {
        "status": "received",
        "content": summary_result["summary"] if summary_result else "Recording saved, but Gemini summary is unavailable.",
        "summary": summary_result["summary"] if summary_result else None,
        "summary_status": summary_status,
        "summary_model": summary_result["model"] if summary_result else None,
        "gemini_mime_type": summary_result["gemini_mime_type"] if summary_result else None,
        "gemini_file_name": summary_result["file_name"] if summary_result else None,
        "summary_error": summary_error,
        "original_filename": file.filename,
        "saved_filename": stored_name,
        "content_type": mime_type,
        "size_bytes": len(content),
        "saved_path": str(destination.resolve()),
    }
