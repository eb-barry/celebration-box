import assert from "node:assert/strict";
import test from "node:test";
import { createBlowMeter } from "./blow-meter.mjs";

function quiet(meter, from, to) {
  for (let now = from; now <= to; now += 50) {
    assert.equal(meter.push({ rms: 0.02, low: 0.05, now }), null);
  }
}

test("a loud sample before listening does not count", () => {
  const meter = createBlowMeter();
  quiet(meter, 0, 500);
  assert.equal(meter.push({ rms: 0.4, low: 0.5, now: 800 }), null);
});

test("one breath counts once until the air falls away", () => {
  const meter = createBlowMeter();
  meter.arm(0);
  quiet(meter, 0, 400);

  let hits = 0;
  for (let now = 500; now <= 2000; now += 50) {
    if (meter.push({ rms: 0.35, low: 0.5, now })) hits += 1;
  }
  assert.equal(hits, 1);

  quiet(meter, 2100, 2400);
  let second = null;
  for (let now = 2500; now <= 2900; now += 50) {
    second = meter.push({ rms: 0.36, low: 0.52, now }) || second;
  }
  assert.ok(second);
});

test("a slow rise, like talking, does not count", () => {
  const meter = createBlowMeter();
  meter.arm(0);
  quiet(meter, 0, 400);
  let hit = null;
  for (let step = 0; step <= 40; step += 1) {
    const now = 500 + step * 50;
    const rms = 0.02 + step * 0.004;
    hit = meter.push({ rms, low: 0.06 + step * 0.004, now }) || hit;
  }
  assert.equal(hit, null);
});
