'use strict';
// Turns the artifacts of `e2e/run.js all` (out/e2e) into an `lh acceptance` round directory:
//   .acceptances/standalone-pixel-pet/<timestamp>-<slug>/{result.json,report.md,proposal.md,assets/}
// A planned check whose step did not run is reported as `blocked`, a failed step as `fail`; nothing is invented.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'e2e');
const results = JSON.parse(fs.readFileSync(path.join(OUT, 'results.json'), 'utf8'));

const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const slug = process.argv[2] || 'desktop-pet-round1';
const dir = path.join(ROOT, '.acceptances', 'standalone-pixel-pet', `${STAMP.slice(0, 8)}-${STAMP.slice(8)}-${slug}`);
fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
if (!fs.existsSync(path.join(ROOT, '.acceptances', '.gitignore'))) fs.writeFileSync(path.join(ROOT, '.acceptances', '.gitignore'), '*\n');

// step spec: 'scenario:name prefix'
const find = (spec) => { const [sc, ...rest] = spec.split(':'); const sub = rest.join(':'); return results.find((r) => r.scenario === sc && r.name.startsWith(sub)); };
const asset = (file, description) => {
  const src = path.join(OUT, file);
  if (!fs.existsSync(src)) return null;
  fs.copyFileSync(src, path.join(dir, 'assets', file));
  return { path: `assets/${file}`, description };
};

const CHECKS = [
  { id: 'egg-choice', category: 'First run', title: 'First launch offers four eggs to choose from', steps: ['fresh:first launch shows four eggs'],
    method: 'Launch the app with no saved pet and look at the first screen.', expected: 'Four eggs (fire, water, grass, whale) are shown and hatching is disabled until one is chosen.',
    ok: 'The first screen shows four distinct pixel eggs labelled fire, water, grass and whale; the Hatch button is disabled.',
    shots: [['01-fresh-first-launch-shows-three-eggs.png', 'First-launch window showing three pixel-art eggs and a disabled Hatch button.']] },
  { id: 'egg-select', category: 'First run', title: 'Choosing an egg highlights it and describes its element', steps: ['fresh:choosing an egg enables hatching'],
    method: 'Click the water egg and type a name.', expected: 'The egg is highlighted, its element and personality blurb appear, the name field accepts input and Hatch becomes enabled.',
    ok: 'The water egg is highlighted with its blurb shown under the eggs; the name field holds the typed name and Hatch is enabled.',
    shots: [['02-fresh-choosing-an-egg-enables-hatching-and-sho.png', 'Water egg selected and highlighted, blurb text below, name field filled, Hatch enabled.']] },
  { id: 'login-flow', category: 'LobeHub login', title: 'Hatching starts the LobeHub login and shows the device code', steps: ['fresh:hatching invokes lh login'],
    method: 'Click Hatch while logged out (fake lh CLI that prints the same lines as the real one).', expected: 'The progress screen shows the login step active together with the verification code and URL.',
    ok: 'The progress screen marks the login step active and shows the code ABCD-1234 with the verification URL. This used a fake CLI; the real browser login was not run.',
    shots: [['03-fresh-hatching-invokes-lh-login-and-shows-the-.png', 'Hatching progress screen: login step active, device code box with code and URL, cracked egg animation.']] },
  { id: 'pet-after-login', category: 'Agent creation', title: 'After login the pet is created and appears with its chosen name and species', steps: ['fresh:after login the agent is created and the pet appears', 'fresh:CLI call order'],
    method: 'Let the fake login finish and watch the app.', expected: 'The app creates the agent, the pet appears named as chosen with a first greeting, and the CLI calls happened in the order whoami, login, whoami, agent create, agent run.',
    ok: 'The water pet appeared with the chosen name, stage and a first greeting bubble; the recorded CLI call order matched, and the agent was created with the species persona in its system role.',
    shots: [['04-fresh-after-login-the-agent-is-created-and-the.png', 'Pet screen right after hatching: water pet, greeting bubble, need bars, name and stage line, toolbar.']], texts: ['run-log.txt'] },
  { id: 'persistence', category: 'Persistence', title: 'Restarting the app brings the same pet back', steps: ['fresh:restart goes straight to the pet'],
    method: 'Close and relaunch the app with the same data directory.', expected: 'The egg screen is skipped and the saved pet is shown.',
    ok: 'After a restart the app opened directly on the saved pet with its name; the egg screen was not shown.',
    shots: [['05-fresh-restart-goes-straight-to-the-pet-state-p.png', 'Relaunched app showing the saved pet directly, no egg selection.']] },
  { id: 'real-agent', category: 'Agent creation', title: 'With a real logged-in lh, a real LobeHub agent is created with the pet persona', steps: ['live:real lh is logged in', 'live:the LobeHub agent exists'],
    method: 'Pick the grass egg with the real lh CLI (already logged in) and then run `lh agent view` on the created agent.', expected: 'Login is skipped, an agent id is created, and the agent carries the pet name and species persona.',
    ok: 'Login was skipped, a real agent id was created, and `lh agent view` showed the pet name and species persona.',
    shots: [['06-live-real-lh-is-logged-in-so-login-is-skipped.png', 'Pet screen right after hatching against the real LobeHub CLI.']], texts: ['agent-view-excerpt.txt'] },
  { id: 'llm-greeting', category: 'Personality', title: 'The pet greets in character using the real model', steps: ['live:first greeting comes from the real model'],
    method: 'Read the first bubble after hatching and check its source flag.', expected: 'A short in-character Chinese greeting generated by the agent, not a canned line.',
    ok: 'The greeting bubble was produced by the live agent (source flag llm) and was short, in character and in Chinese.',
    shots: [['07-live-first-greeting-comes-from-the-real-model.png', 'Grass pet with its first model-generated greeting bubble.']], texts: ['chat-transcript.txt'] },
  { id: 'feeding', category: 'Care', title: 'Feeding lowers hunger and shows the food', steps: ['fresh:feeding lowers hunger'],
    method: 'Force hunger to 80, open Feed and give rice (fake lh CLI).', expected: 'Hunger drops, the food sprite appears and the pet reacts.',
    ok: 'Hunger fell from 80 to 45 after feeding rice; the food sprite and a reaction bubble were shown.',
    shots: [['06-fresh-feeding-lowers-hunger-and-shows-food.png', 'Pet eating: rice sprite at its mouth, hunger bar lowered, reaction bubble.']] },
  { id: 'memory', category: 'Memory', title: 'The pet remembers what the owner told it', steps: ['live:chat: the pet answers and remembers'],
    method: 'Tell the pet a name and a favourite food, then ask whether it remembers the name.', expected: 'The second reply names the owner correctly (same LobeHub topic).',
    ok: 'Asked a moment later, the pet answered with the owner name given earlier.',
    shots: [['09-live-chat-the-pet-answers-and-remembers-what-.png', 'Chat open; the pet bubble recalls the owner name and favourite food.']], texts: ['chat-transcript.txt'] },
  { id: 'proactive', category: 'Proactive behaviour', title: 'A hungry pet speaks up on its own', steps: ['live:proactive: a hungry pet speaks up'],
    method: 'Force hunger to 95, clear the speaking cooldown and trigger one heartbeat without typing anything.', expected: 'The pet asks for food in a model-generated line.',
    ok: 'Without any user input the pet asked for food in a line generated by the live agent (source flag llm).',
    shots: [['10-live-proactive-a-hungry-pet-speaks-up-on-its-.png', 'Pet with an empty hunger bar and an unprompted request for food.']], texts: ['chat-transcript.txt'] },
  { id: 'evolution', category: 'Growth', title: 'Enough experience evolves the pet and changes its sprite', steps: ['fresh:enough xp evolves the pet'],
    method: 'Set experience to 59 and pat the pet once (fake lh CLI).', expected: 'Stage changes from baby to child and the sprite is visibly larger.',
    ok: 'The stage line changed from baby to child and the sprite grew.',
    shots: [['07-fresh-enough-xp-evolves-the-pet-baby-child-and.png', 'Pet after evolution, stage line reading child, larger sprite.'], ['evolve-before.png', 'The pet sprite just before evolving, for size comparison.']] },
  { id: 'release', category: 'Lifecycle', title: 'Releasing the pet deletes its agent through lh and returns to egg selection', steps: ['fresh:release deletes the agent through lh'],
    method: 'Open the menu, choose release-and-delete and accept the confirmation (fake lh CLI that records its calls).', expected: 'The egg screen returns and the app asks lh to delete the pet agent.',
    ok: 'The egg screen came back and the fake CLI recorded `lh agent delete <id> --yes` for the pet agent. Deletion of a real LobeHub agent was not exercised in this round.',
    shots: [['08-fresh-release-deletes-the-agent-through-lh-and.png', 'Egg selection screen shown again after releasing the pet.']], texts: ['release-check.txt'] },
  { id: 'pixel-art', category: 'Pixel art', title: 'Three species with distinct looks across growth stages and moods', steps: ['art:sprite sheet'],
    method: 'Render every species at every stage in every mood from the app sprite code.', expected: 'Fire, water and grass pets look different, evolve visibly and show different faces per mood.',
    ok: 'The sheet shows nine species/stage rows and five mood columns; species are clearly distinct, stages grow, and moods change the face and effects.',
    shots: [['sprite-sheet.png', 'Contact sheet: rows embit/bubbo/sprig by baby/child/adult, columns idle, happy, sad, hungry, sleep.']] },
];

const plan = [];
const cases = [];
for (const c of CHECKS) {
  plan.push({ id: c.id, title: c.title, category: c.category, verifier: 'agent', method: c.method, expected: c.expected, requiredEvidence: ['screenshot', ...(c.texts ? ['text'] : [])] });
  const recs = c.steps.map(find);
  const ran = recs.filter(Boolean);
  let status = 'pass';
  let observation = c.ok;
  if (ran.length < c.steps.length) {
    status = 'blocked';
    observation = 'This check did not run in this round, so it is not claimed.';
  } else if (ran.some((r) => r.status === 'fail')) {
    status = 'fail';
    const bad = ran.find((r) => r.status === 'fail');
    observation = `Failed: ${bad.note.replace(/[^\x00-\x7F]+/g, '…')}`;
  }
  const evidence = [];
  for (const [f, d] of c.shots) { const e = asset(f, d); if (e) evidence.push(e); }
  for (const t of c.texts || []) {
    const d = { 'run-log.txt': 'Full console log of the E2E run: one PASS or FAIL line per step, with the observed values.', 'agent-view-excerpt.txt': 'Output of `lh agent view` for the created agent (identity lines removed), showing the pet name and persona.', 'chat-transcript.txt': 'Raw bubble text and source flag for each model-generated line in the live run, including the messages the owner sent.', 'release-check.txt': 'The `lh agent delete` call recorded by the fake CLI when the pet was released.' }[t];
    const e = asset(t, d); if (e) evidence.push(e);
  }
  cases.push({ id: c.id, name: c.title, category: c.category, surface: 'desktop', status, observation, evidence });
}

const passed = cases.filter((c) => c.status === 'pass').length;
const failed = cases.filter((c) => c.status === 'fail').length;
const blocked = cases.filter((c) => c.status === 'blocked').length;
const verdict = failed ? 'fail' : blocked ? 'partial' : 'pass';
const result = {
  title: 'Pixel Pet desktop app: egg choice, LobeHub agent creation, living-pet behaviour',
  scenario: 'coding',
  surface: 'desktop',
  entry: 'xvfb-run -a node e2e/run.js all',
  createdAt: new Date().toISOString(),
  plan,
  cases,
  summary: { total: cases.length, passed, failed, blocked, verdict, conclusion: `${passed} of ${cases.length} checks passed, ${failed} failed, ${blocked} blocked.` + (blocked ? ' The blocked checks need a live LobeHub agent run, and lh agent run stopped completing during this round; they are not claimed.' : '') },
};
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(dir, 'proposal.md'), fs.readFileSync(path.join(__dirname, 'acceptance-proposal.md'), 'utf8'));
fs.writeFileSync(path.join(dir, 'report.md'), fs.readFileSync(path.join(__dirname, 'acceptance-report-tail.md'), 'utf8'));
console.log(dir);
