'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pointInBounds } = require('../src/core/pointer');

const win = { x: 1000, y: 500, width: 230, height: 300 };

test('a cursor inside the window rectangle counts as over the pet, edges included on the top-left only', () => {
  assert.equal(pointInBounds({ x: 1100, y: 600 }, win), true);
  assert.equal(pointInBounds({ x: 1000, y: 500 }, win), true);
  assert.equal(pointInBounds({ x: 1230, y: 600 }, win), false); // right edge is outside
  assert.equal(pointInBounds({ x: 1100, y: 800 }, win), false); // bottom edge is outside
});

test('a cursor elsewhere (for example on an IME candidate window) is outside', () => {
  assert.equal(pointInBounds({ x: 10, y: 10 }, win), false);
  assert.equal(pointInBounds({ x: 1100, y: 499 }, win), false);
  assert.equal(pointInBounds({ x: 999, y: 600 }, win), false);
});

test('works with negative coordinates (a monitor to the left of the primary one)', () => {
  const left = { x: -400, y: 100, width: 230, height: 300 };
  assert.equal(pointInBounds({ x: -300, y: 200 }, left), true);
  assert.equal(pointInBounds({ x: 0, y: 200 }, left), false);
});
