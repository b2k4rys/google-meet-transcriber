from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(title="Meet Recording Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/recordings")
async def upload_recording(file: UploadFile = File(...)) -> dict[str, str | int]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing uploaded filename.")

    suffix = Path(file.filename).suffix or ".webm"
    stored_name = f"{uuid4().hex}{suffix}"
    destination = UPLOAD_DIR / stored_name

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded recording is empty.")

    destination.write_bytes(content)

    return {
        "status": "received",
        "content": "Recording received successfully. Transcription is not implemented yet.",
        "original_filename": file.filename,
        "saved_filename": stored_name,
        "content_type": file.content_type or "application/octet-stream",
        "size_bytes": len(content),
        "saved_path": str(destination.resolve()),
    }
