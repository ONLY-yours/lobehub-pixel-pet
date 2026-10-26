'use strict';

const { EventEmitter } = require('node:events');
const state = require('../core/pet-state');
const persona = require('../core/persona');
const { getSpecies } = require('../core/species');
const { nextEvent, LlmBudget, fallbackLine } = require('../core/proactive');

// Owns the pet's lifecycle. Electron-free so it can be tested with a fake `lh`.
class PetService extends EventEmitter {
  constructor({ lh, store, now = () => Date.now(), rnd = Math.random, budget = new LlmBudget() }) {
    super();
    this.lh = lh;
    this.store = store;
    this.now = now;
    this.rnd = rnd;
    this.budget = budget;
    this.pet = null;
    this.busy = false;
  }

  init() {
    this.pet = this.store.load();
    if (this.pet) state.tick(this.pet, this.now());
    return this.view();
  }

  view() {
    if (!this.pet) return null;
    const sp = getSpecies(this.pet.speciesId);
    return {
      pet: { ...this.pet },
      status: state.currentStatus(this.pet),
      progress: state.toStageProgress(this.pet),
      species: { id: sp.id, name: sp.name, nameZh: sp.nameZh, element: sp.element },
    };
  }

  _save() {
    this.store.save(this.pet);
    this.emit('update', this.view());
  }

  _say(text, source, kind, reason = null) {
    if (this.pet) this.pet.lastSpokeAt = this.now();
    this.emit('say', { text, source, kind, reason });
    if (this.pet) this._save();
  }

  // Login (if needed) -> create the LobeHub agent -> create local pet state.
  async hatch({ speciesId, name, onStep = () => {}, onLoginPrompt = () => {} }) {
    if (this.pet) throw new Error('A pet already exists');
    const sp = getSpecies(speciesId);
    const petName = (name || '').trim().slice(0, 12) || sp.nameZh;

    onStep('checking-login');
    let user = await this.lh.whoami();
    if (!user) {
      onStep('login');
      user = await this.lh.login({ onPrompt: onLoginPrompt });
      if (!user) throw new Error('Login did not complete');
    }

    onStep('creating-agent');
    const { agentId } = await this.lh.createAgent({
      title: `${petName} (${sp.name})`,
      description: `Pixel Pet · ${sp.nameZh} · ${sp.element}`,
      systemRole: persona.buildSystemRole({ speciesId, name: petName }),
    });

    this.pet = state.createPet({ speciesId, name: petName, agentId, now: this.now() });
    this.pet.owner = user.name;
    this._save();

    onStep('hatching');
    await this._speak('hatched');
    return this.view();
  }

  // Ask the agent to say something for a system-triggered event.
  async _speak(kind) {
    const t = this.now();
    const sp = getSpecies(this.pet.speciesId);
    if (this.busy || !this.budget.canSpend(t)) {
      this._say(fallbackLine(sp, kind, this.rnd), 'fallback', kind, this.busy ? 'agent busy' : 'hourly LLM budget spent');
      return;
    }
    this.busy = true;
    this.emit('thinking', true);
    try {
      this.budget.spend(t);
      const res = await this.lh.run({
        agentId: this.pet.agentId,
        topicId: this.pet.topicId,
        prompt: persona.buildEventPrompt(kind, this.pet, t),
      });
      if (res.topicId) this.pet.topicId = res.topicId;
      if (kind === 'greet_morning' || kind === 'greet_evening') this.pet.lastGreetDay = new Date(t).toDateString();
      this._say(res.text, 'llm', kind);
    } catch (e) {
      if (kind === 'greet_morning' || kind === 'greet_evening') this.pet.lastGreetDay = new Date(t).toDateString();
      this._say(fallbackLine(sp, kind, this.rnd), 'fallback', kind, e.message);
      this.emit('error', e);
    } finally {
      this.busy = false;
      this.emit('thinking', false);
    }
  }

  async chat(text) {
    const clean = String(text || '').trim();
    if (!this.pet || !clean) return { ok: false, reason: 'empty' };
    if (this.busy) return { ok: false, reason: 'busy' };
    const t = this.now();
    this.busy = true;
    this.emit('thinking', true);
    try {
      state.touch(this.pet, t);
      const res = await this.lh.run({
        agentId: this.pet.agentId,
        topicId: this.pet.topicId,
        prompt: persona.buildChatPrompt(clean, this.pet, t),
      });
      if (res.topicId) this.pet.topicId = res.topicId;
      const { evolved } = state.chatted(this.pet, this.now());
      this._say(res.text, 'llm', 'chat');
      if (evolved) setImmediate(() => this._onEvolved());
      return { ok: true, text: res.text, cost: res.cost };
    } catch (e) {
      this.emit('error', e);
      return { ok: false, reason: 'error', message: e.message };
    } finally {
      this.busy = false;
      this.emit('thinking', false);
    }
  }

  async _onEvolved() {
    this.emit('evolved', this.pet.stage);
    await this._speak('evolved');
  }

  // Care actions: instant, deterministic, no LLM cost (reaction line is canned).
  act(kind, food) {
    if (!this.pet) return { ok: false };
    const t = this.now();
    const sp = getSpecies(this.pet.speciesId);
    let r;
    if (kind === 'feed') r = state.feed(this.pet, food, t);
    else if (kind === 'pat') r = state.pat(this.pet, t);
    else if (kind === 'play') r = state.play(this.pet, t);
    else if (kind === 'sleep') { state.putToSleep(this.pet, t); r = { ok: true }; }
    else return { ok: false };

    let line = null;
    if (kind === 'sleep') line = sp.fallback.sleepy[0];
    else if (r.reason === 'full') line = '呃……肚子圆滚滚的，吃不下了。';
    else if (r.reason === 'tired') line = '好累……让我睡一会儿。';
    else if (r.ok) line = fallbackLine(sp, kind === 'feed' ? 'fed' : 'played', this.rnd);
    if (line) this._say(line, 'fallback', kind);
    else this._save();
    if (r.evolved) setImmediate(() => this._onEvolved());
    return r;
  }

  // Called on a timer. Advances needs and maybe lets the pet speak up.
  async heartbeat() {
    if (!this.pet) return;
    const t = this.now();
    const { events } = state.tick(this.pet, t);
    this._save();
    if (events.includes('woke')) this.emit('say', { text: '哈——睡饱啦。', source: 'fallback', kind: 'woke' });
    const kind = nextEvent(this.pet, t, {}, this.rnd);
    if (kind) await this._speak(kind);
  }

  // Release the pet: optionally delete the LobeHub agent as well.
  async release({ deleteAgent = false } = {}) {
    if (!this.pet) return { ok: true };
    let deleted = false;
    if (deleteAgent) deleted = await this.lh.deleteAgent(this.pet.agentId);
    this.pet = null;
    this.store.clear();
    this.emit('update', null);
    return { ok: true, deleted };
  }
}

module.exports = { PetService };
