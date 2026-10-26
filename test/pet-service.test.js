'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LhClient, cleanEnv } = require('../src/core/lh-client');
const { Store } = require('../src/core/store');
const { PetService } = require('../src/main/pet-service');

const FAKE = path.join(__dirname, 'fixtures', 'fake-lh.js');
function setup(now = new Date('2026-01-05T14:00:00').getTime()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petsvc-'));
  const clock = { t: now };
  const lh = new LhClient({ bin: FAKE, env: { ...cleanEnv(), FAKE_LH_DIR: dir } });
  const svc = new PetService({ lh, store: new Store(path.join(dir, 'data')), now: () => clock.t, rnd: () => 0.5 });
  svc.on('error', () => {});
  const said = [];
  svc.on('say', (m) => said.push(m));
  return { dir, clock, lh, svc, said };
}

test('first hatch with no login runs the login flow, creates the agent, and greets', async () => {
  const { svc, said, dir } = setup();
  const steps = [];
  let prompt;
  const view = await svc.hatch({ speciesId: 'sprig', name: '小芽', onStep: (s) => steps.push(s), onLoginPrompt: (p) => { prompt = p; } });
  assert.deepEqual(steps, ['checking-login', 'login', 'creating-agent', 'hatching']);
  assert.equal(prompt.code, 'ABCD-1234');
  assert.equal(view.pet.name, '小芽');
  assert.match(view.pet.agentId, /^agt_FAKE/);
  assert.equal(said[0].kind, 'hatched');
  assert.equal(said[0].source, 'llm');
  const created = JSON.parse(fs.readFileSync(path.join(dir, 'last-create.json')));
  assert.match(created.systemRole, /叶芽/);
  assert.match(created.systemRole, /小芽/);
});

test('already logged in skips login entirely', async () => {
  const { svc, dir } = setup();
  fs.writeFileSync(path.join(dir, 'loggedin'), '1');
  const steps = [];
  await svc.hatch({ speciesId: 'embit', onStep: (s) => steps.push(s) });
  assert.deepEqual(steps, ['checking-login', 'creating-agent', 'hatching']);
  assert.equal(svc.pet.name, '焰团'); // default name comes from the species
});

test('pet persists across restarts and keeps its LobeHub topic', async () => {
  const { svc, dir, lh, clock } = setup();
  fs.writeFileSync(path.join(dir, 'loggedin'), '1');
  await svc.hatch({ speciesId: 'bubbo', name: 'B' });
  const topic = svc.pet.topicId;
  assert.ok(topic);
  const svc2 = new PetService({ lh, store: new Store(path.join(dir, 'data')), now: () => clock.t });
  const v = svc2.init();
  assert.equal(v.pet.agentId, svc.pet.agentId);
  assert.equal(v.pet.topicId, topic);
});

test('chat sends state block + text to the agent and returns the reply', async () => {
  const { svc, dir } = setup();
  fs.writeFileSync(path.join(dir, 'loggedin'), '1');
  await svc.hatch({ speciesId: 'embit', name: 'E' });
  const r = await svc.chat('今天好累');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'echo: 今天好累');
  const calls = fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n').map(JSON.parse);
  const run = calls.filter((c) => c.args[1] === 'run').pop();
  const prompt = run.args[run.args.indexOf('-p') + 1];
  assert.match(prompt, /^\[状态\]/);
});

test('when the agent call fails the pet degrades to canned lines instead of going silent', async () => {
  const { svc, dir, lh, said } = setup();
  fs.writeFileSync(path.join(dir, 'loggedin'), '1');
  await svc.hatch({ speciesId: 'embit', name: 'E' });
  lh.env.FAKE_LH_FAIL_RUN = '1';
  svc.pet.hunger = 95;
  svc.pet.lastSpokeAt = 0;
  said.length = 0;
  await svc.heartbeat();
  assert.equal(said.at(-1).kind, 'hungry');
  assert.equal(said.at(-1).source, 'fallback');
});

test('heartbeat makes a hungry pet ask for food via the agent, then stays quiet (cooldown)', async () => {
  const { svc, dir, said, clock } = setup();
  fs.writeFileSync(path.join(dir, 'loggedin'), '1');
  await svc.hatch({ speciesId: 'bubbo', name: 'B' });
  said.length = 0;
  clock.t += 13 * 60000; // past the post-hatch speaking cooldown
  svc.pet.hunger = 95;
  svc.pet.lastTickAt = clock.t;
  await svc.heartbeat();
  assert.equal(said.length, 1);
  assert.equal(said[0].kind, 'hungry');
  clock.t += 60000;
  svc.pet.hunger = 95;
  svc.pet.lastTickAt = clock.t;
  await svc.heartbeat();
  assert.equal(said.length, 1);
});

test('LLM budget exhaustion falls back to canned lines', async () => {
  const { svc, dir, said, clock } = setup();
  fs.writeFileSync(path.join(dir, 'loggedin'), '1');
  svc.budget.max = 0;
  await svc.hatch({ speciesId: 'sprig', name: 'S' });
  assert.equal(said[0].source, 'fallback');
  clock.t += 1;
});

test('release deletes the agent when asked and clears local state', async () => {
  const { svc, dir } = setup();
  fs.writeFileSync(path.join(dir, 'loggedin'), '1');
  await svc.hatch({ speciesId: 'embit', name: 'E' });
  const r = await svc.release({ deleteAgent: true });
  assert.equal(r.deleted, true);
  assert.equal(svc.pet, null);
  assert.equal(new Store(path.join(dir, 'data')).load(), null);
  const calls = fs.readFileSync(path.join(dir, 'calls.log'), 'utf8');
  assert.match(calls, /"delete"/);
});

test('cannot hatch twice', async () => {
  const { svc, dir } = setup();
  fs.writeFileSync(path.join(dir, 'loggedin'), '1');
  await svc.hatch({ speciesId: 'embit' });
  await assert.rejects(() => svc.hatch({ speciesId: 'bubbo' }), /already exists/);
});

test('care actions change needs and say something', async () => {
  const { svc, dir, said } = setup();
  fs.writeFileSync(path.join(dir, 'loggedin'), '1');
  await svc.hatch({ speciesId: 'embit', name: 'E' });
  svc.pet.hunger = 70;
  const r = svc.act('feed', 'rice');
  assert.equal(r.ok, true);
  assert.equal(svc.pet.hunger, 35);
  assert.equal(said.at(-1).kind, 'feed');
  assert.equal(svc.act('play').ok, true);
});

test('a failed chat reports the error code and leaves a consistent, awake pet', async () => {
  const { svc, dir, lh } = setup();
  fs.writeFileSync(path.join(dir, 'loggedin'), '1');
  await svc.hatch({ speciesId: 'bubbo', name: 'B' });
  svc.pet.sleeping = true;
  lh.env.FAKE_LH_FAIL_RUN = 'auth';
  const r = await svc.chat('hi');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EAUTH');
  assert.equal(svc.pet.sleeping, false);
});
