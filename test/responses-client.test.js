'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ResponsesClient } = require('../src/core/responses-client');

test('executes local calls and resumes the response chain', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-response-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello');
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const result = requests.length === 1
      ? { id: 'response-1', status: 'incomplete', output: [{ type: 'function_call', name: 'read_file', call_id: 'call-1', arguments: JSON.stringify({ path: path.join(dir, 'hello.txt') }) }] }
      : { id: 'response-2', status: 'completed', output_text: 'done', output: [] };
    return { ok: true, json: async () => result };
  };
  const client = new ResponsesClient({ token: 'test', server: 'https://example.test', lh: { cancel() {} }, fetchImpl });
  const result = await client.run({ agentId: 'agent', prompt: 'read', responseId: 'old', tools: ['local'] });
  assert.equal(requests[0].previous_response_id, 'old');
  assert.equal(requests[1].previous_response_id, 'response-1');
  assert.deepEqual(requests[1].input, [{ type: 'function_call_output', call_id: 'call-1', output: 'hello' }]);
  assert.deepEqual(result, { text: 'done', responseId: 'response-2', cost: null });
});

test('does not execute function calls when local access is disabled', async () => {
  const client = new ResponsesClient({ token: 'test', lh: { cancel() {} }, fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'one', output: [{ type: 'function_call', name: 'run_command', call_id: 'c', arguments: '{}' }] }) }) });
  await assert.rejects(client.run({ agentId: 'agent', prompt: 'hello' }), /disabled/);
});

test('cancellation aborts an in-flight HTTP request', async () => {
  const client = new ResponsesClient({ token: 'test', lh: { cancel() {} }, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  const running = client.run({ agentId: 'agent', prompt: 'hello' });
  client.cancel();
  await assert.rejects(running, (error) => error.code === 'ECANCELED');
});
