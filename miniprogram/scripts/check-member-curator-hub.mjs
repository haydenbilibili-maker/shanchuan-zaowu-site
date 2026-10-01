#!/usr/bin/env node
/**
 * 超管工作台「会员调级」「荣誉馆长」两枚独立入口守卫（manager 域）
 *
 * 沿革：2026-09-29 两枚磁贴曾合并为一枚「会员调级」+ 页顶分段互切；
 * 2026-09-30 产品负责人要求把「荣誉馆长」重新释放成独立入口（同在「会员触达」分区），并移除两页页顶分段。
 * 本守卫按新语义改写（脚本名保留，守卫总数不变）。只动入口与导航层，两页业务逻辑 / 云函数 / 契约不动。
 *
 * 断言：
 *   1) 工作台恰好一枚「会员调级」（wx:if=menu.memberLevelAdjust → goMemberLevelAdjust）、
 *      恰好一枚「荣誉馆长」（wx:if=menu.honoraryCurators → goHonoraryCurators），二者同在 hubSec.members 分区；
 *      不得再有合并磁贴（goMemberCuratorHub / 两键 || 合并条件）
 *   2) 两个入口各自门禁：goMemberLevelAdjust → Guarded 判 MEMBER_LEVEL_ADJUST，goHonoraryCurators → Guarded 判 HONORARY_CURATORS
 *   3) 旧路径与深链不变：app.json extra 分包登记两页；两份 staffAuth 路径常量不变；messageHelper 旧 manager 路径映射仍在
 *   4) 两页页顶不再有 .hub-seg 分段 / onHubSegTap；调级页不再写「切到页顶」，改为指向工作台「荣誉馆长」入口
 *   5) 统一清单 hubNav：memberLevel / curators 两条独立、各自权限键；「我的常用」旧合并 id memberCurator 映射到 memberLevel
 *
 * 用法：node miniprogram/scripts/check-member-curator-hub.mjs [--selftest]
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const selftest = process.argv.includes('--selftest')
const TAG = '[check:member-curator-hub]'

const EXTRA = 'miniprogram/subpackages/extra'
const LEVEL_PATH = '/subpackages/extra/member-level-adjust/index'
const CURATOR_PATH = '/subpackages/extra/honorary-curators/index'
const FILES = {
  hubWxml: 'miniprogram/subpackages/manager/manager/index.wxml',
  hubJs: 'miniprogram/subpackages/manager/manager/managerPageConfig.js',
  hubNav: 'miniprogram/subpackages/manager/manager/hubNav.js',
  appJson: 'miniprogram/app.json',
  msgHelper: 'miniprogram/utils/messageHelper.js',
  staffManager: 'miniprogram/subpackages/manager/utils/staffAuth.js',
  staffExtra: `${EXTRA}/utils/staffAuth.js`,
  levelWxml: `${EXTRA}/member-level-adjust/index.wxml`,
  levelJs: `${EXTRA}/member-level-adjust/index.js`,
  levelWxss: `${EXTRA}/member-level-adjust/index.wxss`,
  curatorWxml: `${EXTRA}/honorary-curators/index.wxml`,
  curatorJs: `${EXTRA}/honorary-curators/index.js`,
  curatorWxss: `${EXTRA}/honorary-curators/index.wxss`
}

const src = {}
for (const [k, rel] of Object.entries(FILES)) {
  const p = resolve(ROOT, rel)
  if (!existsSync(p)) {
    console.error(TAG, '缺少', rel)
    process.exit(1)
  }
  src[k] = readFileSync(p, 'utf8')
}

function methodBody(js, name) {
  const m = js.match(new RegExp(`\\n  ${name}\\(\\)\\s*\\{([\\s\\S]*?)\\n  \\}`))
  return m ? m[1] : null
}

function evalCjs(code) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, () => { throw new Error('hubNav 不应 require') })
  return mod.exports
}

/** 找某枚磁贴所在分区（向前最近的 hub-sec 开标签；2026-10-01 起开标签带便当列数 span-{{hubSpan.<id>}} 与锚点 id） */
function sectionOf(wxml, at) {
  const re = /<view class="hub-sec span-\{\{hubSpan\.\w+\}\}" wx:if="\{\{hubSec\.(\w+)\}\}" id="hub-sec-\w+">/g
  let m
  let sec = null
  while ((m = re.exec(wxml)) && m.index < at) sec = m[1]
  return sec
}

function checkTile(errs, s, label, key, handler) {
  const tiles = s.hubWxml.match(new RegExp(`<text>${label}</text>`, 'g')) || []
  if (tiles.length !== 1) errs.push(`工作台须恰好一枚「${label}」磁贴（现 ${tiles.length}）`)
  const re = new RegExp(`wx:if="\\{\\{menu\\.${key}\\}\\}"\\s+bindtap="${handler}">[\\s\\S]{0,200}<text>${label}</text>`)
  const m = s.hubWxml.match(re)
  if (!m) {
    errs.push(`「${label}」磁贴须按 menu.${key} 单独显示并绑 ${handler}（恢复合并前的权限判断）`)
    return
  }
  const sec = sectionOf(s.hubWxml, m.index)
  if (sec !== 'members') errs.push(`「${label}」磁贴须在「会员触达」分区（hubSec.members），现在 ${sec || '无分区'}`)
}

function checkGuarded(errs, js, alias, guarded, menuKey, goFn) {
  if (!new RegExp(`${alias}:\\s*function\\s*\\(\\)\\s*\\{\\s*this\\.${guarded}\\(\\);?\\s*\\}`).test(js)) {
    errs.push(`managerPageConfig 须有 ${alias} → ${guarded}`)
  }
  const body = methodBody(js, guarded)
  if (!body) {
    errs.push(`managerPageConfig 缺 ${guarded}`)
    return
  }
  if (!new RegExp(`canSeeMenu\\(this\\.data\\.workspaceRole, MENU_KEYS\\.${menuKey}\\)`).test(body)) {
    errs.push(`${guarded} 须按 MENU_KEYS.${menuKey} 判权限`)
  }
  if (!new RegExp(`\\n\\s+${goFn}\\(\\);`).test(body)) errs.push(`${guarded} 须进入 ${goFn}`)
  if (/wx\.showModal\s*\(/.test(body)) errs.push(`${guarded} 不得弹原生 modal`)
}

function checkNoSeg(errs, label, wxml, js, wxss) {
  if (/class="hub-seg/.test(wxml)) errs.push(`${label}：页顶「调级 / 荣誉馆长」分段应已移除`)
  if (/onHubSegTap/.test(wxml) || /\n  onHubSegTap\(/.test(js)) errs.push(`${label}：onHubSegTap 应已移除（两页不再互切）`)
  if (/\.hub-seg[\w-]*\s*\{/.test(wxss)) errs.push(`${label}：.hub-seg 样式应已移除（死样式）`)
}

function collect(s) {
  const errs = []

  checkTile(errs, s, '会员调级', 'memberLevelAdjust', 'goMemberLevelAdjust')
  checkTile(errs, s, '荣誉馆长', 'honoraryCurators', 'goHonoraryCurators')
  if (/bindtap="goMemberCuratorHub"/.test(s.hubWxml) || /menu\.memberLevelAdjust \|\| menu\.honoraryCurators/.test(s.hubWxml)) {
    errs.push('工作台不得再有「会员调级 + 荣誉馆长」合并磁贴（已拆成两枚独立入口）')
  }

  checkGuarded(errs, s.hubJs, 'goMemberLevelAdjust', 'goMemberLevelAdjustGuarded', 'MEMBER_LEVEL_ADJUST', 'goMemberLevelAdjust')
  checkGuarded(errs, s.hubJs, 'goHonoraryCurators', 'goHonoraryCuratorsGuarded', 'HONORARY_CURATORS', 'goHonoraryCurators')

  let app = null
  try { app = JSON.parse(s.appJson) } catch { errs.push('app.json 解析失败') }
  if (app) {
    const pkgs = app.subpackages || app.subPackages || []
    const extra = pkgs.find((p) => p.root === 'subpackages/extra' || p.root === 'subpackages/extra/')
    const pages = (extra && extra.pages) || []
    for (const pg of ['member-level-adjust/index', 'honorary-curators/index']) {
      if (!pages.includes(pg)) errs.push(`app.json extra 分包须登记 ${pg}（旧深链依赖此路径）`)
    }
  }
  for (const [k, label] of [['staffManager', 'manager'], ['staffExtra', 'extra']]) {
    if (!s[k].includes(`const MEMBER_LEVEL_ADJUST_PATH = '${LEVEL_PATH}'`)) errs.push(`${label}/staffAuth 调级路径须保持 ${LEVEL_PATH}`)
    if (!s[k].includes(`const HONORARY_CURATORS_PATH = '${CURATOR_PATH}'`)) errs.push(`${label}/staffAuth 馆长路径须保持 ${CURATOR_PATH}`)
  }
  for (const page of ['member-level-adjust', 'honorary-curators']) {
    if (!s.msgHelper.includes(`{ from: '/subpackages/manager/${page}', to: '/subpackages/extra/${page}' }`)) {
      errs.push(`messageHelper 旧消息深链映射 /subpackages/manager/${page} → extra 须保留`)
    }
  }

  checkNoSeg(errs, 'member-level-adjust', s.levelWxml, s.levelJs, s.levelWxss)
  checkNoSeg(errs, 'honorary-curators', s.curatorWxml, s.curatorJs, s.curatorWxss)
  if (/切到页顶/.test(s.levelWxml)) errs.push('调级页仍写「切到页顶『荣誉馆长』」—— 分段已移除，文案须改指工作台入口')
  if (!/工作台「荣誉馆长」/.test(s.levelWxml)) errs.push('调级页提示须指向工作台「荣誉馆长」独立入口')

  let nav = null
  try { nav = evalCjs(s.hubNav) } catch (e) { errs.push(`hubNav.js 加载失败：${e.message}`) }
  if (nav) {
    const lvl = nav.findEntry('memberLevel')
    const cur = nav.findEntry('curators')
    if (!lvl || JSON.stringify(lvl.keys) !== JSON.stringify(['memberLevelAdjust']) || lvl.tap !== 'goMemberLevelAdjust') {
      errs.push('入口清单 memberLevel 须独立：keys=[memberLevelAdjust]、tap=goMemberLevelAdjust')
    }
    if (!cur || JSON.stringify(cur.keys) !== JSON.stringify(['honoraryCurators']) || cur.tap !== 'goHonoraryCurators') {
      errs.push('入口清单 curators 须独立：keys=[honoraryCurators]、tap=goHonoraryCurators')
    }
    if (nav.findEntry('memberCurator')) errs.push('入口清单里不应再有合并入口 memberCurator')
    if ((nav.FAV_ID_ALIASES || {}).memberCurator !== 'memberLevel') errs.push('「我的常用」旧合并 id memberCurator 须映射到 memberLevel（会员调级）')
  }
  return errs
}

if (selftest) {
  // 每条注入只改内存副本，不碰源文件；任何一条没被检出即失败
  const cases = [
    ['合并磁贴复活', (s) => ({ ...s, hubWxml: s.hubWxml + '\n<view class="menu-btn" wx:if="{{menu.memberLevelAdjust || menu.honoraryCurators}}" bindtap="goMemberCuratorHub"><text>会员</text></view>' }), /合并磁贴/],
    ['馆长磁贴丢失', (s) => ({ ...s, hubWxml: s.hubWxml.replace('<text>荣誉馆长</text>', '<text>馆长</text>') }), /恰好一枚「荣誉馆长」/],
    ['调级磁贴权限写宽', (s) => ({ ...s, hubWxml: s.hubWxml.replace('wx:if="{{menu.memberLevelAdjust}}" bindtap="goMemberLevelAdjust"', 'wx:if="{{menu.memberLevelAdjust || menu.honoraryCurators}}" bindtap="goMemberLevelAdjust"') }), /按 menu\.memberLevelAdjust 单独显示|合并磁贴/],
    ['馆长磁贴绑错入口', (s) => ({ ...s, hubWxml: s.hubWxml.replace('bindtap="goHonoraryCurators"', 'bindtap="goMemberLevelAdjust"') }), /按 menu\.honoraryCurators 单独显示/],
    ['馆长磁贴移出会员分区', (s) => ({ ...s, hubWxml: s.hubWxml.replace('<view class="hub-sec span-{{hubSpan.members}}" wx:if="{{hubSec.members}}" id="hub-sec-members">', '<view class="hub-sec span-{{hubSpan.members}}" wx:if="{{hubSec.memberz}}" id="hub-sec-members">') }), /须在「会员触达」分区/],
    ['馆长门禁判错权限', (s) => ({ ...s, hubJs: s.hubJs.replace(/(goHonoraryCuratorsGuarded\(\) \{\n\s+if \(!canSeeMenu\(this\.data\.workspaceRole, MENU_KEYS\.)HONORARY_CURATORS/, '$1MEMBER_LEVEL_ADJUST') }), /须按 MENU_KEYS\.HONORARY_CURATORS/],
    ['调级入口别名未挂', (s) => ({ ...s, hubJs: s.hubJs.replace('goMemberLevelAdjust: function () { this.goMemberLevelAdjustGuarded(); },', '') }), /goMemberLevelAdjust → goMemberLevelAdjustGuarded/],
    ['旧页从分包摘除', (s) => ({ ...s, appJson: s.appJson.replace('"honorary-curators/index",', '') }), /须登记 honorary-curators\/index/],
    ['深链路径被改', (s) => ({ ...s, staffExtra: s.staffExtra.replace(`'${LEVEL_PATH}'`, "'/subpackages/extra/member-hub/index'") }), /extra\/staffAuth 调级路径/],
    ['消息深链映射丢失', (s) => ({ ...s, msgHelper: s.msgHelper.replace("{ from: '/subpackages/manager/honorary-curators', to: '/subpackages/extra/honorary-curators' },", '') }), /messageHelper 旧消息深链/],
    ['调级页分段复活', (s) => ({ ...s, levelWxml: s.levelWxml.replace('<view class="header">', '<view class="hub-seg"><view class="hub-seg-item" bindtap="onHubSegTap">荣誉馆长</view></view>\n  <view class="header">') }), /member-level-adjust：页顶「调级 \/ 荣誉馆长」分段应已移除/],
    ['馆长页切换方法残留', (s) => ({ ...s, curatorJs: s.curatorJs.replace('  noop() {}', "  noop() {},\n\n  onHubSegTap() {\n    wx.redirectTo({ url: 'x' });\n  }") }), /honorary-curators：onHubSegTap 应已移除/],
    ['旧提示文案回流', (s) => ({ ...s, levelWxml: s.levelWxml.replace('荣誉馆长名单请从工作台「荣誉馆长」进入', '荣誉馆长请切到页顶「荣誉馆长」') }), /切到页顶/],
    ['清单又合并', (s) => ({ ...s, hubNav: s.hubNav.replace("keys: ['honoraryCurators'], tap: 'goHonoraryCurators'", "keys: ['memberLevelAdjust', 'honoraryCurators'], tap: 'goHonoraryCurators'") }), /curators 须独立/],
    ['常用旧 id 映射丢失', (s) => ({ ...s, hubNav: s.hubNav.replace("memberCurator: 'memberLevel', ", '') }), /memberCurator 须映射到 memberLevel/]
  ]
  const base = collect(src)
  if (base.length) {
    base.forEach((e) => console.error(TAG, '基线不绿，selftest 无意义：', e))
    process.exit(1)
  }
  let bad = 0
  for (const [name, mutate, expect] of cases) {
    const mutated = mutate(src)
    const changed = Object.keys(src).some((k) => mutated[k] !== src[k])
    const errs = collect(mutated)
    if (!changed || !errs.some((e) => expect.test(e))) {
      console.error(TAG, `selftest 失败：「${name}」${changed ? `未被检出${errs.length ? ` → ${errs[0]}` : ''}` : '注入未生效（锚点失配）'}`)
      bad++
    }
  }
  if (bad) process.exit(1)
  console.log(TAG, `selftest ok（${cases.length} 条注入全部检出，内存副本不写盘）`)
  process.exit(0)
}

const errs = collect(src)
if (errs.length) {
  errs.forEach((e) => console.error(TAG, e))
  process.exit(1)
}
console.log(TAG, 'pass（会员调级 / 荣誉馆长两枚独立入口、各自权限、旧路径与消息深链不变、两页无分段）')
