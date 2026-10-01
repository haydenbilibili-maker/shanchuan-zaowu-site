#!/usr/bin/env node
/**
 * 零余量多列网格守卫（cross 域；2026-09-29 真机「供应商管理 → 大盘」指标卡只占左半宽、单列竖排）
 *
 * 根因：`width: calc(50% - 8rpx)` + 父级 `gap: 16rpx`（或负边距）让一行的格宽 + 间距**恰好 = 100%**。
 * 真机把 rpx 换成 px 有精度误差，只要多出一丝，flex-wrap 就把第二格挤到下一行 → 每行一格、右半边空白。
 * **离线预览 1rpx = 1px 精确，永远复现不了**（错题本「离线预览复现不了 rpx 精度误差」）。
 *
 * 判据：全小程序 wxss 里，`width` / `flex` / `flex-basis` 写成 `calc(P% - N rpx|px)`（P < 100）的声明
 * 一律要进白名单（逐条人工核过余量）；新增 = 红。白名单条目在源码里消失或值被改 = 红（重新核）。
 * 安全替代：百分比宽度 + `justify-content: space-between`（2 列 48.5%、3 列 32%），行距用 margin；
 * 或保留 gap 但百分比留足余量（行数不定、需左对齐时）。
 *
 * 用法：node miniprogram/scripts/check-rpx-zero-slack.mjs [--selftest]
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')

/**
 * 白名单：key = `相对路径 | 选择器 | 属性: 值`，value = 余量核算（为什么不会折行）。
 * 核算口径：k 格 × (P% − N) + (k−1) × gap，余量 = k·N − (k−1)·gap − (100 − k·P)%·容器；≥ 4rpx 或带 flex-grow 才算安全。
 */
const ALLOW = {
  'subpackages/manager/manager/index.wxss | .link-btn | flex: 1 1 calc(50% - 20rpx)':
    'gap 20rpx：2×20 − 20 = 余 20rpx，且 flex-grow 填满',
  'subpackages/extra/staff/scene.wxss | .link-btn | flex: 1 1 calc(50% - 16rpx)':
    'gap var(--space-3)=24rpx：2×16 − 24 = 余 8rpx，且 flex-grow 填满',
  'subpackages/extra/investor/index.wxss | .mini-grid.three .mini-cell | flex: 1 1 calc(33.33% - 8rpx)':
    'gap 8rpx：3×8 − 2×8 = 余 8rpx，且 flex-grow 填满',
  'subpackages/extra/investor/index.wxss | .mini-cell | flex: 1 1 calc(50% - 8rpx)':
    '.mini-grid gap 8rpx：2×8 − 8 = 余 8rpx，且 flex-grow 填满',
  'subpackages/extra/honorary-curators/index.wxss | .ov-card | width: calc(33.33% - 12rpx)':
    'gap var(--space-2)=16rpx：3×12 − 2×16 = 余 4rpx',
  'subpackages/extra/honorary-curators/index.wxss | .ov-card.wide | width: calc(66.66% - 8rpx)':
    '与一张 .ov-card 同行：8 + 12 − 16 = 余 4rpx',
  'subpackages/extra/approvals/index.wxss | .ov-card | width: calc(33.33% - 12rpx)':
    'gap 16rpx：余 4rpx',
  'subpackages/extra/member-crm/index.wxss | .stat-cell | width: calc(33.33% - 12rpx)':
    'gap 16rpx：余 4rpx',
  'subpackages/extra/member-crm/index.wxss | .ov-card | width: calc(33.33% - 12rpx)':
    'gap 16rpx：余 4rpx',
  'subpackages/extra/member-crm/index.wxss | .ov-card.wide | width: calc(66.66% - 8rpx)':
    '与一张 .ov-card 同行：余 4rpx',
  'subpackages/manager/invoice-requests/index.wxss | .ov-card | width: calc(33.33% - 12rpx)':
    'gap 16rpx：余 4rpx'
}

const LAYOUT_PROPS = /^(width|flex|flex-basis)$/
const CALC_PCT = /calc\(\s*(\d+(?:\.\d+)?)%\s*-\s*\d+(?:\.\d+)?(?:rpx|px)\s*\)/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'miniprogram_npm' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.wxss')) out.push(p)
  }
  return out
}

/** 扫一棵目录，返回所有「百分比减定长」布局声明 */
export function scan(root) {
  const hits = []
  for (const file of walk(root)) {
    const rel = relative(root, file).split('\\').join('/')
    if (rel.startsWith('scripts/')) continue
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const re = /([^{}]+)\{([^{}]*)\}/g
    let m
    while ((m = re.exec(css))) {
      const selectors = m[1].trim().replace(/\s+/g, ' ')
      if (selectors.startsWith('@')) continue
      for (const decl of m[2].split(';')) {
        const i = decl.indexOf(':')
        if (i < 0) continue
        const prop = decl.slice(0, i).trim()
        const val = decl.slice(i + 1).trim().replace(/\s+/g, ' ')
        if (!LAYOUT_PROPS.test(prop)) continue
        const c = CALC_PCT.exec(val)
        if (!c || Number(c[1]) >= 100) continue
        for (const sel of selectors.split(',').map((s) => s.trim()).filter(Boolean)) {
          hits.push(`${rel} | ${sel} | ${prop}: ${val}`)
        }
      }
    }
  }
  return hits
}

export function judge(hits) {
  const seen = new Set(hits)
  const fresh = hits.filter((h) => !ALLOW[h])
  const stale = Object.keys(ALLOW).filter((k) => !seen.has(k))
  return { fresh, stale, ok: fresh.length === 0 && stale.length === 0 }
}

function report(r, label) {
  if (r.ok) {
    console.log(`✓ 零余量网格：${label}无新增「calc(百分比 - 定长)」布局宽度（白名单 ${Object.keys(ALLOW).length} 处均已核余量）`)
    return
  }
  if (r.fresh.length) {
    console.error(`✗ 新增「calc(百分比 - 定长)」布局宽度 ${r.fresh.length} 处（多列时格宽 + 间距易恰好 = 100%，真机 rpx 精度一偏就折行、离线预览看不出）：`)
    r.fresh.forEach((h) => console.error(`    ${h}`))
    console.error('  → 改为百分比宽度 + justify-content: space-between（2 列 48.5% / 3 列 32%）；确属安全（有 flex-grow 或核过余量 ≥ 4rpx）才进 ALLOW 并写核算')
  }
  if (r.stale.length) {
    console.error(`✗ 白名单条目已不在源码（被删或值被改，需重新核余量后更新 ALLOW）${r.stale.length} 处：`)
    r.stale.forEach((h) => console.error(`    ${h}`))
  }
}

function selftest() {
  const dir = mkdtempSync(join(tmpdir(), 'rpx-zero-slack-'))
  let ok = true
  const check = (name, mutate, expectOk) => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    for (const f of walk(MP)) {
      const rel = relative(MP, f)
      if (rel.startsWith('scripts')) continue
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      cpSync(f, join(dir, rel))
    }
    mutate(dir)
    const r = judge(scan(dir))
    const pass = r.ok === expectOk
    console.log(`  ${pass ? '✓' : '✗'} ${name}（期望${expectOk ? '通过' : '判红'}，实际${r.ok ? '通过' : '判红'}）`)
    if (!pass) ok = false
  }
  const patch = (root, rel, from, to) => {
    const p = join(root, rel)
    const s = readFileSync(p, 'utf8')
    if (!s.includes(from)) throw new Error(`锚点失效：${rel} · ${from}`)
    writeFileSync(p, s.replace(from, to))
  }
  try {
    check('基线（真源码副本）', () => {}, true)
    check('大盘指标卡改回 calc(50% - 8rpx)', (d) => patch(d, 'subpackages/b2bdesk/desk-common.wxss', '  width: 48.5%;\n  box-sizing: border-box;\n  margin-bottom: 16rpx;', '  width: calc(50% - 8rpx);\n  box-sizing: border-box;\n  margin-bottom: 16rpx;'), false)
    check('报表信号卡改回负边距 + calc(50% - 16rpx)', (d) => patch(d, 'subpackages/manager/manager/index.wxss', '  width: 48.5%;\n  margin: 8rpx 0;', '  width: calc(50% - 16rpx);\n  margin: 8rpx;'), false)
    check('三列 flex-basis 新写法也拦（flex: 1 1 calc(33.33% - 8rpx)）', (d) => patch(d, 'subpackages/extra/utils/ops-dashboard.wxss', '  width: 32%;', '  flex: 1 1 calc(33.33% - 8rpx);'), false)
    check('白名单条目的值被改（余量要重核）', (d) => patch(d, 'subpackages/manager/manager/index.wxss', 'flex: 1 1 calc(50% - 20rpx);', 'flex: 1 1 calc(50% - 10rpx);'), false)
    check('只写在注释里不算（不误报）', (d) => patch(d, 'subpackages/b2bdesk/desk-common.wxss', '/* 指标卡', '/* width: calc(50% - 8rpx); 指标卡'), true)
    check('calc(100% - N) 单列偏移不算（不误报）', (d) => patch(d, 'subpackages/b2bdesk/desk-common.wxss', '  width: 48.5%;\n  box-sizing: border-box;\n  margin-bottom: 16rpx;', '  width: 48.5%;\n  max-width: calc(100% - 8rpx);\n  box-sizing: border-box;\n  margin-bottom: 16rpx;'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (!ok) {
    console.error('✗ selftest 失败')
    process.exit(1)
  }
  console.log('✓ selftest 通过：4 个注入全部判红、2 个非问题写法不误报；真源码未被改动')
}

if (process.argv.includes('--selftest')) {
  selftest()
} else if (process.argv.includes('--list')) {
  scan(MP).forEach((h) => console.log(h))
} else {
  const r = judge(scan(MP))
  report(r, '全小程序 ')
  if (!r.ok) process.exit(1)
}
