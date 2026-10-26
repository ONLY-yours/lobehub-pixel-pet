#!/usr/bin/env node
// Fake `lh` used by tests. State lives in $FAKE_LH_DIR (logged-in flag, agents, call log).
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.FAKE_LH_DIR;
const flag = path.join(dir, 'loggedin');
const log = (o) => fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify(o) + '\n');
const args = process.argv.slice(2);
log({ args, env: { topic: process.env.LOBEHUB_TOPIC_ID || null } });

if (args[0] === 'whoami') {
  if (!fs.existsSync(flag)) { console.error('Not logged in'); process.exit(1); }
  console.log(JSON.stringify({ fullName: 'Test Owner', username: 'tester', email: 't@example.com' }));
} else if (args[0] === 'login') {
  // Mirrors the real CLI: URL and code arrive as separate writes.
  console.log('  Open this URL in your browser:');
  console.log('  https://example.com/device');
  console.log('');
  setTimeout(() => console.log(`  Enter code: ${process.env.FAKE_LH_CODE || 'ABCD-1234'}`), 200);
  if (process.env.FAKE_LH_NO_BROWSER) setTimeout(() => console.log('Could not open browser automatically.'), 400);
  setTimeout(() => { fs.writeFileSync(flag, '1'); process.exit(0); }, Number(process.env.FAKE_LH_LOGIN_MS || 300));
} else if (args[0] === 'agent' && args[1] === 'create') {
  const id = 'agt_FAKE' + Date.now();
  fs.writeFileSync(path.join(dir, 'last-create.json'), JSON.stringify({ title: args[args.indexOf('-t') + 1], systemRole: args[args.indexOf('-s') + 1] }));
  console.log(`✓ Created agent ${id}`);
} else if (args[0] === 'agent' && args[1] === 'delete') {
  console.log('✓ Deleted agent');
} else if (args[0] === 'agent' && args[1] === 'run') {
  if (process.env.FAKE_LH_FAIL_RUN === 'timeout') { setTimeout(() => {}, 60000); return; }
  if (process.env.FAKE_LH_FAIL_RUN === 'badflag') { console.error("error: unknown option '--json'"); process.exit(1); }
  if (process.env.FAKE_LH_FAIL_RUN === 'auth') { console.error('Not logged in. Run `lh login` first.'); process.exit(1); }
  if (process.env.FAKE_LH_FAIL_RUN === 'empty') { console.log('[]'); process.exit(0); }
  if (process.env.FAKE_LH_FAIL_RUN) { console.error('boom'); process.exit(1); }
  const prompt = args[args.indexOf('-p') + 1];
  const topic = args.includes('-t') ? args[args.indexOf('-t') + 1] : 'tpc_FAKE1';
  console.log(JSON.stringify([
    { type: 'agent_runtime_init', data: { topicId: topic } },
    { type: 'stream_end', data: { finalContent: `echo: ${prompt.split('\n').pop()}`, usage: { cost: 0.001 } } },
  ]));
} else { console.error('unknown'); process.exit(2); }
