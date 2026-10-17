#!/usr/bin/env node
/**
 * 我的成就 · 馆志重设计守卫（2026-10-17，home 域）
 *
 * 真跑成就页 _applyAchievementData（桩 wx / 彩蛋 / 角标，不联网、不写盘）：
 *   A 不丢徽章：云函数 getUserAchievements 配置里的每个 id 都进了某条成长线；云端新增、前端未登记的 id 也会按前缀成线
 *   B 成长线：节点按登记顺序、罗马序号；通往「下一枚」的那段连线按它的进度部分填，已点亮之间满，其余为 0；全部点亮时「已全部点亮」
 *   C 下一枚：最多三枚、都是未点亮、进度高者优先
 *   D 卷首刻度数 = 徽章总数、亮格数 = 已点亮数
 *   E focus=relics 真能落到山海拾遗：内容不在 scroll-view 里（wx.pageScrollTo 滚不动 scroll-view），且页面开了下拉刷新
 *
 * 用法：node miniprogram/scripts/check-achievement-tracks.mjs [--selftest]
 * --selftest：对真源做内存注入（不改文件），每条注入都必须被检出。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const P = {
  page: resolve(MP, 'subpackages/extra/user/achievements/index.js'),
  wxml: resolve(MP, 'subpackages/extra/user/achievements/index.wxml'),
  json: resolve(MP, 'subpackages/extra/user/achievements/index.json'),
  fn: resolve(MP, 'cloudfunctions/getUserAchievements/index.js'),
  certJs: resolve(MP, 'subpackages/extra/user/certificates/index.js'),
  certWxml: resolve(MP, 'subpackages/extra/user/certificates/index.wxml'),
  wishJs: resolve(MP, 'subpackages/extra/user/wishlist/index.js'),
  wishWxml: resolve(MP, 'subpackages/extra/user/wishlist/index.wxml'),
  msgJs: resolve(MP, 'subpackages/extra/user/messages/index.js'),
  msgWxml: resolve(MP, 'subpackages/extra/user/messages/index.wxml'),
  letterWxml: resolve(MP, 'subpackages/extra/user/messages/detail/index.wxml')
}

async function run(inject) {
  const fails = []
  const ok = (cond, msg) => { if (!cond) fails.push(msg) }
  const transform = (file, src) => (inject && inject.file === file ? apply(src, inject) : src)
  const read = (file) => transform(file, readFileSync(file, 'utf8'))

  let cfg = null
  loadCjsModule(P.page, {
    transform,
    globals: { getApp: () => ({ globalData: { openid: 'u1' } }), Page: (o) => { cfg = o }, wx: { vibrateShort() {}, showToast() {} }, getCurrentPages: () => [] },
    stubs: {
      '../../../../utils/easterEgg': { listCatalog: () => [], getProgress: () => ({ found: 0, total: 0 }), isDiscovered: () => false },
      '../../../../utils/badgeDisplay': { markAchievementsSeen() {} }
    }
  })
  const page = { ...cfg, data: JSON.parse(JSON.stringify(cfg.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } }

  // 云函数真配置的 id / type / threshold（只读源码，不执行云函数）
  const fnSrc = read(P.fn)
  const conf = [...fnSrc.matchAll(/\n\s+id: '([a-z0-9_]+)',\n\s+type: '([a-z]+)',[\s\S]*?threshold: (\d+),/g)].map((m) => ({ id: m[1], type: m[2], threshold: Number(m[3]) }))
  ok(conf.length >= 20, `A 没读到云函数成就配置（读到 ${conf.length} 条）`)
  const mk = (c, progress) => ({ id: c.id, type: c.type, name: c.id, desc: c.id, threshold: c.threshold, progress, unlocked: progress >= c.threshold, reward: { points: 10 } })
  const list = conf.map((c) => mk(c, c.id === 'explore_10' ? 10 : c.id === 'explore_50' ? 25 : 0))
    .concat([{ id: 'night_3', type: 'explore', name: '夜游者', desc: '夜里来 3 次', threshold: 3, progress: 1, unlocked: false }])
  page._applyAchievementData({ achievements: list, stats: { total: list.length, unlocked: 1, locked: list.length - 1 } })
  const tracks = page.data.chapters.reduce((a, c) => a.concat(c.tracks), [])
  const placed = tracks.reduce((a, t) => a.concat(t.nodes.map((n) => n.id)), [])
  const lost = list.map((a) => a.id).filter((id) => placed.indexOf(id) === -1)
  ok(!lost.length && placed.length === list.length, `A 有徽章没进任何成长线（页面上就看不到了）：${lost.join(',')}`)

  // A2 云端现有的每枚都登记在 TRACK_DEFS 里（兜底只为将来的新徽章；现有的要有正确的分组与节点标签）
  const defsSrc = (read(P.page).match(/const TRACK_DEFS = \[([\s\S]*?)\n\];/) || [])[1] || ''
  const unreg = conf.filter((c) => defsSrc.indexOf(`'${c.id}'`) === -1).map((c) => c.id)
  ok(!!defsSrc && !unreg.length, `A 云函数里的徽章未登记成长线（会被兜底拆成孤立的一枚、节点没标签）：${unreg.join(',')}`)

  const explore = tracks.find((t) => t.key === 'explore')
  ok(!!explore && explore.nodes.map((n) => n.roman).join(',') === 'I,II,III' && explore.nodes[0].unlocked && !explore.nodes[1].unlocked,
    'B 浏览线须为 I / II / III，第一枚点亮')
  ok(!!explore && explore.nodes[0].linkFill === 50 && explore.nodes[1].linkFill === 0 && explore.nodes[2].linkFill === -1,
    `B 通往下一枚的连线须按其进度填（25/50 = 50%），其后为 0、末节点无线：${explore && explore.nodes.map((n) => n.linkFill).join(',')}`)
  ok(!!explore && explore.nextName === 'explore_50' && !/即可点亮/.test(explore.nextRemain), 'B 下一枚须是浏览线上第一枚未点亮，行内不重复「即可点亮」')
  page._applyAchievementData({ achievements: list.map((a) => ({ ...a, progress: a.threshold, unlocked: true })), stats: {} })
  const allDone = page.data.chapters.reduce((a, c) => a.concat(c.tracks), []).every((t) => t.done && t.nodes.every((n) => n.linkFill === 100 || n.linkFill === -1))
  ok(allDone, 'B 全部点亮时每条线「已全部点亮」且连线全满')
  ok(page.data.nextUp.length === 0, 'C 全部点亮时不再有下一枚')

  page._applyAchievementData({ achievements: list, stats: { total: list.length, unlocked: 1 } })
  const nu = page.data.nextUp
  ok(nu.length === 3 && nu.every((a) => !a.unlocked) && nu[0].id === 'explore_50' && nu[0].progressPercent >= nu[1].progressPercent,
    `C 下一枚须为三枚未点亮、进度高者优先：${nu.map((a) => a.id + ':' + a.progressPercent).join(',')}`)
  ok(page.data.ticks.length === list.length && page.data.ticks.filter((t) => t.lit).length === 1, 'D 卷首刻度须每枚一格、亮格 = 已点亮数')

  const wxml = read(P.wxml)
  ok(!/<scroll-view/.test(wxml) && /class="block relics-card"/.test(wxml), 'E 内容不得放进 scroll-view（pageScrollTo 滚不到 .relics-card）')
  ok(/"enablePullDownRefresh": true/.test(read(P.json)) && /onPullDownRefresh\(\)/.test(read(P.page)), 'E 改回页面滚动后须开启原生下拉刷新')

  // F 「我的」子页（2026-10-17 同日重构）：荣誉档案筛选 / 缩样印色；收藏与候补页面滚动
  let certCfg = null
  loadCjsModule(P.certJs, {
    transform,
    globals: { getApp: () => ({ globalData: {} }), Page: (o) => { certCfg = o }, wx: { cloud: { database: () => ({}) } } },
    stubs: { '../../../../config/cloudEnv': { cdnPath: (x) => x } }
  })
  const cp = { ...certCfg, data: JSON.parse(JSON.stringify(certCfg.data)), setData(p) { Object.assign(this.data, p) } }
  cp.data.certificates = [{ _id: 'a', kind: 'holder' }, { _id: 'b', kind: 'gift_voucher' }, { _id: 'c', kind: 'gift_holder' }]
  cp.onFilter({ currentTarget: { dataset: { key: 'holder' } } })
  const holderIds = cp.data.visible.map((c) => c._id).join(',')
  cp.onFilter({ currentTarget: { dataset: { key: 'given' } } })
  const givenIds = cp.data.visible.map((c) => c._id).join(',')
  ok(holderIds === 'a,c' && givenIds === 'b', `F 荣誉档案筛选：收藏须含受赠、赠出只含赠予凭证（实际 收藏=${holderIds} 赠出=${givenIds}）`)
  const certWxml = read(P.certWxml)
  ok(/class="filters" wx:if="\{\{givenCount > 0 && !loading\}\}"/.test(certWxml), 'F 没赠出过时不出筛选（只有一类，筛选是噪音）')
  ok(/c-seal \{\{item\.kind === 'gift_voucher' \? 'is-gift' : ''\}\}/.test(certWxml) && /wx:for="\{\{visible\}\}"/.test(certWxml),
    'F 缩样印色按证书身份（赠予 = 朱、收藏 = 铜），列表渲染筛选后的 visible')
  const wishWxml = read(P.wishWxml)
  ok(!/<scroll-view/.test(wishWxml) && !/<scroll-view/.test(certWxml) && !/headerBlockPx/.test(read(P.wishJs) + read(P.certJs)),
    'F 收藏与候补 / 荣誉档案改为页面滚动（不再 scroll-view + 量出来的顶距）')
  ok(!/&amp;/.test(wishWxml), 'F WXML 文本里不写 &amp;（真机可能原样显示）')

  // G 山海有信「信笺」（2026-10-17）：按日分组的日轨 / 顾客卷首只在顾客队列 / 信笺退场旧装饰
  const msgMod = loadCjsModule(P.msgJs, {
    transform: (f, src) => (f === P.msgJs ? transform(f, src) + '\nmodule.exports.__withDayRail = withDayRail' : transform(f, src)),
    globals: { getApp: () => ({ globalData: {} }), Page: () => {}, wx: {} }
  })
  const now = new Date(2026, 9, 17, 12)
  const rail = msgMod.__withDayRail([{ createTime: new Date(2026, 9, 17, 9) }, { createTime: new Date(2026, 9, 17, 8) },
    { createTime: new Date(2026, 9, 16, 20) }, { createTime: new Date(2026, 9, 12) }, { createTime: new Date(2025, 2, 2) }, {}], now).map((x) => x.dayLabel)
  ok(rail.join('|') === '今天||昨天|10 月 12 日|2025 年 3 月 2 日|', `G 日轨须每天只标第一封、跨年带年份、无时间不标：${rail.join('|')}`)
  const msgWxml = read(P.msgWxml)
  ok(/class="letters-head" wx:if="\{\{!workflowMode && activeQueue === 'customer'\}\}"/.test(msgWxml) &&
    /class="day-rail" wx:if="\{\{item\.dayLabel && !workflowMode && activeQueue === 'customer'\}\}"/.test(msgWxml),
    'G 信箱卷首与日轨只在顾客队列出现（员工工作信息 / 日报不受影响）')
  const letter = read(P.letterWxml)
  ok(!/paper-fiber|paper-laid|paper-wear|paper-crease|paper-fold|signal-row|class="grain-overlay"/.test(letter) && /class="letter-seal seal-/.test(letter),
    'G 信笺退场纤维 / 压纹 / 磨损 / 折痕 / 信号灯，换方寸印')
  return fails
}

function apply(src, inj) {
  if (src.indexOf(inj.find) === -1) throw new Error(`注入锚点失效：${inj.name}`)
  return src.replace(inj.find, inj.replace)
}

const INJECTIONS = [
  { name: '未登记徽章被丢弃', file: P.page, find: "  all.filter((a) => a && a.id && !used[a.id]).forEach((a) => {", replace: "  [].forEach((a) => {" },
  { name: '登记表漏一个 id', file: P.page, find: "'atlas_mountain', 'atlas_volume'", replace: "'atlas_mountain'" },
  { name: '连线不按进度填', file: P.page, find: '    if (i + 1 === nextIndex && nodes[i].unlocked) return next.progressPercent;\n', replace: '' },
  { name: '下一枚按门槛排', file: P.page, find: '.sort((a, b) => (b.progressPercent - a.progressPercent) || (a.threshold - b.threshold))', replace: '.sort((a, b) => a.threshold - b.threshold)' },
  { name: '内容回到 scroll-view', file: P.wxml, find: '  <view class="content">\n', replace: '  <scroll-view scroll-y class="content">\n' },
  { name: '没开下拉刷新', file: P.json, find: '"enablePullDownRefresh": true', replace: '"enablePullDownRefresh": false' },
  { name: '证书筛选收藏丢了受赠', file: P.certJs, find: "if (filter === 'holder') return all.filter((c) => c.kind !== 'gift_voucher')", replace: "if (filter === 'holder') return all.filter((c) => c.kind === 'holder')" },
  { name: '没赠出过也出筛选', file: P.certWxml, find: 'class="filters" wx:if="{{givenCount > 0 && !loading}}"', replace: 'class="filters" wx:if="{{!loading}}"' },
  { name: '收藏与候补回到 scroll-view', file: P.wishWxml, find: '<view class="page-wishlist">', replace: '<view class="page-wishlist"><scroll-view scroll-y class="content">' },
  { name: '日轨每封都标日期', file: P.msgJs, find: "    const dayLabel = label && label !== prev ? label : '';", replace: "    const dayLabel = label;" },
  { name: '信笺装饰节点复活', file: P.letterWxml, find: '          <view class="paper-plate-outer"></view>\n', replace: '          <view class="paper-plate-outer"></view>\n          <view class="paper-fiber"></view>\n' },
  { name: '刻度只数点亮的', file: P.page, find: "t.nodes.map((n) => ({ id: n.id, lit: n.unlocked }))", replace: "t.nodes.filter((n) => n.unlocked).map((n) => ({ id: n.id, lit: true }))" }
]

if (process.argv.includes('--selftest')) {
  let bad = 0
  for (const inj of INJECTIONS) {
    let fails
    try { fails = await run(inj) } catch (e) {
      if (/注入锚点失效/.test(e.message)) { console.error(`  ✗ ${e.message}`); bad += 1; continue }
      fails = [String(e.message)]
    }
    if (fails.length) console.log(`  ✓ 检出「${inj.name}」→ ${fails[0]}`)
    else { console.error(`  ✗ 注入「${inj.name}」未被检出`); bad += 1 }
  }
  const clean = await run(null)
  if (clean.length) { console.error('  ✗ 未注入时本应通过：', clean); bad += 1 }
  if (bad) { console.error(`✗ check:achievement-tracks 自检失败 ${bad} 项`); process.exit(1) }
  console.log(`✓ check:achievement-tracks 自检通过（${INJECTIONS.length} 条内存注入全部检出，未写盘）`)
  process.exit(0)
}

const fails = await run(null)
if (fails.length) {
  console.error('✗ 我的成就 · 馆志守卫失败：')
  fails.forEach((f) => console.error('  ' + f))
  process.exit(1)
}
console.log('✓ 我的成就 · 馆志：徽章一枚不丢地进成长线 · 连线按进度填 · 下一枚取最近三枚 · 刻度一枚一格 · focus=relics 真能滚到')
