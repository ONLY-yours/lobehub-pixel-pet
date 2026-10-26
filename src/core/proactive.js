'use strict';

// Decides *when* the pet should speak on its own. Pure function over pet state;
// the caller decides whether to spend an LLM call or use the offline fallback.

const MIN = 60 * 1000;

const DEFAULTS = {
  speakCooldownMin: 12, // never speak twice within this window
  boredAfterMin: 45,
  hungryAt: 75,
  maxLlmPerHour: 6,
};

function pick(arr, rnd = Math.random) {
  return arr[Math.floor(rnd() * arr.length)];
}

// Returns an event kind or null.
function nextEvent(pet, now, opts = {}, rnd = Math.random) {
  const o = { ...DEFAULTS, ...opts };
  if (pet.sleeping) return null;
  if (now - pet.lastSpokeAt < o.speakCooldownMin * MIN) return null;

  if (pet.hunger >= o.hungryAt) return 'hungry';

  const idleMin = (now - pet.lastInteractionAt) / MIN;
  if (idleMin >= o.boredAfterMin && rnd() < 0.5) return 'bored';

  const h = new Date(now).getHours();
  const day = new Date(now).toDateString();
  if (pet.lastGreetDay !== day) {
    if (h >= 6 && h < 11) return 'greet_morning';
    if (h >= 20 && h < 23) return 'greet_evening';
  }
  return null;
}

// Hourly budget so a chatty pet cannot run up the bill.
class LlmBudget {
  constructor(maxPerHour = DEFAULTS.maxLlmPerHour) {
    this.max = maxPerHour;
    this.stamps = [];
  }
  canSpend(now) {
    this.stamps = this.stamps.filter((t) => now - t < 60 * MIN);
    return this.stamps.length < this.max;
  }
  spend(now) {
    this.stamps.push(now);
  }
}

function fallbackLine(species, kind, rnd = Math.random) {
  const map = { hungry: 'hungry', bored: 'bored', greet_morning: 'greet', greet_evening: 'sleepy', evolved: 'happy', hatched: 'greet', fed: 'happy', played: 'happy' };
  const lines = species.fallback[map[kind] || 'happy'] || species.fallback.happy;
  return pick(lines, rnd);
}

module.exports = { nextEvent, LlmBudget, fallbackLine, DEFAULTS, pick };
