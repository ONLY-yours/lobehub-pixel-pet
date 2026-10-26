'use strict';

// Pure pet-state logic: every function takes `now` (ms) explicitly so it is
// trivially testable. Needs run 0..100: hunger 0 = full, mood 100 = joyful,
// energy 100 = rested.

const MIN = 60 * 1000;
const STAGES = [
  { id: 'baby', minXp: 0 },
  { id: 'child', minXp: 60 },
  { id: 'adult', minXp: 240 },
];
const MAX_OFFLINE_MIN = 8 * 60; // do not punish the owner for being away

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function isNight(now) {
  const h = new Date(now).getHours();
  return h >= 23 || h < 7;
}

function createPet({ speciesId, name, agentId, topicId = null, now }) {
  return {
    speciesId,
    name,
    agentId,
    topicId,
    createdAt: now,
    stage: 'baby',
    xp: 0,
    hunger: 30,
    mood: 70,
    energy: 90,
    sleeping: false,
    lastTickAt: now,
    lastInteractionAt: now,
    lastFedAt: now,
    lastSpokeAt: 0,
  };
}

function stageForXp(xp) {
  let cur = STAGES[0].id;
  for (const s of STAGES) if (xp >= s.minXp) cur = s.id;
  return cur;
}

function gainXp(pet, amount) {
  pet.xp += amount;
  const next = stageForXp(pet.xp);
  const evolved = next !== pet.stage;
  pet.stage = next;
  return evolved;
}

// Advance simulated time. Mutates and returns { pet, events }.
function tick(pet, now) {
  const events = [];
  const dtMin = Math.min(Math.max(0, now - pet.lastTickAt) / MIN, MAX_OFFLINE_MIN);
  pet.lastTickAt = now;
  if (dtMin <= 0) return { pet, events };

  if (pet.sleeping) {
    pet.energy = clamp(pet.energy + dtMin * 1.2);
    pet.hunger = clamp(pet.hunger + dtMin * 0.15);
    if (pet.energy >= 100 && !isNight(now)) {
      pet.sleeping = false;
      events.push('woke');
    }
  } else {
    pet.hunger = clamp(pet.hunger + dtMin * 0.5);
    pet.energy = clamp(pet.energy - dtMin * 0.3);
    const ignoredMin = (now - pet.lastInteractionAt) / MIN;
    const drain = 0.15 + (pet.hunger > 70 ? 0.3 : 0) + (ignoredMin > 30 ? 0.1 : 0);
    pet.mood = clamp(pet.mood - dtMin * drain);
    if (pet.energy <= 10 || (isNight(now) && pet.energy < 60)) {
      pet.sleeping = true;
      events.push('slept');
    }
  }
  return { pet, events };
}

function touch(pet, now) {
  pet.lastInteractionAt = now;
  if (pet.sleeping) {
    pet.sleeping = false;
    pet.energy = Math.max(pet.energy, 15);
    pet.mood = clamp(pet.mood - 8); // grumpy when woken up
    return 'woken';
  }
  return null;
}

const FOODS = {
  rice: { label: '白饭', hunger: -35, mood: 6, xp: 3 },
  cookie: { label: '饼干', hunger: -15, mood: 15, xp: 2 },
  fruit: { label: '水果', hunger: -25, mood: 8, xp: 3 },
};

function feed(pet, foodId, now) {
  const food = FOODS[foodId] || FOODS.rice;
  const woken = touch(pet, now);
  if (pet.hunger < 8) {
    // Overfed: tummy ache, small mood loss.
    pet.mood = clamp(pet.mood - 5);
    return { ok: false, reason: 'full', woken };
  }
  pet.hunger = clamp(pet.hunger + food.hunger);
  pet.mood = clamp(pet.mood + food.mood);
  pet.lastFedAt = now;
  const evolved = gainXp(pet, food.xp);
  return { ok: true, food: food.label, evolved, woken };
}

function pat(pet, now) {
  const woken = touch(pet, now);
  pet.mood = clamp(pet.mood + 8);
  return { ok: true, evolved: gainXp(pet, 1), woken };
}

function play(pet, now) {
  const woken = touch(pet, now);
  if (pet.energy < 15) return { ok: false, reason: 'tired', woken };
  pet.mood = clamp(pet.mood + 12);
  pet.energy = clamp(pet.energy - 10);
  pet.hunger = clamp(pet.hunger + 5);
  return { ok: true, evolved: gainXp(pet, 4), woken };
}

function chatted(pet, now) {
  touch(pet, now);
  pet.mood = clamp(pet.mood + 3);
  return { evolved: gainXp(pet, 2) };
}

function putToSleep(pet, now) {
  pet.lastInteractionAt = now;
  pet.sleeping = true;
}

// Which animation / mood face should the sprite show right now?
function currentStatus(pet) {
  if (pet.sleeping) return 'sleep';
  if (pet.hunger >= 75) return 'hungry';
  if (pet.mood <= 25) return 'sad';
  if (pet.mood >= 75) return 'happy';
  return 'idle';
}

function toStageProgress(pet) {
  const idx = STAGES.findIndex((s) => s.id === pet.stage);
  const next = STAGES[idx + 1];
  if (!next) return { next: null, pct: 100 };
  const cur = STAGES[idx];
  return { next: next.id, pct: Math.round(((pet.xp - cur.minXp) / (next.minXp - cur.minXp)) * 100) };
}

module.exports = {
  STAGES,
  FOODS,
  clamp,
  isNight,
  createPet,
  stageForXp,
  tick,
  feed,
  pat,
  play,
  chatted,
  putToSleep,
  touch,
  currentStatus,
  toStageProgress,
};
