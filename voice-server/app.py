"""Small HTTP adapter for the user-selected Indie-VOICE TTS repository."""

from __future__ import annotations

import importlib.util
import os
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parent
INDIE_SCRIPT = Path(os.getenv("INDIE_VOICE_SCRIPT", ROOT / "Indie-VOICE" / "Text_To_Speech.py"))
AUDIO_DIR = Path(tempfile.gettempdir()) / "bentown-indie-voice"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
VOICE_STYLE = (
    "A warm, friendly Indian English woman speaking clearly and slowly to a young child named Oshu. "
    "Gentle, cheerful, natural conversational delivery with soft expressive intonation."
)
engine: Any = None
engine_lock = threading.Lock()


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    voice_style: str | None = Field(default=None, max_length=256)


@asynccontextmanager
async def lifespan(_: FastAPI):
    global engine
    if not INDIE_SCRIPT.is_file():
        raise RuntimeError(
            f"Indie-VOICE source not found at {INDIE_SCRIPT}. Clone the GitHub repository into voice-server/Indie-VOICE."
        )

    spec = importlib.util.spec_from_file_location("indie_voice_engine", INDIE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load Indie-VOICE Text_To_Speech.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Indie-VOICE normally asks Gemini to re-describe a voice for each utterance.
    # A fixed guide voice avoids an extra LLM request on every short game line.
    engine = module.IndicTTSLLM(batch_size=1, gemini_api_key="voice-prompt-disabled")
    engine.generate_voice_description = lambda _prompt: VOICE_STYLE
    yield
    engine = None


app = FastAPI(title="BenTown Indie-VOICE bridge", lifespan=lifespan)
app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ready" if engine is not None else "starting", "engine": "Indie-VOICE"}


@app.post("/synthesize")
def synthesize(payload: SpeechRequest, request: Request) -> dict[str, str]:
    if engine is None:
        raise HTTPException(status_code=503, detail="Indie-VOICE is still loading")

    now = time.time()
    for old_file in AUDIO_DIR.glob("*.wav"):
        try:
            if now - old_file.stat().st_mtime > 3600:
                old_file.unlink()
        except OSError:
            pass

    output = AUDIO_DIR / f"{uuid.uuid4().hex}.wav"
    try:
        with engine_lock:
            engine.synthesize(payload.text, VOICE_STYLE, str(output))
    except Exception as error:
        output.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Indie-VOICE synthesis failed") from error

    if not output.is_file() or output.stat().st_size == 0:
        raise HTTPException(status_code=500, detail="Indie-VOICE returned no audio")
    return {"audio_url": str(request.url_for("audio", path=output.name))}
