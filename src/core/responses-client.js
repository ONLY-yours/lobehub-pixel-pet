'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function readCredentials(env = process.env) {
  const dir = path.join(os.homedir(), env.LOBEHUB_CLI_HOME || '.lobehub');
  const data = fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8');
  try { return JSON.parse(data); } catch {}
  const packed = Buffer.from(data, 'base64');
  const key = crypto.pbkdf2Sync(`lobehub-cli:${os.hostname()}:${os.userInfo().username}`, 'lobehub-cli-salt', 100000, 32, 'sha256');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  cipher.setAuthTag(packed.subarray(12, 28));
  return JSON.parse(cipher.update(packed.subarray(28)) + cipher.final('utf8'));
}

const LOCAL_TOOLS = [
  { type: 'function', name: 'read_file', description: 'Read a UTF-8 local file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { type: 'function', name: 'list_directory', description: 'List a local directory', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { type: 'function', name: 'run_command', description: 'Run a command on the local computer', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'], additionalProperties: false } },
];

async function localTool(name, args, signal) {
  if (signal.aborted) throw Object.assign(new Error('Canceled'), { code: 'ECANCELED' });
  if (name === 'read_file') {
    const stat = await fs.promises.stat(args.path);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('File must be a regular file under 1 MB');
    return (await fs.promises.readFile(args.path, 'utf8')).slice(0, 50000);
  }
  if (name === 'list_directory') return (await fs.promises.readdir(args.path, { withFileTypes: true })).slice(0, 500).map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`).join('\n');
  if (name !== 'run_command') throw new Error('Unknown local tool');
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('LOBEHUB_')));
    const child = spawn(args.command, { cwd: args.cwd || os.homedir(), shell: true, windowsHide: true, detached: process.platform !== 'win32', env });
    const stop = () => {
      try { if (process.platform === 'win32') child.kill(); else process.kill(-child.pid, 'SIGKILL'); } catch {}
    };
    const timer = setTimeout(stop, 30000);
    signal.addEventListener('abort', stop, { once: true });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output = (output + chunk).slice(0, 50000); });
    child.on('error', (error) => { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); signal.removeEventListener('abort', stop); resolve(`exit ${code}\n${output}`); });
  });
}

class ResponsesClient {
  constructor({ lh, fetchImpl = fetch, token, server } = {}) {
    this.lh = lh;
    this.fetch = fetchImpl;
    this.token = token;
    this.server = server;
    this.localTransport = true;
    this.active = new Set();
  }

  cancel() { for (const controller of this.active) controller.abort(); this.lh.cancel(); }

  async run({ agentId, prompt, responseId, tools = [], images = [], timeoutMs = 120000 }) {
    const controller = new AbortController();
    this.active.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      let token = this.token || process.env.LOBEHUB_CLI_API_KEY;
      if (!token) {
        if (!await this.lh.whoami()) throw Object.assign(new Error('LobeHub login is missing or expired'), { code: 'EAUTH' });
        if (controller.signal.aborted) throw new Error('Canceled');
        token = readCredentials().accessToken;
      }
      let server = this.server || process.env.LOBEHUB_SERVER;
      if (!server) {
        try { server = JSON.parse(fs.readFileSync(path.join(os.homedir(), process.env.LOBEHUB_CLI_HOME || '.lobehub', 'settings.json'), 'utf8')).serverUrl; } catch {}
      }
      server = (server || 'https://app.lobehub.com').replace(/\/$/, '');
      let workspaceId;
      if (typeof this.lh._run === 'function') {
        const scope = await this.lh._run(['workspace', 'current', '--json'], { timeoutMs: 30000 });
        if (scope.code !== 0) throw Object.assign(new Error('Could not resolve LobeHub workspace'), { code: 'EAUTH' });
        try { workspaceId = JSON.parse(scope.stdout).workspaceId; } catch { throw new Error('Could not parse LobeHub workspace'); }
      }
      const content = [{ type: 'input_text', text: prompt }];
      for (const image of images) {
        const ext = path.extname(image).toLowerCase();
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext];
        if (!mime) throw new Error('Unsupported image format');
        content.push({ type: 'input_image', image_url: `data:${mime};base64,${(await fs.promises.readFile(image)).toString('base64')}` });
      }
      let input = [{ type: 'message', role: 'user', content }];
      let previous = responseId || undefined;
      for (let step = 0; step < 12; step++) {
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
        const response = await this.fetch(`${server}/api/v1/responses`, { method: 'POST', headers, body: JSON.stringify({ model: agentId, input, previous_response_id: previous, stream: false, tools: tools.length ? LOCAL_TOOLS : [], tools_mode: 'exclusive' }), signal: controller.signal });
        if (!response.ok) throw Object.assign(new Error(`Responses API HTTP ${response.status}`), { code: response.status === 401 || response.status === 403 ? 'EAUTH' : 'EAPI' });
        const result = await response.json();
        if (result.status === 'failed') throw Object.assign(new Error(`Responses API: ${result.error?.message || 'failed'}`), { code: 'EAPI' });
        const calls = (result.output || []).filter((item) => item.type === 'function_call');
        if (!calls.length) {
          if (result.status === 'incomplete') throw Object.assign(new Error('Responses API returned an incomplete response'), { code: 'EAPI' });
          const text = result.output_text || (result.output || []).flatMap((item) => item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text).join('');
          if (!text) throw Object.assign(new Error('Agent produced no reply'), { code: 'ENOREPLY' });
          return { text, responseId: result.id, cost: null };
        }
        if (!tools.length) throw new Error('Local tools are disabled');
        input = [];
        for (const call of calls) {
          let output;
          try { output = await localTool(call.name, JSON.parse(call.arguments), controller.signal); } catch (error) { if (controller.signal.aborted) throw error; output = `Error: ${error.message}`; }
          input.push({ type: 'function_call_output', call_id: call.call_id, output: String(output) });
        }
        previous = result.id;
      }
      throw new Error('Too many local tool calls');
    } catch (error) {
      if (controller.signal.aborted) throw Object.assign(new Error(timedOut ? 'Responses API timed out' : 'Canceled'), { code: timedOut ? 'ETIMEDOUT' : 'ECANCELED' });
      throw error;
    } finally { clearTimeout(timer); this.active.delete(controller); }
  }
}

module.exports = { ResponsesClient, LOCAL_TOOLS, localTool, readCredentials };
