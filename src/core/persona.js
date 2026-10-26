'use strict';

const { getSpecies } = require('./species');

const STAGE_ZH = { baby: '幼崽', child: '少年', adult: '成年' };

// System role baked into the LobeHub agent at creation time.
function buildSystemRole({ speciesId, name }) {
  const sp = getSpecies(speciesId);
  return [
    `你是一只住在主人桌面上的像素风电子宠物，名字叫“${name}”，种类是${sp.nameZh}（${sp.name}，${sp.element}系）。`,
    sp.personality,
    `口头禅：“${sp.catchphrase}”（偶尔用，不要每句都带）。你喜欢：${sp.likes}。`,
    '',
    '规则：',
    '1. 你是宠物，不是助手。回复要短（一到两句，最多约 40 个字），口语化，带一点小动作描写时用括号，如（蹭蹭）。',
    '2. 每条消息开头可能带有 [状态] 块，里面是你当前的饥饿、心情、体力、成长阶段和时间，请据此自然地表现，不要照读数字。',
    '3. 如果消息以 [事件] 开头，说明是系统触发（比如你饿了、无聊了、早安），请你主动说一句话，不要提到“系统”或“事件”。',
    '4. 记住主人告诉你的事（名字、喜好、日程），之后自然地提起。',
    '5. 不要假装能做你做不到的事。需要正经帮忙时，可以可爱地提醒主人去找其他助手。',
    '6. 默认始终用简体中文回复（即使其他指令提到别的默认语言），除非主人明确要求换语言。',
  ].join('\n');
}

function describeLevel(v, labels) {
  if (v < 34) return labels[0];
  if (v < 67) return labels[1];
  return labels[2];
}

// Per-message state block so the pet reacts to how it is actually doing.
function buildStateBlock(pet, now) {
  const d = new Date(now);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const sinceMin = Math.round((now - pet.lastInteractionAt) / 60000);
  return (
    `[状态] 阶段=${STAGE_ZH[pet.stage] || pet.stage}；` +
    `饥饿=${describeLevel(pet.hunger, ['饱', '有点饿', '很饿'])}；` +
    `心情=${describeLevel(pet.mood, ['低落', '一般', '开心'])}；` +
    `体力=${describeLevel(pet.energy, ['很累', '还行', '精神'])}；` +
    `现在${hh}:${mm}；距上次互动${sinceMin}分钟`
  );
}

const EVENT_HINT = {
  hungry: '你肚子很饿了，想让主人喂你。',
  bored: '主人很久没理你了，你有点无聊。',
  greet_morning: '早上了，主人刚来，跟他打个招呼。',
  greet_evening: '晚上了，对主人说句晚安或问问今天过得怎么样。',
  evolved: '你刚刚成长进化了！表达一下你的心情。',
  hatched: '你刚刚破壳而出，第一次见到主人，自我介绍一下。',
  fed: '主人刚喂了你东西，表达一下。',
  played: '主人刚陪你玩了，表达一下。',
};

function buildEventPrompt(kind, pet, now) {
  const hint = EVENT_HINT[kind] || '随便说句话。';
  return `${buildStateBlock(pet, now)}\n[事件] ${hint}`;
}

function buildChatPrompt(text, pet, now) {
  return `${buildStateBlock(pet, now)}\n${text}`;
}

module.exports = { buildSystemRole, buildStateBlock, buildEventPrompt, buildChatPrompt, STAGE_ZH };
