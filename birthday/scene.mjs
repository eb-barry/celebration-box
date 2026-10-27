import { createBlowMeter } from "./blow-meter.mjs";

const IMAGE = { w: 768, h: 1376 };
const SMOKE_MS = 5000;
const BOW_MS = 1000;
const SNUFF_MS = 200;

const params = new URLSearchParams(location.search);
const rehearseFrom = Number(params.get("from"));
const micOff = params.get("mic") === "off";
const debug = params.get("debug") === "1";
let jumpTo = 0;

function applySeek() {
  if (!jumpTo || phase !== "playing" || !Number.isFinite(audio.duration)) return;
  const target = Math.min(jumpTo, Math.max(0, audio.duration - 0.4));
  if (audio.currentTime + 0.5 < target) audio.currentTime = target;
}

const stage = document.querySelector(".stage");
const sheet = document.querySelector("#sheet");
const photo = document.querySelector("#photo");
const flame = document.querySelector("#flame");
const startBtn = document.querySelector("#start");
const againBtn = document.querySelector("#again");
const flameHit = document.querySelector("#flame-hit");
const primary = document.querySelector("#primary");
const secondary = document.querySelector("#secondary");
const debugEl = document.querySelector("#debug");
const audio = document.querySelector("#song");
const SONG_GAIN = 1.5;
let songCtx = null;

function armSong() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!songCtx) {
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = SONG_GAIN;
    ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
    songCtx = ctx;
  }
  songCtx.resume();
}

const meter = createBlowMeter();
let phase = "idle";
let blows = 0;
let micState = micOff ? "off" : "pending";
let stream = null;
let audioCtx = null;
let analyser = null;
let raf = 0;
let wakeLock = null;
let captionKey = "";
let closeTimer = 0;
let smokeTimer = 0;
let coldTimer = 0;
let bowTimer = 0;

const timeBuf = new Uint8Array(2048);
const freqBuf = new Uint8Array(1024);

function setCaption(main, sub) {
  const key = `${main}\n${sub}`;
  if (key === captionKey) return;
  captionKey = key;
  primary.textContent = main;
  secondary.textContent = sub;
  secondary.hidden = !sub;
  const caption = document.querySelector(".caption");
  caption.hidden = !main && !sub;
  caption.classList.remove("is-in");
  void caption.offsetWidth;
  caption.classList.add("is-in");
}

function placeSheet() {
  const rect = stage.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const scale = Math.max(rect.width / IMAGE.w, rect.height / IMAGE.h);
  sheet.style.width = `${(IMAGE.w * scale).toFixed(2)}px`;
  sheet.style.height = `${(IMAGE.h * scale).toFixed(2)}px`;
  sheet.style.setProperty("--s", scale.toFixed(4));
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

function readLevels() {
  analyser.getByteTimeDomainData(timeBuf);
  analyser.getByteFrequencyData(freqBuf);
  let sum = 0;
  for (let i = 0; i < timeBuf.length; i += 1) {
    const v = (timeBuf[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / timeBuf.length);
  const binHz = audioCtx.sampleRate / analyser.fftSize;
  const maxBin = Math.max(2, Math.round(400 / binHz));
  let lowSum = 0;
  for (let i = 1; i <= maxBin && i < freqBuf.length; i += 1) {
    lowSum += freqBuf[i] / 255;
  }
  return { rms, low: lowSum / maxBin };
}

function listenFrame(now) {
  raf = requestAnimationFrame(listenFrame);
  if (!analyser || phase !== "wish") return;
  const levels = readLevels();
  if (debug) {
    debugEl.hidden = false;
    debugEl.textContent = `rms ${levels.rms.toFixed(3)}  low ${levels.low.toFixed(3)}`;
  }
  const lean = Math.min(1, levels.rms / 0.18);
  flame.style.setProperty("--lean", lean.toFixed(3));
  const hit = meter.push({ ...levels, now });
  if (hit) registerBlow();
}

function stopMic() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  analyser = null;
  audioCtx?.close().catch(() => {});
  audioCtx = null;
  flame.style.setProperty("--lean", "0");
}

function wishCopy() {
  if (phase !== "wish") return;
  flameHit.hidden = micState !== "off";
  if (micState === "off") setCaption("許個願，然後輕點燭火", "");
  else setCaption("許個願，然後吹氣", "");
}

function requestMic() {
  if (micOff || !navigator.mediaDevices?.getUserMedia) {
    micState = "off";
    wishCopy();
    return;
  }
  stopMic();
  const ctx = new AudioContext();
  audioCtx = ctx;
  ctx.resume();
  navigator.mediaDevices
    .getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    })
    .then((live) => {
      if (phase === "out" || audioCtx !== ctx) {
        live.getTracks().forEach((track) => track.stop());
        return;
      }
      micState = "live";
      stream = live;
      const source = ctx.createMediaStreamSource(live);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      if (!raf) raf = requestAnimationFrame(listenFrame);
      if (phase === "wish") meter.arm(performance.now());
      wishCopy();
    })
    .catch(() => {
      if (audioCtx !== ctx) return;
      micState = "off";
      wishCopy();
    });
}

function showWish() {
  phase = "wish";
  blows = 0;
  meter.arm(performance.now());
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
  flame.classList.remove("smoking", "cold", "bow");
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
  flame.classList.add("out");
  stage.classList.add("is-out");
  vibrate([18, 40, 28, 40, 80]);
  setCaption("", "");
  window.clearTimeout(closeTimer);
  window.clearTimeout(coldTimer);
  window.clearTimeout(smokeTimer);
  coldTimer = window.setTimeout(() => {
    if (phase !== "out") return;
    flame.classList.remove("bow");
    flame.classList.add("cold", "smoking");
  }, SNUFF_MS);
  smokeTimer = window.setTimeout(() => flame.classList.remove("smoking"), SNUFF_MS + SMOKE_MS);
  closeTimer = window.setTimeout(() => {
    setCaption("願友誼讓每一刻都發亮", "");
    againBtn.hidden = false;
  }, 2200);
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
  armSong();
  audio.play().then(applySeek).catch(() => {
    phase = "idle";
    startBtn.hidden = false;
    stopMic();
    setCaption("請再點一下", "聲音還沒有開始");
  });
  requestMic();
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
  armSong();
  audio.play().catch(() => {
    setCaption("請再點一下", "聲音還沒有開始");
  });
  micState = micOff ? "off" : "pending";
  requestMic();
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
flameHit.addEventListener("click", (event) => {
  event.stopPropagation();
  registerBlow();
});

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
      armSong();
      audio.play().catch(() => {
        startBtn.hidden = false;
        setCaption("點一下繼續", "");
      });
    }
  }
});

photo.addEventListener("load", placeSheet);
window.addEventListener("resize", placeSheet);
window.addEventListener("orientationchange", placeSheet);
window.visualViewport?.addEventListener("resize", placeSheet);
new ResizeObserver(placeSheet).observe(stage);
placeSheet();
window.setTimeout(placeSheet, 300);
setCaption("點一下，開始唱歌", "請先打開手機聲音");
