'use strict';

const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { LhClient } = require('../core/lh-client');
const { Store } = require('../core/store');
const { PetService } = require('./pet-service');
const { SPECIES, SPECIES_IDS } = require('../core/species');
const { FOODS } = require('../core/pet-state');

const TEST_MODE = process.env.PIXELPET_TEST === '1';
const HEARTBEAT_MS = TEST_MODE ? 2000 : 30 * 1000;
const SIZES = { onboarding: { w: 680, h: 480 }, pet: { w: 230, h: 292 } };

if (process.env.PIXELPET_DATA_DIR) app.setPath('userData', process.env.PIXELPET_DATA_DIR);
if (TEST_MODE) app.commandLine.appendSwitch('no-sandbox');

let win = null;
let service = null;

function place(mode) {
  const { w, h } = SIZES[mode];
  const wa = screen.getPrimaryDisplay().workArea;
  if (mode === 'onboarding') win.setBounds({ x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2), width: w, height: h });
  else win.setBounds({ x: wa.x + wa.width - w - 24, y: wa.y + wa.height - h - 24, width: w, height: h });
}

function logFile() {
  return path.join(app.getPath('userData'), 'pixel-pet.log');
}

function logError(e) {
  const line = `${new Date().toISOString()} [${e.code || 'error'}] ${e.message}${e.stderr ? ` | stderr: ${String(e.stderr).trim().slice(0, 500)}` : ''}\n`;
  console.error('[pixel-pet]', line.trim());
  try { fs.appendFileSync(logFile(), line); } catch { /* logging must never break the pet */ }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: SIZES.onboarding.w,
    height: SIZES.onboarding.h,
    frame: false,
    transparent: !TEST_MODE, // opaque in tests so screenshots have a background
    backgroundColor: TEST_MODE ? '#e9e4f5' : '#00000000',
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function wire() {
  ipcMain.handle('boot', () => {
    const v = service.init();
    place(v ? 'pet' : 'onboarding');
    return { view: v, species: SPECIES_IDS.map((id) => ({ ...SPECIES[id], fallback: undefined })), foods: FOODS, testMode: TEST_MODE };
  });
  ipcMain.handle('whoami', () => service.lh.whoami());
  ipcMain.handle('hatch', async (_e, { speciesId, name }) => {
    try {
      const view = await service.hatch({
        speciesId,
        name,
        onStep: (s) => send('hatch-step', s),
        onLoginPrompt: (p) => {
          send('login-prompt', p);
          // The CLI opens the browser itself; only step in if it could not.
          if (p.browserFailed && p.url && /^https:\/\//.test(p.url)) shell.openExternal(p.url);
        },
      });
      // the window shrinks to pet size when the renderer enters the pet screen (see 'place')
      return { ok: true, view };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('act', (_e, { kind, food }) => service.act(kind, food));
  ipcMain.handle('chat', (_e, { text }) => service.chat(text));
  ipcMain.handle('release', async (_e, opts) => {
    const r = await service.release(opts);
    place('onboarding');
    return r;
  });
  ipcMain.on('move-by', (_e, { dx, dy }) => {
    if (!win) return;
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
  });
  ipcMain.on('place', (_e, mode) => { if (mode in SIZES) place(mode); });
  ipcMain.on('quit', () => app.quit());

  if (TEST_MODE) {
    // Test-only hooks used by the E2E suite to drive time-dependent behaviour.
    ipcMain.handle('debug-set', (_e, patch) => {
      Object.assign(service.pet, patch);
      service._save();
      return service.view();
    });
    ipcMain.handle('debug-heartbeat', async () => {
      await service.heartbeat();
      return service.view();
    });
  }

  service.on('update', (v) => send('update', v));
  service.on('say', (m) => send('say', m));
  service.on('thinking', (b) => send('thinking', b));
  service.on('evolved', (s) => send('evolved', s));
  service.on('error', logError);
  ipcMain.on('open-log', () => { try { fs.appendFileSync(logFile(), ''); shell.showItemInFolder(logFile()); } catch { /* ignore */ } });
}

app.whenReady().then(() => {
  const store = new Store(app.getPath('userData'));
  service = new PetService({ lh: new LhClient(), store });
  wire();
  createWindow();
  if (!TEST_MODE) setInterval(() => service.heartbeat().catch((e) => console.error(e)), HEARTBEAT_MS);
});

app.on('window-all-closed', () => app.quit());
