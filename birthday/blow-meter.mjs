// A blow is a sudden, loud, low rush of air. One continuous breath counts once.
// Phone puffs are short, so a hard onset counts immediately and a softer one
// only has to stay loud for a moment. The next breath has to ease off first.

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
      if (rms < Math.max(0.035, ambientRms * 1.6)) cooling = false;
      else return null;
    }

    let ref = history[0];
    for (const item of history) {
      if (now - item.now >= 200) ref = item;
      else break;
    }

    const attack = rms / Math.max(ref.rms, 0.004);
    const loud = rms > Math.max(0.04, ambientRms * 2.6);
    const bassy = low > Math.max(0.06, ambientLow * 1.9);
    const sudden = attack > 1.65;
    const gap = now - lastTrigger >= 350;
    const hard = rms > Math.max(0.11, ambientRms * 4);

    if (loud && bassy && sudden && hard && gap) {
      lastTrigger = now;
      overSince = 0;
      cooling = true;
      return { at: now };
    }

    // A softer puff may lose its attack once the window fills with the puff
    // itself. Keep the onset and count it if the air stays for a short beat.
    if (!(loud && bassy && (sudden || overSince))) {
      overSince = 0;
      return null;
    }

    if (!overSince) overSince = now;
    if (now - overSince < 80 || !gap) return null;

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
