'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, p) => cb(p);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('pet', {
  boot: () => ipcRenderer.invoke('boot'),
  whoami: () => ipcRenderer.invoke('whoami'),
  hatch: (speciesId, name) => ipcRenderer.invoke('hatch', { speciesId, name }),
  act: (kind, food) => ipcRenderer.invoke('act', { kind, food }),
  chat: (text) => ipcRenderer.invoke('chat', { text }),
  release: (opts) => ipcRenderer.invoke('release', opts),
  moveBy: (dx, dy) => ipcRenderer.send('move-by', { dx, dy }),
  quit: () => ipcRenderer.send('quit'),
  openLog: () => ipcRenderer.send('open-log'),
  debugSet: (patch) => ipcRenderer.invoke('debug-set', patch),
  debugHeartbeat: () => ipcRenderer.invoke('debug-heartbeat'),
  onUpdate: on('update'),
  onSay: on('say'),
  onThinking: on('thinking'),
  onEvolved: on('evolved'),
  onHatchStep: on('hatch-step'),
  onLoginPrompt: on('login-prompt'),
});
