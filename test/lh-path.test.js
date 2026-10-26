'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findLh, withToolPath, candidateDirs } = require('../src/core/lh-path');

// Fake filesystem: a set of executable files and a map of directory listings.
function fakeIo({ files = [], dirs = {} }) {
  const all = new Set(Object.keys(dirs));
  return {
    exists: (p) => files.includes(p),
    isDir: (p) => all.has(p) || Object.keys(dirs).some((d) => p === d),
    readdir: (p) => dirs[p] || [],
  };
}
const HOME = '/Users/me';

test('finds lh in a Homebrew prefix even though a Finder launch has a bare PATH', () => {
  const io = fakeIo({ files: ['/opt/homebrew/bin/lh'], dirs: { '/opt/homebrew/bin': [], '/usr/bin': [] } });
  const p = findLh({ env: { PATH: '/usr/bin:/bin' }, home: HOME, io, lookup: () => null });
  assert.equal(p, '/opt/homebrew/bin/lh');
});

test('finds lh under the newest nvm node version', () => {
  const root = `${HOME}/.nvm/versions/node`;
  const io = fakeIo({
    files: [`${root}/v22.3.0/bin/lh`],
    dirs: { [root]: ['v20.1.0', 'v22.3.0'], [`${root}/v22.3.0/bin`]: [], [`${root}/v20.1.0/bin`]: [] },
  });
  assert.equal(findLh({ env: { PATH: '' }, home: HOME, io, lookup: () => null }), `${root}/v22.3.0/bin/lh`);
  assert.deepEqual(candidateDirs({ home: HOME, io }).slice(0, 2), [`${root}/v22.3.0/bin`, `${root}/v20.1.0/bin`]);
});

test('falls back to the login shell, and returns null when nothing is found', () => {
  const io = fakeIo({});
  assert.equal(findLh({ env: { PATH: '' }, home: HOME, io, lookup: () => '/somewhere/lh' }), '/somewhere/lh');
  assert.equal(findLh({ env: { PATH: '' }, home: HOME, io, lookup: () => null }), null);
});

test('LH_BIN wins over everything', () => {
  assert.equal(findLh({ env: { LH_BIN: '/custom/lh', PATH: '/usr/bin' }, home: HOME, io: fakeIo({}), lookup: () => null }), '/custom/lh');
});

test("the child PATH starts with lh's own directory so `#!/usr/bin/env node` finds node", () => {
  const io = fakeIo({ dirs: { '/opt/homebrew/bin': [] } });
  const env = withToolPath({ PATH: '/usr/bin:/bin', KEEP: '1' }, '/Users/me/.nvm/versions/node/v22.3.0/bin/lh', { home: HOME, io });
  const parts = env.PATH.split(':');
  assert.equal(parts[0], '/Users/me/.nvm/versions/node/v22.3.0/bin');
  assert.ok(parts.includes('/opt/homebrew/bin'));
  assert.ok(parts.includes('/bin'));
  assert.equal(env.KEEP, '1');
  assert.equal(new Set(parts).size, parts.length, 'no duplicate entries');
});

// ---------------------------------------------------------------- Windows
const { spawnTarget, resolveWindowsEntry } = require('../src/core/lh-path');

const NPM_SHIM = [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '',
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@lobehub\\cli\\dist\\index.js" %*',
].join('\r\n');
const CMD = 'C:\\Users\\me\\AppData\\Roaming\\npm\\lh.cmd';
const ENTRY = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@lobehub\\cli\\dist\\index.js';
const winIo = (files, dirs = []) => ({ exists: (p) => files.includes(p), isDir: (p) => dirs.includes(p), readdir: () => [] });

test('Windows: finds lh.cmd on PATH or in the usual npm folder', () => {
  const io = winIo([CMD], ['C:\\Users\\me\\AppData\\Roaming\\npm']);
  assert.equal(findLh({ platform: 'win32', env: { PATH: 'C:\\Windows\\System32;C:\\Users\\me\\AppData\\Roaming\\npm' }, io }), CMD);
  assert.equal(findLh({ platform: 'win32', env: { PATH: 'C:\\Windows', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, io }), CMD, 'found through APPDATA even when PATH lacks it');
  assert.equal(findLh({ platform: 'win32', env: { PATH: 'C:\\Windows' }, io: winIo([]) }), null);
});

test('Windows: the npm shim is read to find the JS entry that lh really runs', () => {
  assert.equal(resolveWindowsEntry(CMD, { read: () => NPM_SHIM, io: winIo([ENTRY]) }), ENTRY);
  assert.equal(resolveWindowsEntry(CMD, { read: () => 'garbage', io: winIo([ENTRY]) }), null);
  assert.equal(resolveWindowsEntry(CMD, { read: () => { throw new Error('ENOENT'); }, io: winIo([]) }), null);
});

test('Windows: lh.cmd is started as `<Electron as node> <entry> args`, never through a shell', () => {
  const t = spawnTarget(CMD, { platform: 'win32', execPath: 'C:\\Apps\\Pixel Pet\\Pixel Pet.exe', read: () => NPM_SHIM, io: winIo([ENTRY]) });
  assert.deepEqual(t, { command: 'C:\\Apps\\Pixel Pet\\Pixel Pet.exe', prefix: [ENTRY], env: { ELECTRON_RUN_AS_NODE: '1' } });
});

test('Windows: an .exe shim or a non-Windows lh is started directly', () => {
  assert.deepEqual(spawnTarget('C:\\Users\\me\\.bun\\bin\\lh.exe', { platform: 'win32' }), { command: 'C:\\Users\\me\\.bun\\bin\\lh.exe', prefix: [], env: {} });
  assert.deepEqual(spawnTarget('/opt/homebrew/bin/lh', { platform: 'darwin' }), { command: '/opt/homebrew/bin/lh', prefix: [], env: {} });
});

test('Windows: a shim we cannot understand gives a clear error instead of a failing shell call', () => {
  assert.throws(() => spawnTarget(CMD, { platform: 'win32', read: () => 'garbage', io: winIo([]) }), /without a shell.*Reinstall the CLI/);
});
