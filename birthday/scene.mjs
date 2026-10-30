import { createBlowMeter } from "./blow-meter.mjs";

const IMAGE = { w: 768, h: 1376 };
const SMOKE_MS = 5000;
const BOW_MS = 1000;
const RISE_MS = 1000;
const FALL_MS = 3000;

const params = new URLSearchParams(location.search);
const rehearseFrom = Number(params.get("from"));
const micOff = params.get("mic") === "off";
const debug = params.get("debug") === "1";
const DEFAULT_CAKE_NAME = "Joyce";
let jumpTo = 0;

function applySeek() {
  if (!jumpTo || phase !== "playing" || !Number.isFinite(audio.duration)) return;
  const target = Math.min(jumpTo, Math.max(0, audio.duration - 0.4));
  if (audio.currentTime + 0.5 < target) audio.currentTime = target;
}

const stage = document.querySelector(".stage");
const sheet = document.querySelector("#sheet");
const photo = document.querySelector("#photo");
const cakeNameEl = document.querySelector("#cake-name");
const flame = document.querySelector("#flame");
const startBtn = document.querySelector("#start");
const againBtn = document.querySelector("#again");
const flameHit = document.querySelector("#flame-hit");
const primary = document.querySelector("#primary");
const secondary = document.querySelector("#secondary");
const debugEl = document.querySelector("#debug");
const audio = document.querySelector("#song");
const SONG_GAIN = 3.5;
const MIC_AUDIO = {
  echoCancellation: { ideal: false },
  noiseSuppression: { ideal: false },
  autoGainControl: { ideal: false },
};
let songCtx = null;
let songGain = null;
let micCtx = null;
let micSource = null;
let micMute = null;
let processor = null;
let keepAlive = null;
let micToken = 0;
let micOpening = false;

function setAudioSession(type) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = type;
  } catch {
    /* a few browsers reject the session change */
  }
}

function preferPlayback() {
  if (!stream) setAudioSession("playback");
}

function preferCapture() {
  setAudioSession("play-and-record");
}

function restoreSong() {
  audio.volume = 1;
  if (songGain) songGain.gain.value = SONG_GAIN;
  if (phase === "playing" && !stream) preferPlayback();
  songCtx?.resume();
}

// A silent source started on the opening tap keeps the context "running"
// after the song ends. iOS will not resume a suspended context from the
// audio "ended" event, and a suspended analyser only ever reads silence.
function startKeepAlive(ctx) {
  if (keepAlive) return;
  const osc = ctx.createOscillator();
  const mute = ctx.createGain();
  mute.gain.value = 0.0001;
  osc.frequency.value = 28;
  osc.connect(mute);
  mute.connect(ctx.destination);
  osc.start();
  keepAlive = osc;
}

function armSong() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!songCtx) {
    const ctx = new Ctx({ latencyHint: "playback" });
    const gain = ctx.createGain();
    gain.gain.value = SONG_GAIN;
    ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
    songCtx = ctx;
    songGain = gain;
    startKeepAlive(ctx);
  }
  restoreSong();
}

// The microphone gets its own context, unlocked on the opening tap.
// The song context owns the media element; Safari feeds a mic attached
// to that context nothing but silence.
function armMic() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || micOff) return;
  if (!micCtx || micCtx.state === "closed") {
    const ctx = new Ctx();
    const mute = ctx.createGain();
    mute.gain.value = 0.0001;
    const osc = ctx.createOscillator();
    osc.frequency.value = 30;
    osc.connect(mute);
    mute.connect(ctx.destination);
    osc.start();
    micCtx = ctx;
    ctx.addEventListener("statechange", () => {
      if (phase !== "wish" || ctx.state === "running") return;
      ctx.resume().catch(() => {});
    });
  }
  micCtx.resume();
}

const meter = createBlowMeter();
let phase = "idle";
let blows = 0;
let micState = micOff ? "off" : "pending";
let stream = null;
let analyser = null;
let raf = 0;
let wakeLock = null;
let captionKey = "";
let closeTimer = 0;
let smokeTimer = 0;
let coldTimer = 0;
let bowTimer = 0;
let carryRaf = 0;
let flameHome = null;

const timeBuf = new Uint8Array(2048);
let heardSample = false;

function setCaption(main, sub) {
  const key = `${main}\n${sub}`;
  if (key === captionKey) return;
  captionKey = key;
  primary.textContent = main;
  secondary.textContent = sub;
  secondary.hidden = !sub;
  const caption = document.querySelector(".caption");
  caption.classList.remove("is-lit");
  caption.classList.toggle("is-ending", main === "願友誼讓每一刻都發亮");
  caption.hidden = !main && !sub;
  caption.classList.remove("is-in");
  void caption.offsetWidth;
  caption.classList.add("is-in");
}

function cakeNameFromHash() {
  let raw = "";
  try {
    raw = decodeURIComponent(location.hash.replace(/^#/, ""));
  } catch {
    raw = location.hash.replace(/^#/, "");
  }
  raw = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(raw);
  if (!chars.length) return DEFAULT_CAKE_NAME;
  return chars.slice(0, 18).join("");
}

function showCakeName() {
  cakeNameEl.textContent = cakeNameFromHash();
  fitCakeName();
}

function fitCakeName() {
  const name = cakeNameEl.textContent;
  if (!name) return;
  const scale = parseFloat(getComputedStyle(sheet).getPropertyValue("--s")) || 1;
  if (scale < 0.05) return;
  const count = Array.from(name).length;
  let px = count <= 6 ? 64 : count <= 10 ? 50 : 40;
  cakeNameEl.style.fontSize = `calc(var(--s) * ${px}px)`;
  const max = 200 * scale;
  const width = cakeNameEl.scrollWidth;
  if (width > max) {
    px *= max / width;
    cakeNameEl.style.fontSize = `calc(var(--s) * ${px.toFixed(2)}px)`;
  }
}

function placeSheet() {
  const rect = stage.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const scale = Math.max(rect.width / IMAGE.w, rect.height / IMAGE.h);
  sheet.style.width = `${(IMAGE.w * scale).toFixed(2)}px`;
  sheet.style.height = `${(IMAGE.h * scale).toFixed(2)}px`;
  sheet.style.setProperty("--s", scale.toFixed(4));
  fitCakeName();
}

function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* some browsers throw if vibration is blocked */
  }
}

async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    wakeLock = null;
  }
}

function noteLevels(rms, now) {
  if (debug) {
    debugEl.hidden = false;
    debugEl.textContent = `rms ${rms.toFixed(3)}  mic ${micState}  ctx ${micCtx?.state ?? "-"}`;
  }
  const lean = Math.min(1, rms / 0.12);
  flame.style.setProperty("--lean", lean.toFixed(3));
  const hit = meter.push({ rms, now });
  if (hit) registerBlow();
}

function listenFrame(now) {
  raf = requestAnimationFrame(listenFrame);
  if (!analyser || processor || phase !== "wish") return;
  if (micCtx && micCtx.state !== "running") return;
  analyser.getByteTimeDomainData(timeBuf);
  let sum = 0;
  for (let i = 0; i < timeBuf.length; i += 1) {
    const v = (timeBuf[i] - 128) / 128;
    sum += v * v;
  }
  noteLevels(Math.sqrt(sum / timeBuf.length), now);
}

function disconnectMeter() {
  micSource?.disconnect();
  micMute?.disconnect();
  analyser?.disconnect();
  processor?.disconnect();
  if (processor) processor.onaudioprocess = null;
  micSource = null;
  micMute = null;
  analyser = null;
  processor = null;
}

function stopMic() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  micToken += 1;
  micOpening = false;
  heardSample = false;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  disconnectMeter();
  flame.style.setProperty("--lean", "0");
  if (phase !== "wish") preferPlayback();
}

function graphIsLive() {
  const trackLive = stream?.getTracks().some((track) => track.readyState === "live");
  return Boolean(trackLive && (processor || analyser) && micCtx && micCtx.state === "running");
}

function hearBuffer(input, now) {
  if (!input.length) return;
  let sum = 0;
  for (let i = 0; i < input.length; i += 1) sum += input[i] * input[i];
  noteLevels(Math.sqrt(sum / input.length), now);
}

// ScriptProcessor pulls real samples on Safari. A tiny gain keeps the
// branch alive without playing the breath back through the speaker.
function connectMeter(ctx, live) {
  disconnectMeter();
  micSource = ctx.createMediaStreamSource(live);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.2;
  micSource.connect(analyser);
  micMute = ctx.createGain();
  micMute.gain.value = 0.0001;
  try {
    processor = ctx.createScriptProcessor(2048, 1, 1);
    micSource.connect(processor);
    processor.connect(micMute);
    micMute.connect(ctx.destination);
    processor.onaudioprocess = (event) => {
      heardSample = true;
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);
      if (phase !== "wish") return;
      const channels = event.inputBuffer.numberOfChannels;
      const input = event.inputBuffer.getChannelData(0);
      if (channels > 1) {
        const other = event.inputBuffer.getChannelData(1);
        const mixed = new Float32Array(input.length);
        for (let i = 0; i < input.length; i += 1) mixed[i] = (input[i] + other[i]) * 0.5;
        hearBuffer(mixed, performance.now());
        return;
      }
      hearBuffer(input, performance.now());
    };
    const generation = micToken;
    window.setTimeout(() => {
      if (generation !== micToken || heardSample || phase !== "wish" || !analyser || raf) return;
      processor = null;
      raf = requestAnimationFrame(listenFrame);
    }, 500);
  } catch {
    processor = null;
    analyser.connect(micMute);
    micMute.connect(ctx.destination);
    if (!raf) raf = requestAnimationFrame(listenFrame);
  }
}

function openMic() {
  const devices = navigator.mediaDevices;
  return devices
    .getUserMedia({ audio: MIC_AUDIO, video: false })
    .catch(() => devices.getUserMedia({ audio: true, video: false }));
}

function wishCopy() {
  if (phase !== "wish") return;
  flameHit.hidden = true;
  setCaption("請許願，再吹蠟燭", "");
}

function requestMic() {
  if (micOff || !navigator.mediaDevices?.getUserMedia) {
    micState = "off";
    wishCopy();
    return;
  }
  if (micOpening || graphIsLive()) return;
  armMic();
  const ctx = micCtx;
  if (!ctx) {
    micState = "retry";
    wishCopy();
    return;
  }
  micOpening = true;
  const token = ++micToken;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  preferCapture();
  openMic()
    .then(async (live) => {
      if (token !== micToken || phase !== "wish") {
        live.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = live;
      try {
        await ctx.resume();
      } catch {
        /* the opening tap already unlocked this context */
      }
      if (token !== micToken || phase !== "wish") {
        live.getTracks().forEach((track) => track.stop());
        if (stream === live) stream = null;
        return;
      }
      connectMeter(ctx, live);
      micState = ctx.state === "running" ? "live" : "retry";
      meter.arm(performance.now());
      wishCopy();
    })
    .catch(() => {
      if (token !== micToken) return;
      micState = "retry";
      wishCopy();
    })
    .finally(() => {
      if (token === micToken) micOpening = false;
    });
}

// A later tap only retries the microphone. It must not count as a breath
// and must not change the wish caption into a "tap the screen" instruction.
function nudgeMic() {
  if (phase !== "wish" || micOff) return;
  micCtx?.resume();
  if (!graphIsLive()) requestMic();
}

function showWish() {
  phase = "wish";
  blows = 0;
  meter.arm(performance.now());
  requestMic();
  wishCopy();
}

function setAppIcon(lit) {
  const link = document.querySelector("#favicon");
  if (!link) return;
  link.href = lit ? "icon-512.png" : "icon-192.png";
  link.sizes = lit ? "512x512" : "192x192";
}

function stopSmoke() {
  window.clearTimeout(smokeTimer);
  window.clearTimeout(coldTimer);
  window.clearTimeout(bowTimer);
  if (carryRaf) cancelAnimationFrame(carryRaf);
  carryRaf = 0;
  flame.classList.remove("smoking", "cold", "bow", "carry");
  const body = flame.querySelector(".flame-body");
  if (body) body.style.transform = "";
  restoreFlame();
}

function liftFlame() {
  const rect = flame.getBoundingClientRect();
  const host = stage.getBoundingClientRect();
  const scale = getComputedStyle(sheet).getPropertyValue("--s").trim();
  if (scale) flame.style.setProperty("--s", scale);
  if (flame.parentElement !== stage) {
    flameHome = { parent: flame.parentElement, next: flame.nextSibling };
    stage.appendChild(flame);
  }
  flame.style.left = `${rect.left - host.left}px`;
  flame.style.top = `${rect.top - host.top}px`;
}

function restoreFlame() {
  flame.style.left = "";
  flame.style.top = "";
  flame.style.removeProperty("--s");
  if (!flameHome) return;
  flameHome.parent.insertBefore(flame, flameHome.next);
  flameHome = null;
}

function bowFlame() {
  flame.classList.remove("bow");
  void flame.offsetWidth;
  flame.classList.add("bow");
  window.clearTimeout(bowTimer);
  bowTimer = window.setTimeout(() => flame.classList.remove("bow"), BOW_MS);
}

function finish() {
  phase = "out";
  setAppIcon(false);
  meter.disarm();
  stopMic();
  flameHit.hidden = true;
  window.clearTimeout(bowTimer);
  window.clearTimeout(closeTimer);
  window.clearTimeout(coldTimer);
  window.clearTimeout(smokeTimer);
  if (carryRaf) cancelAnimationFrame(carryRaf);
  carryRaf = 0;
  flame.classList.remove("bow", "out", "cold");
  const body = flame.querySelector(".flame-body");
  if (body) body.style.transform = "";
  stage.classList.add("is-out");
  vibrate([18, 40, 28, 40, 80]);
  againBtn.hidden = true;
  setCaption("願友誼讓每一刻都發亮", "");
  carryFlame(body);
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

// The whole flame lifts for one second, then a slow parabola carries it
// down onto the closing line. Four seconds, then it is gone.
function carryFlame(body) {
  if (!body) {
    igniteEnding();
    return;
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const riseMs = reduce ? 0 : RISE_MS;
  const fallMs = reduce ? 0 : FALL_MS;
  liftFlame();
  const height = body.getBoundingClientRect().height;
  flame.classList.add("carry");
  const started = performance.now();

  function point(elapsed) {
    const wick = flame.getBoundingClientRect();
    const text = primary.getBoundingClientRect();
    const dx = text.left + text.width / 2 - wick.left;
    const dy = text.top + text.height / 2 - wick.top + height * 0.5;
    const startCenter = wick.top - height * 0.5;
    const rise = Math.max(56, Math.min(height * 1.15, startCenter - window.innerHeight * 0.27));
    if (elapsed <= riseMs) {
      const u = riseMs === 0 ? 1 : easeInOut(elapsed / riseMs);
      return { x: 0, y: -rise * u, grow: 1 + 0.4 * u };
    }
    const u = fallMs === 0 ? 1 : easeInOut(Math.min(1, (elapsed - riseMs) / fallMs));
    const bow = Math.min(96, window.innerWidth * 0.22);
    const p1x = dx * 0.35 + bow;
    const p1y = -rise + (dy + rise) * 0.38;
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    return {
      x: b * p1x + c * dx,
      y: a * -rise + b * p1y + c * dy,
      grow: 1.4,
    };
  }

  function frame(now) {
    if (phase !== "out") return;
    const elapsed = now - started;
    const spot = point(elapsed);
    body.style.transform = `translate(${spot.x.toFixed(2)}px, ${spot.y.toFixed(2)}px) translateX(-50%) scale(calc(var(--flame-scale) * ${spot.grow.toFixed(3)}))`;
    if (elapsed < riseMs + fallMs) {
      carryRaf = requestAnimationFrame(frame);
      return;
    }
    carryRaf = 0;
    igniteEnding();
  }

  carryRaf = requestAnimationFrame(frame);
}

function igniteEnding() {
  if (phase !== "out") return;
  flame.classList.remove("carry");
  flame.classList.add("cold");
  const body = flame.querySelector(".flame-body");
  if (body) body.style.transform = "";
  restoreFlame();
  flame.classList.add("smoking");
  smokeTimer = window.setTimeout(() => flame.classList.remove("smoking"), SMOKE_MS);
  document.querySelector(".caption").classList.add("is-lit");
  againBtn.hidden = false;
}

function registerBlow() {
  if (phase !== "wish") return;
  blows += 1;
  vibrate(blows === 3 ? 30 : 16);
  if (blows < 3) {
    bowFlame();
    return;
  }
  finish();
}

function begin() {
  if (phase !== "idle") return;
  phase = "playing";
  startBtn.hidden = true;
  againBtn.hidden = true;
  stage.classList.remove("is-out");
  stopSmoke();
  flame.classList.remove("out", "bow");
  setAppIcon(true);
  setCaption("", "");
  jumpTo = Number.isFinite(rehearseFrom) && rehearseFrom > 0 ? rehearseFrom : 0;
  applySeek();
  armMic();
  armSong();
  audio.play().then(applySeek).catch(() => {
    phase = "idle";
    startBtn.hidden = false;
    stopMic();
    setCaption("請再點一下", "聲音還沒有開始");
  });
  keepAwake();
}

function relight() {
  blows = 0;
  phase = "playing";
  window.clearTimeout(closeTimer);
  againBtn.hidden = true;
  flameHit.hidden = true;
  stopSmoke();
  flame.classList.remove("out", "bow");
  stage.classList.remove("is-out");
  setAppIcon(true);
  setCaption("", "");
  jumpTo = 0;
  stopMic();
  audio.currentTime = 0;
  armMic();
  armSong();
  audio.play().catch(() => {
    setCaption("請再點一下", "聲音還沒有開始");
  });
  micState = micOff ? "off" : "pending";
  keepAwake();
}

startBtn.addEventListener("click", () => {
  if (phase === "idle") begin();
  else if (phase === "playing" && audio.paused) {
    armSong();
    audio.play().catch(() => {});
    startBtn.hidden = true;
    keepAwake();
  }
});

againBtn.addEventListener("click", relight);

audio.addEventListener("loadedmetadata", applySeek);
audio.addEventListener("playing", applySeek);
audio.addEventListener("ended", () => {
  if (phase === "playing") showWish();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (phase === "playing") {
    keepAwake();
    if (audio.paused) {
      armMic();
      armSong();
      audio.play().catch(() => {
        startBtn.hidden = false;
        setCaption("點一下繼續", "");
      });
    }
    return;
  }
  if (phase === "wish") {
    micCtx?.resume();
    if (!graphIsLive()) requestMic();
  }
});

document.addEventListener("pointerdown", nudgeMic);
document.addEventListener("touchstart", nudgeMic, { passive: true });

photo.addEventListener("load", placeSheet);
window.addEventListener("resize", placeSheet);
window.addEventListener("orientationchange", placeSheet);
window.visualViewport?.addEventListener("resize", placeSheet);
new ResizeObserver(placeSheet).observe(stage);
placeSheet();
window.setTimeout(placeSheet, 300);
showCakeName();
window.addEventListener("hashchange", showCakeName);
document.fonts?.ready.then(() => fitCakeName());
setCaption("點一下，開始唱歌", "請先打開手機聲音");
