'use strict';

// Thin wrapper around the LobeHub CLI (`lh`). The app never talks to the
// LobeHub API directly; swapping the harness means swapping this file.

const { spawn } = require('node:child_process');

// Variables that make `lh` attach its output to someone else's run. They are
// only ever set when we are launched from inside an agent run (dev/CI).
const RUN_CONTEXT_VARS = [
  'LOBEHUB_TOPIC_ID',
  'LOBEHUB_OPERATION_ID',
  'LOBEHUB_AGENT_ID',
  'LOBEHUB_ASSISTANT_MESSAGE_ID',
];

function cleanEnv(base = process.env) {
  const env = { ...base };
  for (const k of RUN_CONTEXT_VARS) delete env[k];
  if (env.PIXELPET_CLEAR_JWT === '1') env.LOBEHUB_JWT = '';
  return env;
}

class LhError extends Error {
  constructor(message, { code, stderr } = {}) {
    super(message);
    this.name = 'LhError';
    this.code = code;
    this.stderr = stderr;
  }
}

function runLh(bin, args, { timeoutMs = 120000, env, onStdout, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { env: env || cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(new LhError(`Cannot start ${bin}: ${e.message}`));
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d;
      if (onStdout) onStdout(String(d));
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (onStderr) onStderr(String(d));
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new LhError(e.code === 'ENOENT' ? `\`${bin}\` not found. Install the LobeHub CLI first.` : e.message, { code: e.code }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new LhError(`lh ${args[0]} timed out after ${timeoutMs}ms`, { code: 'ETIMEDOUT', stderr }));
      resolve({ code, stdout, stderr });
    });
  });
}

class LhClient {
  constructor({ bin = process.env.LH_BIN || 'lh', env } = {}) {
    this.bin = bin;
    this.env = env;
  }

  _run(args, opts = {}) {
    return runLh(this.bin, args, { env: this.env || cleanEnv(), ...opts });
  }

  // Returns the logged-in user, or null when not authenticated.
  async whoami() {
    const r = await this._run(['whoami', '--json'], { timeoutMs: 30000 });
    if (r.code !== 0) return null;
    try {
      const u = JSON.parse(r.stdout);
      return { name: u.fullName || u.username || u.email || 'unknown', username: u.username, email: u.email };
    } catch {
      return null;
    }
  }

  // Starts the browser device-code login. The CLI prints
  //   "Open this URL in your browser:\n  <url>\n\n  Enter code: <code>"
  // on separate lines and opens the browser itself. `onPrompt({url, code,
  // browserFailed})` fires once both are known (or shortly after the URL alone),
  // and again with browserFailed=true if the CLI could not open a browser.
  async login({ onPrompt = () => {}, timeoutMs = 10 * 60 * 1000 } = {}) {
    let buf = '';
    let announced = false;
    let browserFailed = false;
    let timer = null;
    let last = null;
    const emit = (url, code) => {
      announced = true;
      clearTimeout(timer);
      last = { url, code };
      onPrompt({ url, code, browserFailed });
    };
    const scan = (chunk) => {
      buf += chunk;
      const url = buf.match(/https?:\/\/[^\s)]+/);
      const code = buf.match(/Enter code:\s*([A-Za-z0-9-]+)/i) || buf.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
      if (!announced && url && code) emit(url[0], code[1]);
      else if (!announced && url && !timer) timer = setTimeout(() => { if (!announced) emit(url[0], code ? code[1] : null); }, 1500);
      if (announced && !browserFailed && /could not open browser/i.test(buf)) {
        browserFailed = true;
        onPrompt({ ...last, browserFailed: true });
      }
    };
    let r;
    try {
      r = await this._run(['login'], { timeoutMs, onStdout: scan, onStderr: scan });
    } finally {
      clearTimeout(timer);
    }
    if (r.code !== 0) throw new LhError(`lh login failed (exit ${r.code})`, { code: r.code, stderr: r.stderr });
    return this.whoami();
  }

  // Creates the pet's agent. `lh agent create` has no --json, so the id is
  // parsed from its human-readable output.
  async createAgent({ title, description, systemRole }) {
    const args = ['agent', 'create', '-t', title, '-s', systemRole];
    if (description) args.push('-d', description);
    const r = await this._run(args, { timeoutMs: 60000 });
    const m = (r.stdout + r.stderr).match(/\bagt_[A-Za-z0-9]+\b/);
    if (r.code !== 0 || !m) throw new LhError(`Could not create agent: ${(r.stderr || r.stdout).trim().slice(0, 300)}`, { code: r.code, stderr: r.stderr });
    return { agentId: m[0] };
  }

  async deleteAgent(agentId) {
    const r = await this._run(['agent', 'delete', agentId, '--yes'], { timeoutMs: 30000 });
    return r.code === 0;
  }

  // One conversational turn. Reusing `topicId` keeps the pet's long-term
  // history inside LobeHub. Returns { text, topicId, cost }.
  async run({ agentId, prompt, topicId, timeoutMs = 90000 }) {
    const args = ['agent', 'run', '-a', agentId, '-p', prompt, '--json', '--timeout', String(Math.ceil(timeoutMs / 1000))];
    if (topicId) args.push('-t', topicId);
    const r = await this._run(args, { timeoutMs: timeoutMs + 5000 });
    const parsed = parseRunEvents(r.stdout);
    if (r.code !== 0 && !parsed.text) {
      throw new LhError(`Agent run failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 300)}`, { code: r.code, stderr: r.stderr });
    }
    if (!parsed.text) throw new LhError('Agent produced no reply', { code: r.code, stderr: r.stderr });
    return parsed;
  }
}

// Extract the final reply from `lh agent run --json` output (a JSON array of events).
function parseRunEvents(stdout) {
  let events;
  try {
    events = JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf('[');
    try {
      events = JSON.parse(stdout.slice(start));
    } catch {
      return { text: '', topicId: null, cost: null };
    }
  }
  if (!Array.isArray(events)) return { text: '', topicId: null, cost: null };
  let text = '';
  let topicId = null;
  let cost = null;
  for (const e of events) {
    if (e.type === 'agent_runtime_init' && e.data && e.data.topicId) topicId = e.data.topicId;
    if (e.type === 'stream_end' && e.data) {
      if (typeof e.data.finalContent === 'string' && e.data.finalContent.trim()) text = e.data.finalContent.trim();
      if (e.data.usage && typeof e.data.usage.cost === 'number') cost = (cost || 0) + e.data.usage.cost;
    }
  }
  return { text, topicId, cost };
}

module.exports = { LhClient, LhError, runLh, cleanEnv, parseRunEvents, RUN_CONTEXT_VARS };
