'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const st = require('../src/core/pet-state');

const T0 = new Date('2026-01-05T10:00:00').getTime();
const MIN = 60000;
const mk = () => st.createPet({ speciesId: 'bubbo', name: 'B', agentId: 'agt_x', now: T0 });

test('new pet starts as a baby with sane needs', () => {
  const p = mk();
  assert.equal(p.stage, 'baby');
  assert.ok(p.hunger < 50 && p.mood > 50);
});

test('hunger grows with time and flips status to hungry', () => {
  const p = mk();
  st.tick(p, T0 + 120 * MIN);
  assert.ok(p.hunger > 75);
  assert.equal(st.currentStatus(p), 'hungry');
});

test('offline time is capped so the pet does not starve overnight', () => {
  const p = mk();
  st.tick(p, T0 + 48 * 60 * MIN);
  assert.ok(p.hunger <= 100);
  assert.ok(p.mood >= 0);
});

test('feeding lowers hunger, raises xp, and refuses when full', () => {
  const p = mk();
  p.hunger = 60;
  const r = st.feed(p, 'rice', T0);
  assert.equal(r.ok, true);
  assert.equal(p.hunger, 25);
  p.hunger = 2;
  const full = st.feed(p, 'rice', T0);
  assert.equal(full.reason, 'full');
});

test('xp evolves baby -> child -> adult', () => {
  const p = mk();
  assert.equal(st.stageForXp(59), 'baby');
  assert.equal(st.stageForXp(60), 'child');
  assert.equal(st.stageForXp(240), 'adult');
  p.xp = 58;
  const evolved = st.pat(p, T0);
  assert.equal(evolved.evolved, false);
  p.xp = 59;
  assert.equal(st.pat(p, T0).evolved, true);
  assert.equal(p.stage, 'child');
});

test('pet falls asleep at night and is grumpy when woken', () => {
  const p = mk();
  const night = new Date('2026-01-05T23:30:00').getTime();
  p.lastTickAt = night - MIN;
  p.lastInteractionAt = night - MIN;
  p.energy = 40;
  const { events } = st.tick(p, night);
  assert.ok(events.includes('slept'));
  assert.equal(st.currentStatus(p), 'sleep');
  const moodBefore = p.mood;
  st.pat(p, night);
  assert.equal(p.sleeping, false);
  assert.ok(p.mood < moodBefore + 8);
});

test('playing is refused when exhausted', () => {
  const p = mk();
  p.energy = 5;
  assert.equal(st.play(p, T0).reason, 'tired');
});
