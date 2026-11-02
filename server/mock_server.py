"""Tiny stand-in for the Hades server, for testing the app without a GPU.

Run:  pip install fastapi uvicorn python-multipart
      python server/mock_server.py      (listens on 0.0.0.0:8190)
"""
import io, math, struct, wave

import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"ok": True, "model": "mock"}


@app.post("/speak")
async def speak(ref_audio: UploadFile = File(...), ref_text: str = Form(""), text: str = Form(...), speed: float = Form(1.0)):
    await ref_audio.read()
    sr, seconds = 24000, min(1 + len(text) / 15 / speed, 10)
    frames = b"".join(
        struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / sr))) for i in range(int(sr * seconds))
    )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(frames)
    return Response(buf.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8190)
