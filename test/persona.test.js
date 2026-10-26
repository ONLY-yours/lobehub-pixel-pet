'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSystemRole, buildStateBlock, buildEventPrompt } = require('../src/core/persona');
const st = require('../src/core/pet-state');

test('system role carries name, species personality and a Chinese-by-default rule', () => {
  for (const [id, zh] of [['embit', '焰团'], ['bubbo', '泡鲸'], ['sprig', '叶芽'], ['dafeiyu', '大肥鱼']]) {
    const r = buildSystemRole({ speciesId: id, name: '小测' });
    assert.match(r, /小测/);
    assert.match(r, new RegExp(zh));
    assert.match(r, /简体中文/);
  }
});

test('state block reflects hunger and time without leaking raw numbers', () => {
  const now = new Date('2026-01-05T08:05:00').getTime();
  const p = st.createPet({ speciesId: 'embit', name: 'E', agentId: 'a', now });
  p.hunger = 90;
  const b = buildStateBlock(p, now);
  assert.match(b, /很饿/);
  assert.match(b, /08:05/);
  assert.doesNotMatch(b, /90/);
});

test('event prompts start with the state block and an [事件] marker', () => {
  const now = Date.now();
  const p = st.createPet({ speciesId: 'bubbo', name: 'B', agentId: 'a', now });
  const prompt = buildEventPrompt('hungry', p, now);
  assert.match(prompt, /^\[状态\]/);
  assert.match(prompt, /\n\[事件\] /);
});

test('the persona keeps replies short and heavy work one step at a time, without refusing helpful tasks', () => {
  const r = buildSystemRole({ speciesId: 'embit', name: 'E' });
  assert.match(r, /50 个字以内/);
  assert.match(r, /一件一件来/);
  assert.match(r, /联网搜索/);
  assert.doesNotMatch(r, /你是宠物，不是助手/);
  assert.doesNotMatch(r, /提醒主人去找其他助手/);
});
