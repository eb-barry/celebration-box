import { createBlowMeter } from "./blow-meter.mjs";

const IMAGE = { w: 768, h: 1376 };
// Tip of the spiral candle. The photo's own flame is already painted out.
const FLAME = { x: 385, y: 518 };

const VERSES = [
  ["The office doors are quiet now,", "Your day is done, your smile stays bright;"],
  ["A little cake, a ribboned wish,", "And friends have gathered close tonight."],
  ["Happy birthday, lovely you,", "May every kind dream find its way;"],
  ["You make the room feel warm and new,", "Tonight the world is yours to celebrate."],
  ["生日快樂，親愛的你，", "願每個心願都如期；"],
  ["願溫柔的風陪著你，", "把幸福寫進新一歲裡。"],
  ["Joyeux anniversaire, belle amie,", "Que tes beaux rêves prennent leur essor;"],
  ["Que la joie te suive aujourd’hui,", "Et que ton cœur s’épanouisse encore."],
  ["Feliz cumpleaños, luz de la noche,", "Que la vida te regale ilusión;"],
  ["Buon compleanno, dolce sorriso,", "Che la felicità viva nel tuo cuore."],
  ["Happy birthday, lovely you,", "生日快樂，願你歡喜；"],
  ["Buon compleanno, dear one tonight,", "May love make every moment bright."],
];

const params = new URLSearchParams(location.search);
const guestName = (params.get("name") || "").trim();
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
const photo = document.querySelector("#photo");
const flame = document.querySelector("#flame");
const startBtn = document.querySelector("#start");
const againBtn = document.querySelector("#again");
const flameHit = document.querySelector("#flame-hit");
const primary = document.querySelector("#primary");
const secondary = document.querySelector("#secondary");
const debugEl = document.querySelector("#debug");
const audio = document.querySelector("#song");

const meter = createBlowMeter();
let phase = "idle";
let blows = 0;
let micState = micOff ? "off" : "pending";
let stream = null;
let audioCtx = null;
let analyser = null;
let raf = 0;
let wakeLock = null;
let verseAt = -1;
let captionKey = "";
let closeTimer = 0;

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
  caption.classList.remove("is-in");
  void caption.offsetWidth;
  caption.classList.add("is-in");
}

function verseIndex(time) {
  const start = 8;
  const end = 172;
  if (time < start) return -1;
  const span = (end - start) / VERSES.length;
  return Math.min(VERSES.length - 1, Math.floor((time - start) / span));
}

function placeFlame() {
  const rect = stage.getBoundingClientRect();
  const scale = Math.max(rect.width / IMAGE.w, rect.height / IMAGE.h);
  const ox = (rect.width - IMAGE.w * scale) / 2;
  const oy = (rect.height - IMAGE.h * scale) / 2;
  const x = ox + FLAME.x * scale;
  const y = oy + FLAME.y * scale;
  flame.style.left = `${x}px`;
  flame.style.top = `${y}px`;
  flame.style.setProperty("--s", scale.toFixed(4));
  flameHit.style.left = `${x}px`;
  flameHit.style.top = `${y}px`;
  flameHit.style.width = `${scale * 110}px`;
  flameHit.style.height = `${scale * 150}px`;
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

function finish() {
  phase = "out";
  meter.disarm();
  stopMic();
  flameHit.hidden = true;
  flame.classList.remove("gust");
  flame.classList.add("out");
  stage.classList.add("is-out");
  vibrate([18, 40, 28, 40, 80]);
  setCaption("", "");
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => {
    if (guestName) setCaption(guestName, "願愛讓每一刻都發亮");
    else setCaption("願愛讓每一刻都發亮", "");
    againBtn.hidden = false;
  }, 2200);
}

function registerBlow() {
  if (phase !== "wish") return;
  blows += 1;
  vibrate(blows === 3 ? 30 : 16);
  if (blows === 1) {
    flame.classList.add("gust");
    window.setTimeout(() => flame.classList.remove("gust"), 1100);
    return;
  }
  if (blows === 2) {
    flame.classList.add("weak", "gust");
    window.setTimeout(() => flame.classList.remove("gust"), 1100);
    return;
  }
  finish();
}

function onTime() {
  if (phase !== "playing") return;
  const index = verseIndex(audio.currentTime);
  if (index === verseAt) return;
  verseAt = index;
  if (index < 0) {
    if (micState === "off") setCaption("唱完後輕點燭火", "");
    else setCaption("麥克風已準備好", "唱完就可以吹蠟燭");
    return;
  }
  const [line, next] = VERSES[index];
  setCaption(line, next);
}

function begin() {
  if (phase !== "idle") return;
  phase = "playing";
  verseAt = -2;
  startBtn.hidden = true;
  againBtn.hidden = true;
  stage.classList.remove("is-out");
  flame.classList.remove("out", "weak", "gust");
  jumpTo = Number.isFinite(rehearseFrom) && rehearseFrom > 0 ? rehearseFrom : 0;
  applySeek();
  audio.play().then(applySeek).catch(() => {
    phase = "idle";
    startBtn.hidden = false;
    stopMic();
    setCaption("請再點一下", "聲音還沒有開始");
  });
  requestMic();
  keepAwake();
  onTime();
}

function relight() {
  blows = 0;
  verseAt = -2;
  phase = "playing";
  window.clearTimeout(closeTimer);
  againBtn.hidden = true;
  flameHit.hidden = true;
  flame.classList.remove("out", "weak", "gust");
  stage.classList.remove("is-out");
  jumpTo = 0;
  stopMic();
  audio.currentTime = 0;
  audio.play().catch(() => {
    setCaption("請再點一下", "聲音還沒有開始");
  });
  micState = micOff ? "off" : "pending";
  requestMic();
  keepAwake();
  onTime();
}

startBtn.addEventListener("click", () => {
  if (phase === "idle") begin();
  else if (phase === "playing" && audio.paused) {
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

audio.addEventListener("timeupdate", onTime);
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
      audio.play().catch(() => {
        startBtn.hidden = false;
        setCaption("點一下繼續", "");
      });
    }
  }
});

photo.addEventListener("load", placeFlame);
window.addEventListener("resize", placeFlame);
placeFlame();
setCaption("點一下，開始唱歌", "請先打開手機聲音");
