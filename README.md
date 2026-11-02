# Voice Studio

A small Mac app that reads text aloud in a cloned voice. Add a voice from a short audio or video sample, type some text, click **Speak**, and save the result as a `.wav`. The voice model (F5-TTS) runs on a separate GPU machine ("Hades"); voice samples and clips stay on your Mac.

## Consent

Only clone voices you have permission to use: your own, or someone who agreed to it. The app will not add a voice unless you tick **"I have this person's permission to clone their voice."**

## Using it

- **Voices:** enter a name, choose a `.wav`, `.mp3`, `.m4a`, `.mp4` or `.mov` file, pick start/end seconds (default first 20 s, max 30 s), optionally type what is said, tick the permission box, then **Add voice**. The sample is converted to a 24 kHz mono wav with ffmpeg.
- **Speak:** pick a voice, type text, set speed (0.7–1.3), **Speak**, then **Save .wav**. The last 20 clips are kept in History.
- **Settings:** the Hades server URL (default `http://hades:8190`) and **Test Connection**.

Data lives in `~/Library/Application Support/com.biggyclops.voicestudio/` (`voices/voices.json` + wavs, `clips/clips.json` + wavs). No accounts, no telemetry.

## Installing (unsigned app)

Download the `.dmg` from Releases (or the PR build artifact), drag Voice Studio to Applications. The app is not signed, so the first time: right-click it and choose **Open**, or go to **System Settings > Privacy & Security** and click **Open Anyway**.

## ffmpeg

ffmpeg is bundled as a Tauri sidecar (`externalBin: binaries/ffmpeg`). CI downloads static macOS builds from [osxexperts.net](https://www.osxexperts.net) (arm64 and Intel), merges them with `lipo` into `src-tauri/binaries/ffmpeg-universal-apple-darwin`, and Tauri copies it next to the app binary. At runtime the app uses that copy, and falls back to `/opt/homebrew/bin/ffmpeg` or `/usr/local/bin/ffmpeg`; if none is found it shows a clear error. `src-tauri/binaries/` is git-ignored.

## Development

Needs Node 20+, Rust stable, Xcode command line tools.

```sh
npm install
mkdir -p src-tauri/binaries
cp "$(which ffmpeg)" "src-tauri/binaries/ffmpeg-$(rustc -vV | sed -n 's/host: //p')"   # sidecar for dev
npm run tauri dev
```

The frontend also opens in a plain browser (`npm run dev`, http://localhost:1420) using an in-memory stand-in for the Rust side, which talks straight to the server. Handy with the mock server below.

Build a universal dmg:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
# put a universal ffmpeg at src-tauri/binaries/ffmpeg-universal-apple-darwin (see the workflow)
npx tauri build --target universal-apple-darwin
```

CI (`.github/workflows/build.yml`) builds the universal dmg on every pull request and uploads it as an artifact. On push to `main` it publishes GitHub Release `v<version>` (version from `src-tauri/tauri.conf.json`).

## Hades server

The app talks to a tiny HTTP API:

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/health` | – | `{"ok": true, "model": "F5-TTS"}` |
| POST | `/speak` | multipart: `ref_audio` (wav file), `ref_text` (string, may be empty → server transcribes), `text` (string), `speed` (float) | `audio/wav` |

Reference implementation: `server/f5_server.py` (FastAPI + the `f5-tts` package, `F5TTS().infer(ref_file, ref_text, gen_text, speed=..., file_wave=...)`).

Setup on Hades (Linux, NVIDIA GPU):

```sh
python3 -m venv ~/voice-studio-env && source ~/voice-studio-env/bin/activate
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install -r server/requirements.txt
python server/f5_server.py        # 0.0.0.0:8190; first run downloads model weights
```

Make sure port 8190 is reachable from the Mac (and that `hades` resolves, or use its IP in Settings).

For testing without a GPU: `pip install fastapi uvicorn python-multipart && python server/mock_server.py` returns a sine-wave wav.

## Not in v0.1

In-app recording, emotion/style controls, batch jobs, Windows, code signing.

> **Setup note:** the workflow lives at `ci/build.yml` until it is moved to `.github/workflows/build.yml` (the bot's GitHub token couldn't write workflow files). Move it on GitHub ("Add file" or edit path) to turn CI on.
