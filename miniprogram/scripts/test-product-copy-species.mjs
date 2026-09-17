/**
 * 物种名书写口径「中文名 + 拉丁学名」行为断言（assistProductCopy）
 *
 * 业务反馈（2026-09-17）：ERP「图文详情 AI 一键补齐」生成的描述里物种名只有拉丁文，
 *   例：「小蓝闪蝶植物标本框以 Morpho peleides 翅片为主材……」→ 顾客读不懂，
 *   也与站点其余文案的写法不一致。
 *
 * 这条口径有**两道防线**，任一道静默失效都会让现象复发：
 *   1. 提示词里写明口径，并要求模型给出 speciesZh（中文物种名）；
 *   2. 模型没照做时，用 ensureSpeciesPairInText() 做确定性兜底改写。
 * 所以这里既测纯逻辑（真源码），也测接线（index.js 是否真的用了它）。
 *
 * 用法：
 *   node miniprogram/scripts/test-product-copy-species.mjs
 *   node miniprogram/scripts/test-product-copy-species.mjs --selftest
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const LABEL = 'miniprogram/cloudfunctions/assistProductCopy/speciesLabel.js'
const FN = 'miniprogram/cloudfunctions/assistProductCopy/index.js'

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

/** 仓根是 "type":"module"，云函数源码是 CJS → 自己喂 module/exports 执行真源码 */
function loadCjs(file) {
  const src = readFileSync(resolve(ROOT, file), 'utf8')
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', src)(module, module.exports)
  return module.exports
}
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const label = loadCjs(LABEL)
const fnSrc = stripComments(readFileSync(resolve(ROOT, FN), 'utf8'))

/* ── 1) 提示词口径 ───────────────────────────────────────────────────────── */
const RULE = String(label.SPECIES_PAIR_RULE || '')
check('口径文本存在', RULE.length > 20)
check('★ 口径要求「中文名 + 拉丁学名」', /中文名\s*\+\s*拉丁学名/.test(RULE))
check('★ 口径明确禁止只写拉丁文', /禁止只写拉丁文/.test(RULE))
check('口径给了示例写法', /蓝闪蝶/.test(RULE) && /Morpho peleides/.test(RULE))

/* ── 2) 后处理兜底（真源码）──────────────────────────────────────────────── */
const pair = label.ensureSpeciesPairInText
check('ensureSpeciesPairInText 可调用', typeof pair === 'function')

const REPORTED =
  '小蓝闪蝶植物标本框以 Morpho peleides 翅片为主材，经脱脂、展翅、定型后与干燥植物枫叶组合装帧于玻璃相框内。'

const PAIRED_EXPECT =
  '小蓝闪蝶植物标本框以蓝闪蝶 Morpho peleides 翅片为主材，经脱脂、展翅、定型后与干燥植物枫叶组合装帧于玻璃相框内。'
eq('★ 报告里的那条：只在拉丁名前补中文名，其余一字不动', pair(REPORTED, '蓝闪蝶', 'Morpho peleides'), PAIRED_EXPECT)
eq('★ 拉丁名前原本的空格被吃掉（不会出现「以 蓝闪蝶」）',
  pair('以 Morpho peleides 翅片为主材', '蓝闪蝶', 'Morpho peleides'),
  '以蓝闪蝶 Morpho peleides 翅片为主材')
eq('拉丁字母结尾的词与中文名之间保留一个空格',
  pair('specimen Morpho peleides', '蓝闪蝶', 'Morpho peleides'),
  'specimen 蓝闪蝶 Morpho peleides')

eq('已经写成「中文名 拉丁名」→ 原样不动',
  pair('以蓝闪蝶 Morpho peleides 翅片为主材', '蓝闪蝶', 'Morpho peleides'),
  '以蓝闪蝶 Morpho peleides 翅片为主材')
eq('已经写成「中文名（拉丁名）」→ 原样不动',
  pair('以蓝闪蝶（Morpho peleides）翅片为主材', '蓝闪蝶', 'Morpho peleides'),
  '以蓝闪蝶（Morpho peleides）翅片为主材')
eq('★ 只写中文、没有拉丁 → 补括注',
  pair('小蓝闪蝶标本', '蓝闪蝶', 'Morpho peleides'),
  '小蓝闪蝶（Morpho peleides）标本')
eq('中文名后已有括注 → 不重复补',
  pair('小蓝闪蝶（Morpho peleides）标本', '蓝闪蝶', 'Morpho peleides'),
  '小蓝闪蝶（Morpho peleides）标本')
eq('★ 多处拉丁名只处理第一处',
  pair('Morpho peleides 与 Morpho peleides', '蓝闪蝶', 'Morpho peleides'),
  '蓝闪蝶 Morpho peleides 与 Morpho peleides')
eq('拉丁名大小写不同也能识别并配对',
  pair('以 morpho PELEIDES 翅片为主材', '蓝闪蝶', 'Morpho peleides'),
  '以蓝闪蝶 morpho PELEIDES 翅片为主材')
eq('衍生品（无中文名 / 无拉丁名）→ 原样返回',
  pair('文创礼盒，含亚克力摆件一枚', '', ''), '文创礼盒，含亚克力摆件一枚')
eq('缺中文名 → 原样返回（不乱猜）',
  pair('以 Morpho peleides 为主材', '', 'Morpho peleides'), '以 Morpho peleides 为主材')
eq('缺拉丁名 → 原样返回',
  pair('小蓝闪蝶标本', '蓝闪蝶', ''), '小蓝闪蝶标本')
eq('中文名未出现且无拉丁名 → 原样返回',
  pair('一段普通描述', '蓝闪蝶', ''), '一段普通描述')
eq('空文本安全', pair('', '蓝闪蝶', 'Morpho peleides'), '')

/* ── 3) 接线：index.js 真的用上了吗 ──────────────────────────────────────── */
check('★ 提示词内插口径文本（不是只写在注释里）', /\$\{SPECIES_PAIR_RULE\}/.test(fnSrc))
check('★ 要求模型给出 speciesZh', /speciesZh/.test(fnSrc))
check('★ 返回体带 speciesZh', /speciesZh,\s*\n\s*description,/.test(fnSrc))
check('★ description 经过后处理兜底', /const description = ensureSpeciesPairInText\(/.test(fnSrc))
check('口径模块被 require 进来', /require\('\.\/speciesLabel'\)/.test(fnSrc))

/* ── 输出 / 自检 ─────────────────────────────────────────────────────────── */
if (process.argv.includes('--selftest')) {
  selftest()
} else if (failed) {
  console.log('✗ 物种名口径检查失败：')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`✗ ${failed} 项失败 / ${passed} 项通过`)
  process.exit(1)
} else {
  console.log(`✓ 物种名口径：${passed} 项通过（提示词要求中文+拉丁 / 拉丁-only 会被兜底改写 / index.js 真接线）`)
}

function selftest() {
  const injections = [
    {
      name: '口径文本淡化（不再禁止只写拉丁文）',
      file: LABEL,
      from: '禁止只写拉丁文、也禁止只写中文；',
      to: ''
    },
    {
      name: '已配对判定失效（会重复补中文名）',
      file: LABEL,
      from: '  return before.endsWith(zh);',
      to: '  return false;'
    },
    {
      name: '只写中文时的括注兜底被摘掉',
      file: LABEL,
      from: '  return `${raw.slice(0, insertAt)}（${latin}）${raw.slice(insertAt)}`;',
      to: '  return raw;'
    },
    {
      name: 'index.js 不再对 description 做后处理',
      file: FN,
      from: '    const description = ensureSpeciesPairInText(',
      to: '    const description = (('
    },
    {
      name: '提示词里不再内插口径文本',
      file: FN,
      from: '${SPECIES_PAIR_RULE}',
      to: '物种名写清楚一点'
    }
  ]
  let bad = 0
  for (const inj of injections) {
    const abs = resolve(ROOT, inj.file)
    const orig = readFileSync(abs, 'utf8')
    const hits = orig.split(inj.from).length - 1
    if (hits !== 1) {
      console.log(`✗ 锚点不唯一（命中 ${hits} 次）：${inj.name}`)
      bad += 1
      continue
    }
    writeFileSync(abs, orig.replace(inj.from, inj.to))
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
    writeFileSync(abs, orig)
    if (readFileSync(abs, 'utf8') !== orig) {
      console.log(`✗ 未能逐字还原：${inj.file}`)
      bad += 1
      continue
    }
    if (r.status === 0) {
      console.log(`✗ 注入回归未被检出：${inj.name}`)
      bad += 1
    } else {
      console.log(`  ✓ 已检出：${inj.name}`)
    }
  }
  if (bad) {
    console.log(`✗ 自检失败：${bad} 项`)
    process.exit(1)
  }
  console.log(`✓ 自检通过：${injections.length} 条注入全部被检出、源文件逐字还原`)
}
