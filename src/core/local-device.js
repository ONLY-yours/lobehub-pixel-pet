'use strict';

// Lets the pet's LobeHub agent use THIS computer (read/write files, search, run commands).
// LobeHub routes an agent's local tools to a "device" the account has online: either the
// LobeHub desktop app or `lh connect`. The agent is bound to a device through
// agencyConfig.boundDeviceId, so the app (a) finds this machine's online device, starting
// `lh connect --daemon` only if none is online, and (b) binds the pet's agent to it.

const os = require('node:os');

const norm = (h) => String(h || '').toLowerCase().replace(/\.local$/, '');
const LOCAL_TOOLS = ['lobe-local-system'];

// Choose this machine's device among the account's devices. Hostnames are not reliable
// (the desktop app reports "Mac"), so platform + online wins, hostname breaks ties.
function pickDevice(devices, { platform = process.platform, hostname = os.hostname() } = {}) {
  const online = (devices || []).filter((d) => d && d.online && d.platform === platform);
  if (online.length === 0) return null;
  if (online.length === 1) return online[0];
  const sameHost = online.find((d) => norm(d.hostname) === norm(hostname) || (d.channels || []).some((c) => norm(c.hostname) === norm(hostname)));
  if (sameHost) return sameHost;
  const newest = (d) => Math.max(0, ...(d.channels || []).map((c) => Date.parse(c.connectedAt) || 0));
  return [...online].sort((a, b) => newest(b) - newest(a))[0];
}

// Returns { deviceId, via: 'existing' | 'daemon' }. Throws a readable Error when no device comes online.
async function ensureLocalDevice(lh, { waitMs = 20000, intervalMs = 1000, platform, hostname, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const find = async () => pickDevice(await lh.listDevices(), { platform, hostname });
  let d = await find();
  if (d) return { deviceId: d.deviceId, via: 'existing' };
  await lh.startConnectDaemon();
  for (let waited = 0; waited <= waitMs; waited += intervalMs) {
    d = await find();
    if (d) return { deviceId: d.deviceId, via: 'daemon' };
    await sleep(intervalMs);
  }
  throw new Error('Started `lh connect` but this computer did not show up as an online device. Check `lh connect status` / `lh connect logs`.');
}

const bindConfig = (deviceId) => ({ boundDeviceId: deviceId, executionTarget: 'local' });
const unbindConfig = () => ({ boundDeviceId: null });

module.exports = { pickDevice, ensureLocalDevice, bindConfig, unbindConfig, LOCAL_TOOLS };
