'use strict';

const { EventEmitter } = require('node:events');
const state = require('../core/pet-state');
const persona = require('../core/persona');
const { getSpecies } = require('../core/species');
const { nextEvent, LlmBudget, fallbackLine } = require('../core/proactive');
const { ensureLocalDevice, bindConfig, unbindConfig, LOCAL_TOOLS } = require('../core/local-device');

const LOCAL_RECHECK_MS = 6 * 60 * 60 * 1000; // re-confirm the device binding a few times a day
const LOCAL_RETRY_MS = 5 * 60 * 1000; // after a failure, do not hammer `lh` on every message

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
    this._localOk = false;
    this._localCheckedAt = 0;
    this._localFailedAt = 0;
    this.localError = null;
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
      busy: this.busy,
      local: { enabled: !!this.pet.localAbilities, ok: this._localOk, error: this.localError },
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
  async hatch({ speciesId, name, localAbilities = false, onStep = () => {}, onLoginPrompt = () => {} }) {
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
    this.pet.personaVersion = persona.PERSONA_VERSION; // the agent was just created with the current role
    this._save();

    let localError = null;
    if (localAbilities) {
      onStep('connecting-device');
      this.pet.localAbilities = true;
      await this._verifyLocal({ force: true });
      if (!this._localOk) {
        this.pet.localAbilities = false;
        localError = this.localError;
      }
      this._save();
    }

    onStep('hatching');
    await this._speak('hatched');
    return { view: this.view(), localError };
  }

  // ---- keeping an existing agent up to date ---------------------------------------------
  // Older pets were created with an older system role; update the LobeHub agent once.
  async _ensureReady() {
    const p = this.pet;
    if (p.personaVersion !== persona.PERSONA_VERSION) {
      try {
        await this.lh.updateAgent({ agentId: p.agentId, systemRole: persona.buildSystemRole({ speciesId: p.speciesId, name: p.name }) });
        p.personaVersion = persona.PERSONA_VERSION;
        this._save();
      } catch (e) {
        this.emit('error', e); // carry on with the old prompt; retried on the next turn
      }
    }
    if (p.localAbilities) await this._verifyLocal();
  }

  // Find this computer's online device (starting `lh connect --daemon` if none) and bind the agent to it.
  async _verifyLocal({ force = false } = {}) {
    const t = this.now();
    if (!force) {
      if (this._localOk && t - this._localCheckedAt < LOCAL_RECHECK_MS) return;
      if (!this._localOk && this._localFailedAt && t - this._localFailedAt < LOCAL_RETRY_MS) return;
    }
    try {
      const { deviceId, via } = await ensureLocalDevice(this.lh);
      if (this.pet.boundDeviceId !== deviceId) {
        await this.lh.updateAgent({ agentId: this.pet.agentId, agencyConfig: bindConfig(deviceId) });
        this.pet.boundDeviceId = deviceId;
      }
      this._localOk = true;
      this._localCheckedAt = t;
      this._localFailedAt = 0;
      this.localError = null;
      this.localVia = via;
    } catch (e) {
      this._localOk = false;
      this._localFailedAt = t;
      this.localError = e.message;
      this.emit('error', e);
    }
  }

  // Turn "use this computer" on or off for the pet's agent.
  async setLocalAbilities(on) {
    if (!this.pet) return { ok: false, reason: 'empty' };
    if (this.busy) return { ok: false, reason: 'busy' };
    this.busy = true;
    this.emit('thinking', true);
    try {
      if (on) {
        this.pet.localAbilities = true;
        await this._verifyLocal({ force: true });
        if (!this._localOk) {
          this.pet.localAbilities = false;
          return { ok: false, reason: 'error', message: this.localError };
        }
        return { ok: true, via: this.localVia };
      }
      await this.lh.updateAgent({ agentId: this.pet.agentId, agencyConfig: unbindConfig() });
      this.pet.localAbilities = false;
      this.pet.boundDeviceId = null;
      this._localOk = false;
      return { ok: true };
    } catch (e) {
      this.emit('error', e);
      return { ok: false, reason: 'error', message: e.message };
    } finally {
      this.busy = false;
      this._save();
      this.emit('thinking', false);
    }
  }

  // At launch: bring an existing pet's agent up to date in the background (persona, device binding).
  async warmup() {
    if (!this.pet || this.busy) return;
    await this._ensureReady();
  }

  _tools() {
    return this.pet.localAbilities && this._localOk ? LOCAL_TOOLS : [];
  }

  // Stop whatever the agent is doing right now.
  cancel() {
    if (this.busy) this.lh.cancel();
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
      await this._ensureReady();
      const res = await this.lh.run({
        agentId: this.pet.agentId,
        topicId: this.pet.topicId,
        prompt: persona.buildEventPrompt(kind, this.pet, t),
        tools: this._tools(),
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

  // `images` are local file paths (already validated by the caller). The picture goes into the
  // topic as its own user message, then the agent run answers it with the picture in context.
  async chat(text, images = []) {
    const clean = String(text || '').trim();
    if (!this.pet || (!clean && images.length === 0)) return { ok: false, reason: 'empty' };
    if (this.busy) return { ok: false, reason: 'busy' };
    const t = this.now();
    this.busy = true;
    this.emit('thinking', true);
    try {
      state.touch(this.pet, t);
      await this._ensureReady();
      let prompt;
      if (images.length) {
        const fileIds = [];
        for (const img of images) fileIds.push(await this.lh.uploadFile(img));
        if (!this.pet.topicId) this.pet.topicId = await this.lh.createTopic(this.pet.agentId, this.pet.name);
        const mid = await this.lh.createUserMessage({ agentId: this.pet.agentId, topicId: this.pet.topicId, content: clean || '（发了一张图片）' });
        await this.lh.addFilesToMessage(mid, fileIds);
        prompt = persona.buildChatPrompt(`[图片] 主人刚发来 ${images.length} 张图片${clean ? '和上面那句话' : ''}（就在上一条消息里），请先看图，再直接回应。`, this.pet, t, { local: this._tools().length > 0 });
      } else {
        prompt = persona.buildChatPrompt(clean, this.pet, t, { local: this._tools().length > 0 });
      }
      const res = await this.lh.run({ agentId: this.pet.agentId, topicId: this.pet.topicId, prompt, tools: this._tools() });
      if (res.topicId) this.pet.topicId = res.topicId;
      const { evolved } = state.chatted(this.pet, this.now());
      this._say(res.text, 'llm', 'chat');
      if (evolved) setImmediate(() => this._onEvolved());
      return { ok: true, text: res.text, cost: res.cost };
    } catch (e) {
      if (e.code !== 'ECANCELED') this.emit('error', e);
      this._save(); // touch() above may have woken the pet; keep the sprite in sync
      if (e.code === 'ECANCELED') return { ok: false, reason: 'canceled' };
      return { ok: false, reason: 'error', code: e.code || null, message: e.message };
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
    if (this.busy) return { ok: false, reason: 'busy' }; // no side actions while the pet is working
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
