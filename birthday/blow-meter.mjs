// A blow is a sudden, loud, low rush of air that stays a moment, then falls away.
// One continuous breath counts once. The next breath has to ease off first.

export function createBlowMeter() {
  const history = [];
  let ambientRms = 0.02;
  let ambientLow = 0.05;
  let armed = false;
  let armedAt = 0;
  let overSince = 0;
  let lastTrigger = -1e9;
  let cooling = false;

  function push({ rms, low, now }) {
    history.push({ rms, now });
    const keep = now - 1500;
    while (history.length && history[0].now < keep) history.shift();

    if (!armed) {
      ambientRms = ambientRms * 0.9 + rms * 0.1;
      ambientLow = ambientLow * 0.9 + low * 0.1;
      return null;
    }

    if (now - armedAt < 300) {
      ambientRms = ambientRms * 0.8 + rms * 0.2;
      ambientLow = ambientLow * 0.8 + low * 0.2;
      return null;
    }

    if (rms < ambientRms * 1.7) {
      ambientRms = ambientRms * 0.95 + rms * 0.05;
      ambientLow = ambientLow * 0.95 + low * 0.05;
    }

    if (cooling) {
      if (rms < Math.max(0.05, ambientRms * 1.8)) cooling = false;
      return null;
    }

    let ref = history[0];
    for (const item of history) {
      if (now - item.now >= 280) ref = item;
      else break;
    }

    const attack = rms / Math.max(ref.rms, 0.004);
    const loud = rms > Math.max(0.08, ambientRms * 3.3);
    const bassy = low > Math.max(0.1, ambientLow * 2.2);
    const sudden = attack > 2;
    if (!(loud && bassy && sudden)) {
      overSince = 0;
      return null;
    }

    if (!overSince) overSince = now;
    if (now - overSince < 180) return null;
    if (now - lastTrigger < 900) return null;

    lastTrigger = now;
    overSince = 0;
    cooling = true;
    return { at: now };
  }

  return {
    push,
    arm(now) {
      armed = true;
      armedAt = now;
      overSince = 0;
      cooling = false;
    },
    disarm() {
      armed = false;
      cooling = false;
      overSince = 0;
    },
    snapshot() {
      return { ambientRms, ambientLow, cooling, armed };
    },
  };
}
