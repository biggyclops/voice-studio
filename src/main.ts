import { api, Voice } from "./api";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const DEFAULT_SERVER = "http://hades:8190";
const server = () => localStorage.getItem("server") || DEFAULT_SERVER;

function msg(id: string, text: string, kind: "" | "ok" | "err" = "") {
  const el = $(id);
  el.textContent = text;
  el.className = `msg ${kind}`;
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- tabs
function show(tab: string) {
  document.querySelectorAll<HTMLElement>(".screen").forEach((s) => s.classList.toggle("hidden", s.id !== tab));
  document.querySelectorAll<HTMLElement>(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
}
document.querySelectorAll<HTMLElement>(".tab").forEach((b) => (b.onclick = () => show(b.dataset.tab!)));
$("manage").onclick = () => show("voices");

// ---- voices
let voices: Voice[] = [];
let picked: { path: string; name: string } | null = null;

async function refreshVoices() {
  voices = await api.listVoices();
  const select = $<HTMLSelectElement>("voice");
  const prev = select.value;
  select.innerHTML = voices.length
    ? voices.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join("")
    : `<option value="">No voices yet</option>`;
  if (voices.some((v) => v.id === prev)) select.value = prev;

  const list = $("voiceList");
  list.innerHTML = voices.length ? "" : `<li class="muted">No voices yet. Add one above.</li>`;
  for (const v of voices) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="grow">${esc(v.name)} <span class="muted">sample ${Math.round(v.duration)}s</span></span>`;
    li.append(
      button("Play", async () => playBlob($<HTMLAudioElement>("samplePlayer"), await api.voiceAudio(v.id))),
      button("Delete", async () => {
        if (!confirm(`Delete voice "${v.name}"?`)) return;
        await api.deleteVoice(v.id);
        refreshVoices();
      }),
    );
    list.append(li);
  }
  updateSpeak();
}

function updateAdd() {
  const ok = $<HTMLInputElement>("vName").value.trim() && picked && $<HTMLInputElement>("vConsent").checked;
  $<HTMLButtonElement>("add").disabled = !ok;
}
["vName", "vConsent"].forEach((id) => ($(id).oninput = updateAdd));
$("vConsent").onchange = updateAdd;

$("pick").onclick = async () => {
  picked = await api.pickSample();
  $("pickName").textContent = picked ? picked.name : "No file chosen";
  updateAdd();
};

$("add").onclick = async () => {
  const start = Number($<HTMLInputElement>("vStart").value) || 0;
  const end = Number($<HTMLInputElement>("vEnd").value) || 20;
  if (end <= start) return msg("voiceMsg", "End must be after start.", "err");
  if (end - start > 30) return msg("voiceMsg", "Keep the sample to 30 seconds or less.", "err");
  const add = $<HTMLButtonElement>("add");
  add.disabled = true;
  msg("voiceMsg", "Preparing sample...");
  try {
    const v = await api.addVoice($<HTMLInputElement>("vName").value.trim(), picked!.path, start, end, $<HTMLTextAreaElement>("vText").value.trim());
    msg("voiceMsg", `Added "${v.name}".`, "ok");
    $<HTMLInputElement>("vName").value = "";
    $<HTMLTextAreaElement>("vText").value = "";
    $<HTMLInputElement>("vConsent").checked = false;
    picked = null;
    $("pickName").textContent = "No file chosen";
    await refreshVoices();
  } catch (e) {
    msg("voiceMsg", errText(e), "err");
  }
  updateAdd();
};

// ---- speak
const speed = $<HTMLInputElement>("speed");
speed.oninput = () => ($("speedVal").textContent = `${Number(speed.value).toFixed(2)}x`);
let currentClip: string | null = null;

function updateSpeak() {
  const b = $<HTMLButtonElement>("speak");
  if (b.textContent === "Speaking...") return;
  b.disabled = !voices.length || !$<HTMLTextAreaElement>("text").value.trim();
}
$("text").oninput = updateSpeak;

$("speak").onclick = async () => {
  const b = $<HTMLButtonElement>("speak");
  b.textContent = "Speaking...";
  b.disabled = true;
  msg("mainMsg", "Generating on Hades...");
  try {
    const clip = await api.speak(server(), $<HTMLSelectElement>("voice").value, $<HTMLTextAreaElement>("text").value.trim(), Number(speed.value));
    await loadClip(clip.id, true);
    msg("mainMsg", "Done.", "ok");
    refreshHistory();
  } catch (e) {
    msg("mainMsg", errText(e), "err");
  }
  b.textContent = "Speak";
  updateSpeak();
};

async function loadClip(id: string, autoplay: boolean) {
  currentClip = id;
  const p = $<HTMLAudioElement>("player");
  p.src = URL.createObjectURL(await api.clipAudio(id));
  if (autoplay) p.play().catch(() => {});
  $<HTMLButtonElement>("save").disabled = false;
}

$("save").onclick = async () => {
  if (!currentClip) return;
  try {
    if (await api.saveClip(currentClip)) msg("mainMsg", "Saved.", "ok");
  } catch (e) {
    msg("mainMsg", errText(e), "err");
  }
};

async function refreshHistory() {
  const clips = await api.listClips();
  const list = $("history");
  list.innerHTML = clips.length ? "" : `<li class="muted">Clips you make will show here (last 20).</li>`;
  for (const c of clips) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="grow"><b>${esc(c.voice)}</b> <span class="muted">${new Date(c.created).toLocaleString()}</span> ${esc(c.text)}</span>`;
    li.append(button("Load", () => loadClip(c.id, true)));
    list.append(li);
  }
}

// ---- settings
$<HTMLInputElement>("server").value = server();
$("saveSettings").onclick = () => {
  localStorage.setItem("server", $<HTMLInputElement>("server").value.trim() || DEFAULT_SERVER);
  msg("settingsMsg", "Saved.", "ok");
};
$("test").onclick = async () => {
  const url = $<HTMLInputElement>("server").value.trim() || DEFAULT_SERVER;
  msg("settingsMsg", "Testing...");
  try {
    msg("settingsMsg", `Connected to ${url} (${await api.health(url)}).`, "ok");
  } catch (e) {
    msg("settingsMsg", `Could not reach ${url}: ${errText(e)}`, "err");
  }
};

// ---- helpers
function button(label: string, onClick: () => void) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = onClick;
  return b;
}
function playBlob(el: HTMLAudioElement, blob: Blob) {
  el.src = URL.createObjectURL(blob);
  el.play().catch(() => {});
}
function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

refreshVoices();
refreshHistory();
