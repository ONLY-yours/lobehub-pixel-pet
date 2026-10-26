'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/renderer/sprites');

test('all species/stage/status frames are well-formed', () => {
  assert.deepEqual(S.validate(), []);
});

test('the three species look different from each other', () => {
  const sig = (id) => S.frame({ speciesId: id, stage: 'child', status: 'idle', t: 0 }).grid.map((r) => r.join('')).join('');
  assert.notEqual(sig('embit'), sig('bubbo'));
  assert.notEqual(sig('bubbo'), sig('sprig'));
  assert.notEqual(sig('embit'), sig('sprig'));
});

test('evolution visibly changes the sprite', () => {
  const sig = (stage) => S.frame({ speciesId: 'embit', stage, status: 'idle', t: 0 }).grid.map((r) => r.join('')).join('');
  assert.notEqual(sig('baby'), sig('child'));
  assert.notEqual(sig('child'), sig('adult'));
});

test('egg cracks progressively', () => {
  const sig = (n) => S.egg(n).map((r) => r.join('')).join('');
  assert.notEqual(sig(0), sig(1));
  assert.notEqual(sig(1), sig(3));
});
