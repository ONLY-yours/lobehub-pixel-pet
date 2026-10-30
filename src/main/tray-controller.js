'use strict';

function createTrayController({ app, window, tray, menu }) {
  let quitting = false;
  const show = () => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  const hide = () => { if (!window.isDestroyed()) window.hide(); };
  const quit = () => { quitting = true; app.quit(); };
  tray.setToolTip('Pixel Pet');
  tray.setContextMenu(menu.buildFromTemplate([
    { label: '显示桌宠', click: show },
    { label: '隐藏桌宠', click: hide },
    { type: 'separator' },
    { label: '退出 Pixel Pet', click: quit },
  ]));
  tray.on('click', show);
  tray.on('double-click', show);
  window.on('close', (event) => { if (!quitting) { event.preventDefault(); hide(); } });
  window.on('minimize', (event) => { event.preventDefault(); hide(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('activate', show);
  return { show, hide, quit };
}

module.exports = { createTrayController };
