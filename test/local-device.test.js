'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickDevice, ensureLocalDevice, bindConfig, unbindConfig } = require('../src/core/local-device');

const dev = (id, over = {}) => ({ deviceId: id, online: true, platform: 'darwin', hostname: 'Mac', channels: [{ channel: 'desktop', hostname: '192.168.1.5', connectedAt: '2026-10-26T02:00:00Z' }], ...over });

test('picks the only online device of this platform (the desktop app reports hostname "Mac")', () => {
  const list = [dev('mac1'), dev('win1', { platform: 'win32' }), dev('old', { online: false })];
  assert.equal(pickDevice(list, { platform: 'darwin', hostname: 'lijian-MacBook-Pro.local' }).deviceId, 'mac1');
});

test('ignores offline devices and other platforms, returning null when nothing matches', () => {
  assert.equal(pickDevice([dev('a', { online: false }), dev('b', { platform: 'linux' })], { platform: 'darwin' }), null);
  assert.equal(pickDevice([], { platform: 'darwin' }), null);
});

test('with several candidates, the matching hostname wins, then the most recently connected', () => {
  const a = dev('a', { hostname: 'other' });
  const b = dev('b', { hostname: 'my-mac' });
  assert.equal(pickDevice([a, b], { platform: 'darwin', hostname: 'My-Mac.local' }).deviceId, 'b');
  const old = dev('old', { channels: [{ connectedAt: '2026-10-01T00:00:00Z' }] });
  const fresh = dev('fresh', { channels: [{ connectedAt: '2026-10-25T00:00:00Z' }] });
  assert.equal(pickDevice([old, fresh], { platform: 'darwin', hostname: 'zzz' }).deviceId, 'fresh');
});

const noSleep = async () => {};
const mkLh = ({ running = false, devices = [], startFails = null, onStart = () => {} } = {}) => {
  const calls = { start: 0 };
  let list = devices;
  const lh = {
    calls,
    daemonStatus: async () => ({ running }),
    startConnectDaemon: async () => {
      calls.start++;
      if (startFails) throw new Error(startFails);
      onStart((d) => { list = d; });
    },
    listDevices: async () => list,
  };
  return lh;
};

test('the daemon is started even when the LobeHub desktop app already shows this computer as online', async () => {
  const lh = mkLh({ devices: [dev('mac1')] });
  const r = await ensureLocalDevice(lh, { platform: 'darwin', sleep: noSleep });
  assert.equal(lh.calls.start, 1);
  assert.equal(r.deviceId, 'mac1');
  assert.equal(r.via, 'daemon');
  assert.equal(r.daemon.started, true);
});

test('a daemon that is already running is not started again', async () => {
  const lh = mkLh({ running: true, devices: [dev('mac1')] });
  const r = await ensureLocalDevice(lh, { platform: 'darwin', sleep: noSleep });
  assert.equal(lh.calls.start, 0);
  assert.equal(r.via, 'daemon');
  assert.equal(r.daemon.running, true);
});

test('with no device online, the daemon is started and the device is awaited', async () => {
  let polls = 0;
  const lh = mkLh();
  lh.listDevices = async () => { polls++; return lh.calls.start && polls > 2 ? [dev('daemon1')] : []; };
  const r = await ensureLocalDevice(lh, { platform: 'darwin', intervalMs: 1, sleep: noSleep });
  assert.deepEqual({ id: r.deviceId, via: r.via }, { id: 'daemon1', via: 'daemon' });
});

test('if the daemon cannot start but the desktop app device is online, tools still work and the problem is reported', async () => {
  const lh = mkLh({ devices: [dev('mac1')], startFails: 'lh connect failed: not logged in' });
  const r = await ensureLocalDevice(lh, { platform: 'darwin', sleep: noSleep });
  assert.equal(r.via, 'existing');
  assert.match(r.daemon.error, /not logged in/);
});

test('if the daemon cannot start and no device is online, the error says so', async () => {
  const lh = mkLh({ startFails: 'boom' });
  await assert.rejects(() => ensureLocalDevice(lh, { platform: 'darwin', sleep: noSleep }), /Could not start `lh connect`.*boom/);
});

test('gives a readable error if the device never appears after a successful start', async () => {
  const lh = mkLh();
  await assert.rejects(() => ensureLocalDevice(lh, { platform: 'darwin', waitMs: 3, intervalMs: 1, sleep: noSleep }), /did not show up/);
});

test('bind and unbind configs match what the agent expects', () => {
  assert.deepEqual(bindConfig('d1'), { boundDeviceId: 'd1', executionTarget: 'local' });
  assert.deepEqual(unbindConfig(), { boundDeviceId: null });
});
