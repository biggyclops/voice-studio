"""Voice Studio server for Hades: F5-TTS behind a small HTTP API.

GET  /health -> {"ok": true, "model": "F5-TTS"}
POST /speak  multipart: ref_audio (wav file), ref_text (str, may be empty),
             text (str), speed (float) -> audio/wav

Run:  python server/f5_server.py   (listens on 0.0.0.0:8190)
"""
import os, tempfile, threading

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from f5_tts.api import F5TTS

MODEL = os.environ.get("F5_MODEL", "F5TTS_v1_Base")
tts = F5TTS(model=MODEL)  # downloads weights from Hugging Face on first run
lock = threading.Lock()  # one generation at a time on the GPU

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"ok": True, "model": "F5-TTS"}


@app.post("/speak")
def speak(ref_audio: UploadFile = File(...), ref_text: str = Form(""), text: str = Form(...), speed: float = Form(1.0)):
    if not text.strip():
        raise HTTPException(400, "text is empty")
    speed = max(0.5, min(speed, 2.0))
    with tempfile.TemporaryDirectory() as d:
        ref_path, out_path = os.path.join(d, "ref.wav"), os.path.join(d, "out.wav")
        with open(ref_path, "wb") as f:
            f.write(ref_audio.file.read())
        with lock:
            # Empty ref_text makes F5-TTS transcribe the sample with Whisper.
            tts.infer(ref_file=ref_path, ref_text=ref_text, gen_text=text, speed=speed, file_wave=out_path)
        with open(out_path, "rb") as f:
            return Response(f.read(), media_type="audio/wav")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8190")))
