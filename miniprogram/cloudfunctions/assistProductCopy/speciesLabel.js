/**
 * 物种名书写口径：**中文名 + 拉丁学名**（2026-09-17）
 *
 * 背景（业务反馈）：ERP「图文详情 AI 一键补齐」生成的描述里，物种名只有拉丁文，例如
 *   「小蓝闪蝶植物标本框以 Morpho peleides 翅片为主材……」→ 顾客读不懂，且与站点其余文案
 *   的「中文名 + 拉丁名」写法不一致。
 *
 * 两条防线（同一份规则文本，避免提示词与后处理各写一套）：
 *   1. 提示词里写明口径（SPECIES_PAIR_RULE）并要求模型额外给出 speciesZh（中文物种名）；
 *   2. 模型没照做时，用 ensureSpeciesPairInText() 做一次确定性兜底改写。
 */

/** 提示词片段：直接拼进 buildPrompt 的硬性规则里 */
const SPECIES_PAIR_RULE =
  '物种名一律写成「中文名 + 拉丁学名」：首次出现给全（如「蓝闪蝶 Morpho peleides」或「蓝闪蝶（Morpho peleides）」），' +
  '禁止只写拉丁文、也禁止只写中文；后文再次提到可以只写中文名。';

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 拉丁名在文本里出现的位置（大小写不敏感；找不到返回 -1） */
function indexOfLatin(text, latinName) {
  const latin = String(latinName || '').trim();
  if (!latin) return -1;
  const re = new RegExp(escapeRegExp(latin), 'i');
  const m = re.exec(String(text || ''));
  return m ? m.index : -1;
}

/** 该位置之前是否已经紧邻中文名（允许中间只隔空格与开括号） */
function isPairedBefore(text, index, speciesZh) {
  const zh = String(speciesZh || '').trim();
  if (!zh) return false;
  const before = String(text || '')
    .slice(0, index)
    .replace(/[\s（(【[]+$/, '');
  return before.endsWith(zh);
}

/**
 * 确定性兜底：让描述里的物种名满足「中文名 + 拉丁学名」。
 *
 * 规则（宁可少改，不可改错）：
 *   · speciesZh 或 latinName 为空 → 原样返回（衍生品/文创类本来就没有物种名）；
 *   · 描述里已有拉丁名：只处理**第一处**，若前面不是紧邻中文名 → 补上「中文名 」；
 *   · 描述里完全没有拉丁名：在中文名首次出现处补「（拉丁名）」；
 *   · 其余情况一律不动。
 */
function ensureSpeciesPairInText(text, speciesZh, latinName) {
  const raw = String(text || '');
  const zh = String(speciesZh || '').trim();
  const latin = String(latinName || '').trim();
  if (!raw || !zh || !latin) return raw;

  const latinIndex = indexOfLatin(raw, latin);
  if (latinIndex >= 0) {
    if (isPairedBefore(raw, latinIndex, zh)) return raw;
    // 吃掉拉丁名前原有的空白，再按「中文/西文交界」决定是否补一个空格 ——
    // 否则「以 Morpho peleides」会变成「以 蓝闪蝶 Morpho peleides」（多一个空格）
    const head = raw.slice(0, latinIndex).replace(/\s+$/, '');
    const sep = !head || /[\u4e00-\u9fff]$/.test(head) ? '' : ' ';
    return `${head}${sep}${zh} ${raw.slice(latinIndex)}`;
  }

  // 没有拉丁名：在中文名首次出现处补一个括注
  const zhIndex = raw.indexOf(zh);
  if (zhIndex < 0) return raw;
  const insertAt = zhIndex + zh.length;
  // 后面已经紧跟括注就不再重复
  if (/^[\s]*[（(]/.test(raw.slice(insertAt))) return raw;
  return `${raw.slice(0, insertAt)}（${latin}）${raw.slice(insertAt)}`;
}

module.exports = {
  SPECIES_PAIR_RULE,
  ensureSpeciesPairInText
};
