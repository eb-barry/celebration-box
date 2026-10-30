// A blow is a sudden jump in loudness. One continuous breath counts once.
// Phones strip the low rumble out of a puff, so bass is not required.
// The next breath has to ease off first.

export function createBlowMeter() {
  const history = [];
  let ambient = 0.012;
  let armed = false;
  let armedAt = 0;
  let overSince = 0;
  let lastTrigger = -1e9;
  let cooling = false;

  function push({ rms, now }) {
    history.push({ rms, now });
    const keep = now - 1200;
    while (history.length && history[0].now < keep) history.shift();

    if (!armed) {
      ambient = ambient * 0.9 + rms * 0.1;
      return null;
    }

    if (now - armedAt < 100) {
      ambient = ambient * 0.85 + rms * 0.15;
      return null;
    }

    if (rms < ambient * 1.8) ambient = ambient * 0.9 + rms * 0.1;

    if (cooling) {
      if (rms < Math.max(0.02, ambient * 1.45)) cooling = false;
      else return null;
    }

    let ref = history[0];
    for (const item of history) {
      if (now - item.now >= 160) ref = item;
      else break;
    }

    const attack = rms / Math.max(ref.rms, 0.003);
    const loud = rms > Math.max(0.02, ambient * 2.2);
    const sudden = attack > 1.7 && rms - ref.rms > 0.025;
    const gap = now - lastTrigger >= 320;
    if (!gap) return null;

    if (loud && sudden && rms > Math.max(0.06, ambient * 3)) {
      lastTrigger = now;
      overSince = 0;
      cooling = true;
      return { at: now };
    }

    if (!(loud && (sudden || overSince))) {
      overSince = 0;
      return null;
    }

    if (!overSince) overSince = now;
    if (now - overSince < 70) return null;

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
      return { ambientRms: ambient, ambientLow: 0, cooling, armed };
    },
  };
}
