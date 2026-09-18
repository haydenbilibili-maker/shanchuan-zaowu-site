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
  { bad: '收礼人', good: '受礼人', why: '全站统一用「受礼人」（2026-09-19 产品口径）' }
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

if (process.argv.includes('--selftest')) {
  const target = join(MP, 'app.json')
  const orig = readFileSync(target, 'utf8')
  const injected = orig.replace('{', '{\n  "_copyTermProbe": "收礼人",')
  writeFileSync(target, injected)
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  writeFileSync(target, orig)
  if (readFileSync(target, 'utf8') !== orig) { console.log('✗ 未能逐字还原'); process.exit(1) }
  if (r.status === 0) { console.log('✗ 注入未被检出：禁用词扫描失效'); process.exit(1) }
  console.log('✓ 自检通过：注入「收礼人」被检出、源文件逐字还原')
} else {
  const hits = scan()
  if (hits.length) {
    console.log('✗ 文案一致性未通过：')
    for (const h of hits) console.log('  - ' + h)
    console.log(`✗ ${hits.length} 处禁用词`)
    process.exit(1)
  }
  console.log(`✓ 文案一致性通过（禁用词 ${BANNED.length} 条，零命中）`)
}
