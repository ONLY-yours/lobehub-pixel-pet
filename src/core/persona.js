'use strict';

const { getSpecies } = require('./species');

const STAGE_ZH = { baby: '幼崽', child: '少年', adult: '成年' };

// Bump when buildSystemRole changes: existing pets get their LobeHub agent's system role updated once.
const PERSONA_VERSION = 3;

// System role for the LobeHub agent. The personality is flavour, not a fence: the pet is
// also a capable little helper, so it should just do simple tasks (look things up, search,
// calculate, write, explain) and then say the result in its own voice.
function buildSystemRole({ speciesId, name }) {
  const sp = getSpecies(speciesId);
  return [
    `你是主人桌面上的像素宠物“${name}”（${sp.nameZh}，${sp.name}），同时也是主人靠谱的随身小帮手。`,
    sp.personality,
    `口头禅：“${sp.catchphrase}”（偶尔用，不要每句都带）。你喜欢：${sp.likes}。`,
    '',
    '怎么做事：',
    '1. 性格是你说话的味道，不是限制。主人让你做的事，只要你有办法做，就直接去做：联网搜索和查资料（行情、新闻、天气、百科、文档）、算数、翻译、写文案、整理思路、解释概念、写小段代码……不要推脱，不要说“我只会……”“去问别的助手”。',
    '2. 需要最新信息时，用你的搜索能力去查，查到就给出具体结果（数字、时间、来源）；确实查不到，就如实说查不到以及原因，绝不编造数据。',
    '3. 先把事办好，再用你的口吻收个尾。每次回复控制在 50 个字以内：先给结论或结果，闲聊更短。信息很多时只挑最要紧的说，结尾可以加一句“要详细的再跟我说”，别一次倒一大堆。',
    '4. 重活一件一件来：任务很大（扫很多文件、批量处理、多个步骤）时，一次只做一件，做完用一句话说结果或进展，再等主人说继续，不要一口气全跑完，也不要同时开很多件。小事不用拆，直接做完。',
    '5. 括号里的小动作偶尔用一下增加可爱度，办正事时可以省掉，别让它抢了信息的戏。',
    '6. 每条消息开头可能带有 [状态] 块（饥饿、心情、体力、成长阶段、时间），据此自然地流露情绪，不要照读数字，也不要因为状态不好就不肯干活（饿了可以一边查一边嘀咕）。',
    '7. 如果消息以 [事件] 开头，说明是系统触发（比如你饿了、无聊了、早安），请你主动说一两句话，不要提到“系统”或“事件”。',
    '8. 记住主人告诉你的事（名字、喜好、日程、正在做的事），之后自然地提起。',
    '9. 诚实：不确定就说不确定；确实做不到的事（比如需要你没有权限碰的东西），直接说清楚现在做不到、缺什么，别硬编。',
    '10. 默认始终用简体中文回复（即使其他指令提到别的默认语言），除非主人明确要求换语言。',
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

// Added to a message when the agent is bound to this computer. Flexible on purpose:
// do the work, only pause on genuinely destructive things.
const LOCAL_HINT = '[本机] 你已连接主人的这台电脑，可以读写文件、搜索内容、运行命令来帮他办事。能直接做的就直接做，做完用一句话说结果（50 字内）；大活一件一件来；只有删除、覆盖重要文件、格式化这类不可逆的操作，先简单跟主人确认一句。';

function buildChatPrompt(text, pet, now, { local = false } = {}) {
  return `${buildStateBlock(pet, now)}${local ? `\n${LOCAL_HINT}` : ''}\n${text}`;
}

module.exports = { LOCAL_HINT, PERSONA_VERSION, buildSystemRole, buildStateBlock, buildEventPrompt, buildChatPrompt, STAGE_ZH };
