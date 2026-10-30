'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createTrayController } = require('../src/main/tray-controller');

function setup() {
  const app = new EventEmitter();
  app.quit = () => { app.emit('before-quit'); app.quitCalled = true; };
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.isMinimized = () => !!window.minimized;
  window.hide = () => { window.visible = false; };
  window.show = () => { window.visible = true; };
  window.focus = () => { window.focused = true; };
  window.restore = () => { window.minimized = false; };
  const tray = new EventEmitter();
  tray.setToolTip = () => {};
  tray.setContextMenu = (menu) => { tray.menu = menu; };
  createTrayController({ app, window, tray, menu: { buildFromTemplate: (items) => items } });
  return { app, window, tray };
}

test('closing or minimizing hides the window and clicking the tray restores it', () => {
  const { window, tray } = setup();
  let prevented = false;
  window.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(window.visible, false);
  tray.emit('click');
  assert.equal(window.visible, true);
  assert.equal(window.focused, true);
  prevented = false;
  window.emit('minimize', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(window.visible, false);
});

test('explicit quit permits the window to close', () => {
  const { app, window, tray } = setup();
  tray.menu.find((item) => item.label === '退出 Pixel Pet').click();
  assert.equal(app.quitCalled, true);
  let prevented = false;
  window.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test('application activation and tray menu show a hidden window', () => {
  const { app, window, tray } = setup();
  window.minimized = true;
  tray.menu.find((item) => item.label === '显示桌宠').click();
  assert.equal(window.minimized, false);
  assert.equal(window.visible, true);
  window.visible = false;
  app.emit('activate');
  assert.equal(window.visible, true);
});
