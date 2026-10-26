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
