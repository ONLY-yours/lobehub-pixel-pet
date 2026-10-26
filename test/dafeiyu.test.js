'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SPECIES, SPECIES_IDS } = require('../src/core/species');

const DIR = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'dafeiyu');
const REQUIRED_CLIPS = ['idle', 'happy', 'sad', 'hungry', 'sleep', 'eat_rice', 'eat_cookie', 'eat_fruit', 'think', 'talk', 'play', 'pat', 'hatch', 'evolve'];

test('there are now four starter species and the 大肥鱼 is one of them', () => {
  assert.equal(SPECIES_IDS.length, 4);
  assert.equal(SPECIES.dafeiyu.nameZh, '大肥鱼');
  assert.equal(SPECIES.dafeiyu.art, 'video');
});

test('every status and reaction has a clip, and each clip is a real WebM file', () => {
  for (const key of REQUIRED_CLIPS) {
    const file = SPECIES.dafeiyu.clips[key];
    assert.ok(file, `missing clip mapping: ${key}`);
    const buf = fs.readFileSync(path.join(DIR, file));
    assert.deepEqual([...buf.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3], `${file} is not WebM`);
  }
});

test('pixel species do not carry video fields, so the renderer keeps drawing them on canvas', () => {
  for (const id of ['embit', 'bubbo', 'sprig']) assert.equal(SPECIES[id].art, undefined);
});

test('the required credit and non-commercial terms ship with the assets and the README', () => {
  const notice = fs.readFileSync(path.join(DIR, 'NOTICE.md'), 'utf8');
  assert.match(notice, /github\.com\/PC2005-cloud\/dsh-pet/);
  assert.match(notice, /commercial use is forbidden/i);
  assert.match(notice, /CC BY-NC-SA 4\.0/);
  assert.ok(fs.existsSync(path.join(DIR, 'LICENSE-dsh-pet.txt')));
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.match(readme, /github\.com\/PC2005-cloud\/dsh-pet/);
});
