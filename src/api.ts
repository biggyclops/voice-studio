// Thin layer over the Rust commands. When the page is opened in a plain
// browser (no Tauri), a small in-memory stand-in is used so the UI can be
// clicked through against server/mock_server.py.
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export interface Voice { id: string; name: string; duration: number; transcript: string; }
export interface Clip { id: string; voice: string; text: string; created: number; }

export interface Api {
  pickSample(): Promise<{ path: string; name: string } | null>;
  listVoices(): Promise<Voice[]>;
  addVoice(name: string, path: string, start: number, end: number, transcript: string): Promise<Voice>;
  deleteVoice(id: string): Promise<void>;
  voiceAudio(id: string): Promise<Blob>;
  listClips(): Promise<Clip[]>;
  speak(server: string, voiceId: string, text: string, speed: number): Promise<Clip>;
  clipAudio(id: string): Promise<Blob>;
  saveClip(id: string): Promise<boolean>;
  health(server: string): Promise<string>;
}

const wav = (bytes: ArrayBuffer) => new Blob([bytes], { type: "audio/wav" });

const tauriApi: Api = {
  async pickSample() {
    const path = await open({
      multiple: false,
      filters: [{ name: "Audio or video", extensions: ["wav", "mp3", "m4a", "mp4", "mov"] }],
    });
    if (!path || Array.isArray(path)) return null;
    return { path, name: path.split("/").pop() ?? path };
  },
  listVoices: () => invoke("list_voices"),
  addVoice: (name, path, start, end, transcript) => invoke("add_voice", { name, path, start, end, transcript }),
  deleteVoice: (id) => invoke("delete_voice", { id }),
  voiceAudio: async (id) => wav(await invoke<ArrayBuffer>("voice_audio", { id })),
  listClips: () => invoke("list_clips"),
  speak: (server, voiceId, text, speed) => invoke("speak", { server, voiceId, text, speed }),
  clipAudio: async (id) => wav(await invoke<ArrayBuffer>("clip_audio", { id })),
  async saveClip(id) {
    const dest = await save({ defaultPath: `voice-studio-${id}.wav`, filters: [{ name: "WAV", extensions: ["wav"] }] });
    if (!dest) return false;
    await invoke("save_clip", { id, dest });
    return true;
  },
  health: (server) => invoke("health", { server }),
};

function browserApi(): Api {
  const voices: (Voice & { blob: Blob })[] = [];
  const clips: (Clip & { blob: Blob })[] = [];
  const files = new Map<string, File>();
  const id = () => Math.random().toString(36).slice(2, 10);
  return {
    pickSample: () =>
      new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".wav,.mp3,.m4a,.mp4,.mov";
        input.onchange = () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          files.set(f.name, f);
          resolve({ path: f.name, name: f.name });
        };
        input.click();
      }),
    listVoices: async () => voices.map(({ blob, ...v }) => v),
    async addVoice(name, path, start, end, transcript) {
      const v = { id: id(), name, duration: end - start, transcript, blob: files.get(path) ?? new Blob() };
      voices.push(v);
      return v;
    },
    async deleteVoice(vid) { voices.splice(voices.findIndex((v) => v.id === vid), 1); },
    voiceAudio: async (vid) => voices.find((v) => v.id === vid)!.blob,
    listClips: async () => clips.map(({ blob, ...c }) => c),
    async speak(server, voiceId, text, speed) {
      const v = voices.find((x) => x.id === voiceId)!;
      const form = new FormData();
      form.append("ref_audio", v.blob, "ref.wav");
      form.append("ref_text", v.transcript);
      form.append("text", text);
      form.append("speed", String(speed));
      const r = await fetch(`${server.replace(/\/$/, "")}/speak`, { method: "POST", body: form });
      if (!r.ok) throw new Error(`Server returned ${r.status}: ${await r.text()}`);
      const c = { id: id(), voice: v.name, text, created: Date.now(), blob: await r.blob() };
      clips.unshift(c);
      clips.splice(20);
      return c;
    },
    clipAudio: async (cid) => clips.find((c) => c.id === cid)!.blob,
    async saveClip(cid) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(clips.find((c) => c.id === cid)!.blob);
      a.download = `voice-studio-${cid}.wav`;
      a.click();
      return true;
    },
    async health(server) {
      const r = await fetch(`${server.replace(/\/$/, "")}/health`);
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
      const j = await r.json();
      if (!j.ok) throw new Error("Server is not ready");
      return j.model ?? "unknown model";
    },
  };
}

export const api: Api = "__TAURI_INTERNALS__" in window ? tauriApi : browserApi();
