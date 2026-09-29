#!/usr/bin/env node
/**
 * 超管工作台「会员调级」合并入口守卫（manager 域）
 *
 * 2026-09-29 产品负责人：「会员调级」与「荣誉馆长」两枚磁贴合并为一枚「会员调级」，
 * 进入后页顶分段「调级 / 荣誉馆长」互切。只动入口与导航层，两页业务逻辑 / 云函数 / 契约不动。
 *
 * 断言：
 *   1) 工作台恰好一枚「会员调级」磁贴，按 menu.memberLevelAdjust || menu.honoraryCurators 显示、绑 goMemberCuratorHub；
 *      旧「等级调档」「荣誉馆长」磁贴不得复活
 *   2) goMemberCuratorHub → goMemberCuratorHubGuarded，两条菜单权限各自能落到 goMemberLevelAdjust / goHonoraryCurators
 *   3) 两个子页都可达：app.json 的 extra 分包仍登记两页；两份 staffAuth 路径常量不变（旧深链照常）
 *   4) 两页页顶都有 .hub-seg：本页项 active、另一项绑 onHubSegTap，onHubSegTap redirectTo 对方路径且不弹原生 modal
 *   5) 分段样式 flex: 1 等分，不用 calc(百分比 − 定长) 列宽（E26）
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
  appJson: 'miniprogram/app.json',
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

function checkPage(errs, label, wxml, js, wxss, selfName, otherName, otherPath) {
  const seg = wxml.match(/<view class="hub-seg">([\s\S]*?)<\/view>\s*<view class="header">/)
  if (!seg) {
    errs.push(`${label}：页顶须有 .hub-seg 分段（位于 .header 之前）`)
  } else {
    if (!new RegExp(`class="hub-seg-item active">${selfName}<`).test(seg[1])) {
      errs.push(`${label}：分段里本页「${selfName}」须为 active`)
    }
    if (!new RegExp(`class="hub-seg-item" bindtap="onHubSegTap">${otherName}<`).test(seg[1])) {
      errs.push(`${label}：分段里「${otherName}」须绑 onHubSegTap`)
    }
  }
  const body = methodBody(js, 'onHubSegTap')
  if (!body) {
    errs.push(`${label}：缺 onHubSegTap`)
  } else {
    if (!body.includes(`'${otherPath}'`) || !/wx\.redirectTo\(/.test(body)) {
      errs.push(`${label}：onHubSegTap 须 redirectTo ${otherPath}`)
    }
    if (/wx\.showModal\s*\(/.test(body)) errs.push(`${label}：onHubSegTap 不得弹原生 modal`)
  }
  const item = wxss.match(/\.hub-seg-item\s*\{([^}]*)\}/)
  if (!item || !/flex:\s*1\s*;/.test(item[1])) errs.push(`${label}：.hub-seg-item 须 flex: 1 等分`)
  const segCss = (wxss.match(/\.hub-seg[\w-]*(?:\.active)?\s*\{[^}]*\}/g) || []).join('\n')
  if (/calc\(\s*\d+(\.\d+)?%\s*-/.test(segCss)) errs.push(`${label}：分段样式不得用 calc(百分比 − 定长) 列宽（E26）`)
}

function collect(s) {
  const errs = []

  const tiles = s.hubWxml.match(/<text>会员调级<\/text>/g) || []
  if (tiles.length !== 1) errs.push(`工作台须恰好一枚「会员调级」磁贴（现 ${tiles.length}）`)
  if (!/wx:if="\{\{menu\.memberLevelAdjust \|\| menu\.honoraryCurators\}\}"\s+bindtap="goMemberCuratorHub">[\s\S]{0,200}<text>会员调级<\/text>/.test(s.hubWxml)) {
    errs.push('「会员调级」磁贴须按 menu.memberLevelAdjust || menu.honoraryCurators 显示并绑 goMemberCuratorHub')
  }
  if (/<text>等级调档<\/text>/.test(s.hubWxml) || /bindtap="goMemberLevelAdjust"/.test(s.hubWxml)) {
    errs.push('工作台不得再有独立「等级调档」磁贴（已并入「会员调级」）')
  }
  if (/<text>荣誉馆长<\/text>/.test(s.hubWxml) || /bindtap="goHonoraryCurators"/.test(s.hubWxml)) {
    errs.push('工作台不得再有独立「荣誉馆长」磁贴（已并入「会员调级」）')
  }

  if (!/goMemberCuratorHub:\s*function\s*\(\)\s*\{\s*this\.goMemberCuratorHubGuarded\(\);?\s*\}/.test(s.hubJs)) {
    errs.push('managerPageConfig 须有 goMemberCuratorHub → goMemberCuratorHubGuarded')
  }
  const guarded = methodBody(s.hubJs, 'goMemberCuratorHubGuarded')
  if (!guarded) {
    errs.push('managerPageConfig 缺 goMemberCuratorHubGuarded')
  } else {
    if (!/canSeeMenu\(role, MENU_KEYS\.MEMBER_LEVEL_ADJUST\)\)\s*\{\s*goMemberLevelAdjust\(\);/.test(guarded)) {
      errs.push('goMemberCuratorHubGuarded：有调级权限须进 goMemberLevelAdjust（子功能「调级」不可达）')
    }
    if (!/canSeeMenu\(role, MENU_KEYS\.HONORARY_CURATORS\)\)\s*\{\s*goHonoraryCurators\(\);/.test(guarded)) {
      errs.push('goMemberCuratorHubGuarded：有馆长权限须进 goHonoraryCurators（子功能「荣誉馆长」不可达）')
    }
    if (/wx\.showModal\s*\(/.test(guarded)) errs.push('goMemberCuratorHubGuarded 不得弹原生 modal')
  }

  let app = null
  try { app = JSON.parse(s.appJson) } catch { errs.push('app.json 解析失败') }
  if (app) {
    const pkgs = app.subpackages || app.subPackages || []
    const extra = pkgs.find((p) => p.root === 'subpackages/extra' || p.root === 'subpackages/extra/')
    const pages = (extra && extra.pages) || []
    for (const pg of ['member-level-adjust/index', 'honorary-curators/index']) {
      if (!pages.includes(pg)) errs.push(`app.json extra 分包须登记 ${pg}（旧深链与分段切换依赖此路径）`)
    }
  }
  for (const [k, label] of [['staffManager', 'manager'], ['staffExtra', 'extra']]) {
    if (!s[k].includes(`const MEMBER_LEVEL_ADJUST_PATH = '${LEVEL_PATH}'`)) errs.push(`${label}/staffAuth 调级路径须保持 ${LEVEL_PATH}`)
    if (!s[k].includes(`const HONORARY_CURATORS_PATH = '${CURATOR_PATH}'`)) errs.push(`${label}/staffAuth 馆长路径须保持 ${CURATOR_PATH}`)
  }

  checkPage(errs, 'member-level-adjust', s.levelWxml, s.levelJs, s.levelWxss, '调级', '荣誉馆长', CURATOR_PATH)
  checkPage(errs, 'honorary-curators', s.curatorWxml, s.curatorJs, s.curatorWxss, '荣誉馆长', '调级', LEVEL_PATH)
  return errs
}

if (selftest) {
  // 每条注入只改内存副本，不碰源文件；任何一条没被检出即失败
  const cases = [
    ['旧调级磁贴复活', (s) => ({ ...s, hubWxml: s.hubWxml + '\n<view class="menu-btn" bindtap="goMemberLevelAdjust"><text>等级调档</text></view>' }), /独立「等级调档」/],
    ['旧馆长磁贴复活', (s) => ({ ...s, hubWxml: s.hubWxml + '\n<view class="menu-btn" bindtap="goHonoraryCurators"><text>荣誉馆长</text></view>' }), /独立「荣誉馆长」/],
    ['合并磁贴丢失', (s) => ({ ...s, hubWxml: s.hubWxml.replace('<text>会员调级</text>', '<text>会员</text>') }), /恰好一枚/],
    ['磁贴只认调级权限', (s) => ({ ...s, hubWxml: s.hubWxml.replace('menu.memberLevelAdjust || menu.honoraryCurators', 'menu.memberLevelAdjust') }), /须按 menu\.memberLevelAdjust \|\| menu\.honoraryCurators/],
    ['入口方法未挂', (s) => ({ ...s, hubJs: s.hubJs.replace('goMemberCuratorHub: function () { this.goMemberCuratorHubGuarded(); },', '') }), /goMemberCuratorHub → goMemberCuratorHubGuarded/],
    ['馆长子功能不可达', (s) => ({ ...s, hubJs: s.hubJs.replace(/(canSeeMenu\(role, MENU_KEYS\.HONORARY_CURATORS\)\)\s*\{\s*)goHonoraryCurators\(\);/, '$1goMemberLevelAdjust();') }), /子功能「荣誉馆长」不可达/],
    ['调级子功能不可达', (s) => ({ ...s, hubJs: s.hubJs.replace(/(canSeeMenu\(role, MENU_KEYS\.MEMBER_LEVEL_ADJUST\)\)\s*\{\s*)goMemberLevelAdjust\(\);/, '$1goHonoraryCurators();') }), /子功能「调级」不可达/],
    ['旧页从分包摘除', (s) => ({ ...s, appJson: s.appJson.replace('"honorary-curators/index",', '') }), /须登记 honorary-curators\/index/],
    ['深链路径被改', (s) => ({ ...s, staffExtra: s.staffExtra.replace(`'${LEVEL_PATH}'`, "'/subpackages/extra/member-hub/index'") }), /extra\/staffAuth 调级路径/],
    ['调级页丢分段', (s) => ({ ...s, levelWxml: s.levelWxml.replace('<view class="hub-seg">', '<view class="hub-segx">') }), /member-level-adjust：页顶须有 \.hub-seg/],
    ['馆长页分段没绑切换', (s) => ({ ...s, curatorWxml: s.curatorWxml.replace('bindtap="onHubSegTap">调级<', '>调级<') }), /honorary-curators：分段里「调级」须绑/],
    ['切换跳错页', (s) => ({ ...s, levelJs: s.levelJs.replace(`const url = '${CURATOR_PATH}'`, `const url = '${LEVEL_PATH}'`) }), /member-level-adjust：onHubSegTap 须 redirectTo/],
    ['切换改弹 modal', (s) => ({ ...s, curatorJs: s.curatorJs.replace(/(onHubSegTap\(\)\s*\{)/, "$1\n    wx.showModal({ title: 'x' });") }), /不得弹原生 modal/],
    ['分段改零余量 calc', (s) => ({ ...s, curatorWxss: s.curatorWxss.replace(/(\.hub-seg-item\s*\{[^}]*?)flex:\s*1;/, '$1width: calc(50% - 8rpx);') }), /flex: 1 等分|calc/]
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
      console.error(TAG, `selftest 失败：「${name}」${changed ? '未被检出' : '注入未生效（锚点失配）'}`)
      bad++
    }
  }
  if (bad) process.exit(1)
  console.log(TAG, `selftest ok（${cases.length} 条注入全部检出）`)
  process.exit(0)
}

const errs = collect(src)
if (errs.length) {
  errs.forEach((e) => console.error(TAG, e))
  process.exit(1)
}
console.log(TAG, 'pass')
