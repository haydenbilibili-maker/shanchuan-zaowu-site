/**
 * 文案一致性守卫：禁用词扫描
 *
 * 口径（产品负责人 2026-09-19）：**统一用「受礼人」**，禁用「收礼人」。
 * 术语表按需扩充（礼笺 / 藏品 / 标本师 / 孤品 / 装裱 / 博物级 为**正确**用词，不在此列）。
 *
 * 为什么需要它：这类旧词残留靠人眼扫不出来（全仓 wxml/js 上万行），而它直接影响
 * 「全站文案一致性」这一版目标；首次执行即命中 8 处 ✗。
 *
 * 用法：
 *   node miniprogram/scripts/check-copy-terms.mjs
 *   node miniprogram/scripts/check-copy-terms.mjs --selftest
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const MP = resolve(ROOT, 'miniprogram')
const SKIP = new Set(['node_modules', '.git', 'miniprogram_npm', 'dist'])

/** 禁用词 → 正确用词（可扩充） */
const BANNED = [
  { bad: '收礼人', good: '受礼人', why: '全站统一用「受礼人」（2026-09-19 产品口径）' },
  { bad: '我知道了', good: '知道了', why: '纯告知型弹窗的确认键全站统一为「知道了」（2026-09-21 分子级审计：9 处「知道了」vs 1 处「我知道了」）' },
  { bad: "confirmText: '好的'", good: "confirmText: '知道了'", why: '同上；「好的」还会撞「做好的」等词，故连上下文一起钉（2026-09-21）' },
  // 2026-10-14：**旧品牌口号**。ERP 已确认的品牌记录（2026-05-14）是中文「山海造物」、
  // 口号「把山海带回家」、英文标语 Bring Nature Home；而「山川」是**改名前**的旧名。
  // 复核时发现云端分享海报的默认副标题还印着旧口号（顾客可见），而 app 内标签页与另一张
  // 分享卡都已是新口号 —— 同一张海报两个来源印不同口号。修掉后加这条钉住，防止再回来。
  // ⚠️ 门店**实体名**「山川造物」不在此列：它是 `store_shanhaizaowu` 的 name / aliases
  //    （账本与门店记录都按它归一），属于历史数据，**改了会对不上账**。
  { bad: '把山川带回家', good: '把山海带回家', why: '旧品牌口号（改名前的「山川」版）。品牌口号只有「把山海带回家」一个口径（2026-05-14 品牌记录）' }
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(wxml|js|wxss|json)$/.test(name)) out.push(p)
  }
  return out
}

function scan() {
  const hits = []
  for (const abs of walk(MP)) {
    const rel = relative(ROOT, abs)
    // 守卫自身与本脚本内会提到禁用词（作为判据），跳过以免自伤
    if (rel.includes('scripts/')) continue
    const lines = readFileSync(abs, 'utf8').split('\n')
    lines.forEach((l, i) => {
      for (const b of BANNED) {
        if (l.includes(b.bad)) hits.push(`${rel}:${i + 1} 命中「${b.bad}」→ 应改用「${b.good}」（${b.why}）`)
      }
    })
  }
  return hits
}

/**
 * 第二类判据（2026-09-21 分子级审计新增）：**字数上限必须只有一个口径**。
 *
 * 同一个 `<input>` / `<textarea>` 上的 `maxlength="N"` 是**硬上限**（用户实际能输入多少），
 * 而 placeholder 里写的「最多 N 字 / N 字以内 / 不超过 N 字 / 限 N 字」是**对用户的承诺**。
 * 两者不一致 = 界面在骗人。2026-09-21 的 P0-2（礼笺 UI 说 140 字、服务端仍收 200 字）
 * 就是同族缺陷 —— 本判据把「界面自己前后不一致」这一半**离线**钉死。
 *
 * 只认「上限」语义：`至少 N 字` 是**下限**，与 maxlength 无关，**不**计入（否则会误报
 * `maxlength="500" placeholder="…（至少 5 字）"` 这类合法写法）。
 */
const MAX_LEN_RE = /(?:最多|不超过|限)\s*(\d+)\s*字|(\d+)\s*字\s*(?:以内|内)/g

function scanMaxLenCopy() {
  const hits = []
  for (const abs of walk(MP)) {
    if (!abs.endsWith('.wxml')) continue
    const rel = relative(ROOT, abs)
    const src = readFileSync(abs, 'utf8')
    const tagRe = /<(?:textarea|input)\b[^>]*>/g
    let m
    while ((m = tagRe.exec(src))) {
      const tag = m[0]
      const ml = /maxlength="(\d+)"/.exec(tag)
      if (!ml) continue
      const max = Number(ml[1])
      const ph = /placeholder="([^"]*)"/.exec(tag)
      if (!ph) continue
      const claimed = []
      let x
      MAX_LEN_RE.lastIndex = 0
      while ((x = MAX_LEN_RE.exec(ph[1]))) claimed.push(Number(x[1] || x[2]))
      if (claimed.some((v) => v !== max)) {
        const line = src.slice(0, m.index).split('\n').length
        hits.push(`${rel}:${line} maxlength=${max} 与 placeholder 里的上限「${claimed.join(' / ')} 字」不一致 → ${ph[1]}`)
      }
    }
  }
  return hits
}

if (process.argv.includes('--selftest')) {
  const SELF = fileURLToPath(import.meta.url)
  const run = () => spawnSync(process.execPath, [SELF], { encoding: 'utf8' })
  const restore = (target, orig, label) => {
    writeFileSync(target, orig)
    if (readFileSync(target, 'utf8') !== orig) {
      console.log(`✗ 未能逐字还原（${label}）`)
      process.exit(1)
    }
  }

  // 注入 A：禁用词 —— **逐条**遍历 BANNED 表，而不是只测某一个词。
  // 为什么改成遍历：原来只注入「我知道了」一条，于是**新加的禁用词没人证明它会红**
  // （2026-10-14 加「把山川带回家」时发现的：表里加一条，自检照样绿，等于这条判据没被证明过）。
  // 遍历之后，以后谁往表里加词都自动被证明。
  const wordTarget = join(MP, 'app.json')
  const wordOrig = readFileSync(wordTarget, 'utf8')
  const proven = []
  for (const b of BANNED) {
    // 用 JSON 转义写进字符串值，任何字面量都能安全注入
    writeFileSync(wordTarget, wordOrig.replace('{', `{\n  "_copyTermProbe": ${JSON.stringify(b.bad)},`))
    const a = run()
    if (a.status === 0) {
      restore(wordTarget, wordOrig, '禁用词注入')
      console.log(`✗ 注入未被检出：禁用词「${b.bad}」的判据失效（表里有词但扫不出来）`)
      process.exit(1)
    }
    proven.push(b.bad)
  }
  restore(wordTarget, wordOrig, '禁用词注入')

  // 注入 B：字数上限口径不一致（maxlength=500 vs placeholder「最多 40 字」）
  const lenTarget = join(MP, 'pages/index/index.wxml')
  const lenOrig = readFileSync(lenTarget, 'utf8')
  writeFileSync(lenTarget, lenOrig + '\n<textarea maxlength="500" placeholder="最多 40 字"></textarea>\n')
  const b = run()
  restore(lenTarget, lenOrig, '字数上限注入')
  if (b.status === 0) {
    console.log('✗ 注入未被检出：字数上限口径扫描失效')
    process.exit(1)
  }

  console.log(`✓ 自检通过：禁用词表 ${proven.length} 条**逐条**注入均被检出（${proven.join(' / ')}）`
    + '、字数上限口径（maxlength=500 / 最多 40 字）被检出、源文件逐字还原')
} else {
  const hits = [...scan(), ...scanMaxLenCopy()]
  if (hits.length) {
    console.log('✗ 文案一致性未通过：')
    for (const h of hits) console.log('  - ' + h)
    console.log(`✗ ${hits.length} 处不一致`)
    process.exit(1)
  }
  console.log(`✓ 文案一致性通过（禁用词 ${BANNED.length} 条 + 字数上限口径，零命中）`)
}
