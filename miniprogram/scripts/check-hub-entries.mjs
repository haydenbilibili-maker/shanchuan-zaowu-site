#!/usr/bin/env node
/**
 * 超管 / 店长工作台「功能入口清单」守卫（manager 域）
 *
 * 2026-09-30 产品负责人：工作台入口全局改版（七分区 + 待办条 + 合并磁贴二级面板）。
 * 合并与搬家最容易「顺手把一个功能弄丢」或「把权限条件写宽 / 写窄」，本守卫钉住：
 *   1) ORIGINAL 里改版前的 47 个磁贴/链接入口 + 首屏扫码主按钮，每个仍至少有一条可达路径：
 *      直接磁贴（bindtap + data-idx / data-tab 一致），或合并磁贴的二级面板子项（hubNav.HUB_GROUPS）；
 *   2) 权限条件不丢：直达磁贴的 wx:if 菜单键集合 = 改版前的集合；面板子项 keys = 改版前集合；
 *      合并磁贴 wx:if = 其子项 keys 之并（任一子功能有权限即显示）；
 *   3) 无重复磁贴（同入口 / 同名各只能一枚），每个合并面板恰好一枚磁贴；
 *   4) 分区：每枚磁贴都在某个 hub-sec 内，分区 wx:if 用 hubSec.<id>，且 HUB_SECTIONS[id].keys = 区内磁贴菜单键之并；
 *   5) 行为（真跑 hubNav.js + workspaceRoles.js）：超管 / 店长 / 店员 各角色下，改版前可见的入口改版后仍可达，
 *      改版前不可见的入口改版后也不出现；sectionFlags 不藏掉有可见磁贴的分区；单子项面板直接进入；
 *   6) 入口 handler 在页面上真实存在；hub 入口层不弹原生 modal；可见文案无技术字段名。
 *
 * 用法：node miniprogram/scripts/check-hub-entries.mjs [--selftest]
 * 自检全部在内存副本上注入，不写盘。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const TAG = '[check:hub-entries]'
const MGR = 'miniprogram/subpackages/manager/manager'
const FILES = {
  wxml: `${MGR}/index.wxml`,
  hubNav: `${MGR}/hubNav.js`,
  indexJs: `${MGR}/index.js`,
  config: `${MGR}/managerPageConfig.js`,
  roles: 'miniprogram/utils/workspaceRoles.js'
}

/**
 * 改版前（2026-09-30 之前）工作台的全部入口。handlers = 可接受的等价入口名（goX 与 goXGuarded 是同一门禁）。
 * 这是「功能不能丢」的基线 —— 只许加，不许删（删功能请先经产品负责人点名并在此注明）。
 */
const ORIGINAL = [
  { name: '账本', handlers: ['switchTab'], idx: '8', keys: ['ledger'] },
  { name: '订单', handlers: ['onOrdersMenuTap'], idx: '2', keys: ['orders'] },
  { name: '藏品', handlers: ['switchTab'], idx: '1', keys: ['products'] },
  { name: '报表', handlers: ['switchTab'], idx: '13', keys: ['analytics'] },
  { name: '运费', handlers: ['switchTab'], idx: '15', keys: ['shipping'] },
  { name: '活动', handlers: ['switchTab'], idx: '7', keys: ['activities'] },
  { name: '装修', handlers: ['switchTab'], idx: '4', keys: ['decor'] },
  { name: '内容', handlers: ['switchTab'], idx: '9', keys: ['content'] },
  { name: '主播', handlers: ['goLiveStudio'], keys: ['live'] },
  { name: '门店', handlers: ['switchTab'], idx: '12', keys: ['stores'] },
  { name: '开关', handlers: ['switchTab'], idx: '16', keys: ['contentFlags'] },
  { name: '仪表盘', handlers: ['goStudioDashboard', 'goStudioDashboardGuarded'], keys: ['studioDashboard'] },
  { name: '供应商管理', handlers: ['goSupplierWorkbench', 'goSupplierWorkbenchGuarded'], keys: ['supplierWorkbench'] },
  { name: '飞书同步', handlers: ['goFeishuSyncGuarded'], keys: ['feishuSync'] },
  { name: '工作室账单', handlers: ['goStudioBillsGuarded'], keys: ['studioBills'] },
  { name: '物业', handlers: ['goPropertyCost', 'goPropertyCostGuarded'], keys: ['propertyCost'] },
  { name: '采购', handlers: ['goPurchaseOps', 'goPurchaseOpsGuarded'], keys: ['purchaseOps'] },
  { name: '出货中心', handlers: ['goShipmentOps', 'goShipmentOpsGuarded'], keys: ['shipmentOps'] },
  { name: '库存管理', handlers: ['goInventoryOps', 'goInventoryOpsGuarded'], keys: ['inventoryOps', 'rawInventoryOps'] },
  { name: '标本师管理', handlers: ['switchTab'], idx: '5', keys: ['framers'] },
  { name: '工单', handlers: ['switchTab'], idx: '10', keys: ['workOrders'] },
  { name: '合作申请', handlers: ['switchTab'], idx: '14', keys: ['framerRecruit'] },
  { name: '会员 CRM', handlers: ['goMemberCrm', 'goMemberCrmGuarded'], keys: ['memberCrm'] },
  { name: '权益', handlers: ['switchTab'], idx: '6', keys: ['vip'] },
  { name: '有信', handlers: ['switchTab'], idx: '11', keys: ['support'] },
  { name: '会员调级', handlers: ['goMemberCuratorHub', 'goMemberCuratorHubGuarded'], keys: ['memberLevelAdjust', 'honoraryCurators'] },
  { name: 'AI 鉴定', handlers: ['goIdentifyMonitorGuarded'], keys: ['aiIdentifyMonitor'] },
  { name: '员工', handlers: ['goStaffDirectory', 'goStaffDirectoryGuarded'], keys: ['staffDirectory'] },
  { name: '权限配置', handlers: ['goStoreStaffPermissions', 'goStoreStaffPermissionsGuarded'], keys: ['staffPermissions'] },
  { name: '股东配置', handlers: ['goShareholderConfig', 'goShareholderConfigGuarded'], keys: ['shareholderConfig'] },
  { name: '核销验票', handlers: ['goStaffTab'], tab: 'verify', keys: ['verify'] },
  { name: '审批中心', handlers: ['goApprovals', 'goApprovalsGuarded'], keys: ['approvals'] },
  { name: '积分管理', handlers: ['goStorePoints', 'goStorePointsGuarded'], keys: ['points'] },
  { name: '工作微信通知', handlers: ['enableStaffOrderWxNotify'], keys: ['orders'] },
  { name: '发票管理', handlers: ['goInvoiceRequests', 'goInvoiceRequestsGuarded'], keys: ['invoice'] },
  { name: '礼赠履约', handlers: ['goGiftOps', 'goGiftOpsGuarded'], keys: ['giftOps'] },
  { name: '礼赠管理', handlers: ['goGiftManage', 'goGiftManageGuarded'], keys: ['giftManage'] },
  { name: '工资维护', handlers: ['goPayslipAdminGuarded'], keys: ['payslipAdmin'] },
  { name: '工资条明细', handlers: ['goMyPayslipGuarded'], keys: ['myPayslip'] },
  { name: '钱包配置', handlers: ['goWalletConfig', 'goWalletConfigGuarded'], keys: ['walletConfig'] },
  { name: '新会员礼包', handlers: ['goWelcomeGift', 'goWelcomeGiftGuarded'], keys: ['welcomeGift'] },
  { name: '生日礼包', handlers: ['goBirthdayGift', 'goBirthdayGiftGuarded'], keys: ['welcomeGift'] },
  { name: '售罄孤品定金', handlers: ['goDepositOps', 'goDepositOpsGuarded'], keys: ['depositOps'] },
  { name: '标本师提成', handlers: ['goArtisanCommission', 'goArtisanCommissionGuarded'], keys: ['artisanCommission'] },
  { name: '预约规则', handlers: ['goBookingRules', 'goBookingRulesGuarded'], keys: ['bookingRules'] },
  { name: '客服入口', handlers: ['goSupportConfig', 'goSupportConfigGuarded'], keys: ['supportConfig'] },
  { name: '店员工作台', handlers: ['goStaffHome'], keys: ['staffConsole'] }
]

/** 界面可见文案里不应出现的技术字段 / 集合名（小写比较） */
const TECH_WORDS = ['openid', 'unionid', '_id', 'collection', 'storeid', 'fileid', 'cloud://', 'staff_members', 'orders_', 'undefined', 'null']

function loadSrc() {
  const src = {}
  for (const [k, rel] of Object.entries(FILES)) {
    const p = resolve(ROOT, rel)
    if (!existsSync(p)) {
      console.error(TAG, '缺少', rel)
      process.exit(1)
    }
    src[k] = readFileSync(p, 'utf8')
  }
  return src
}

function evalCjs(code) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, () => {
    throw new Error('hubNav.js / workspaceRoles.js 不应 require 其它模块（守卫按纯模块加载）')
  })
  return mod.exports
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name.replace(/[:]/g, '\\:')}="([^"]*)"`))
  return m ? m[1] : null
}
const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
const uniq = (arr) => [...new Set(arr)]

function menuKeysOf(expr, errs, where) {
  const inner = String(expr || '').replace(/^\{\{|\}\}$/g, '').trim()
  if (!inner) return []
  const parts = inner.split('||').map((s) => s.trim())
  const keys = []
  for (const p of parts) {
    const m = p.match(/^menu\.(\w+)$/)
    if (!m) {
      errs.push(`${where}：wx:if 只能是 menu.<键> 用 || 连接（当前「${inner}」）—— 混入其它条件会让权限口径偏离菜单`)
      return keys
    }
    keys.push(m[1])
  }
  return uniq(keys)
}

function parseTiles(wxml, errs) {
  const secRe = /<view class="hub-sec" wx:if="\{\{hubSec\.(\w+)\}\}">/g
  const secs = []
  let m
  while ((m = secRe.exec(wxml))) secs.push({ id: m[1], at: m.index })
  const tiles = []
  const tileRe = /<view class="hub-tile(?: is-group)?"[^>]*>/g
  while ((m = tileRe.exec(wxml))) {
    const tag = m[0]
    const after = wxml.slice(m.index + tag.length, m.index + tag.length + 900)
    const lm = after.match(/<text>([^<]+)<\/text>/)
    const label = lm ? lm[1].trim() : ''
    let sec = null
    for (const s of secs) if (s.at < m.index) sec = s.id
    const t = {
      tag,
      label,
      sec,
      group: /class="hub-tile is-group"/.test(tag),
      bindtap: attr(tag, 'bindtap'),
      idx: attr(tag, 'data-idx'),
      tab: attr(tag, 'data-tab'),
      dataGroup: attr(tag, 'data-group'),
      wxif: attr(tag, 'wx:if')
    }
    t.keys = menuKeysOf(t.wxif, errs, `磁贴「${label || tag.slice(0, 60)}」`)
    if (!t.wxif) errs.push(`磁贴「${label}」没有 wx:if 权限条件`)
    tiles.push(t)
  }
  return { tiles, secs }
}

function hasMethod(code, name) {
  const re = new RegExp(`\\n\\s{2}(?:async\\s+)?${name}\\s*\\(|\\n\\s{2}${name}\\s*:\\s*(?:async\\s+)?function|\\n\\s{2}${name}\\s*,`)
  return re.test(code)
}

function judge(src) {
  const errs = []
  let nav
  let roles
  try {
    nav = evalCjs(src.hubNav)
  } catch (e) {
    return [`hubNav.js 加载失败：${e.message}`]
  }
  try {
    roles = evalCjs(src.roles)
  } catch (e) {
    return [`workspaceRoles.js 加载失败：${e.message}`]
  }
  const { tiles, secs } = parseTiles(src.wxml, errs)
  const pageCode = `${src.config}\n${src.indexJs}`
  const groups = nav.HUB_GROUPS || {}
  const sections = nav.HUB_SECTIONS || []

  // 3) 无重复磁贴
  const sigs = new Map()
  const labels = new Map()
  for (const t of tiles) {
    const sig = `${t.bindtap}|${t.idx || ''}|${t.tab || ''}|${t.dataGroup || ''}`
    if (sigs.has(sig)) errs.push(`重复磁贴：「${t.label}」与「${sigs.get(sig)}」指向同一入口（${sig}）`)
    else sigs.set(sig, t.label)
    if (labels.has(t.label)) errs.push(`重复磁贴：名称「${t.label}」出现不止一次`)
    else labels.set(t.label, true)
  }

  // 2) 合并磁贴
  const groupTiles = tiles.filter((t) => t.bindtap === 'openHubGroup')
  for (const t of groupTiles) {
    if (!t.group) errs.push(`磁贴「${t.label}」打开二级面板却没有 is-group 标记（右上角折角）`)
    const g = groups[t.dataGroup]
    if (!g) {
      errs.push(`合并磁贴「${t.label}」的 data-group="${t.dataGroup}" 在 HUB_GROUPS 里不存在`)
      continue
    }
    const union = uniq(g.items.flatMap((it) => it.keys))
    if (!setEq(t.keys, union)) {
      errs.push(`合并磁贴条件不等于子项权限之并：「${t.label}」wx:if=[${t.keys}]，子项=[${union}]（任一子功能有权限即显示）`)
    }
  }
  for (const gid of Object.keys(groups)) {
    const n = groupTiles.filter((t) => t.dataGroup === gid).length
    if (n !== 1) errs.push(`合并面板 ${gid} 须恰好一枚磁贴（当前 ${n}）—— 否则子功能无入口或重复`)
    for (const it of groups[gid].items) {
      if (!hasMethod(pageCode, it.tap)) errs.push(`面板子项「${it.label}」的入口 ${it.tap} 在页面上不存在`)
    }
  }
  for (const t of tiles) {
    if (t.group && t.bindtap !== 'openHubGroup') errs.push(`磁贴「${t.label}」标了 is-group 却不打开面板`)
    if (t.bindtap !== 'openHubGroup' && !hasMethod(pageCode, t.bindtap)) {
      errs.push(`磁贴「${t.label}」的入口 ${t.bindtap} 在页面上不存在`)
    }
  }

  // 1) + 2) 原有入口可达、权限不丢
  const matchEntry = (o, handler, idx, tab) =>
    o.handlers.includes(handler) && (o.idx ? String(idx || '') === o.idx : true) && (o.tab ? tab === o.tab : true)
  for (const o of ORIGINAL) {
    const direct = tiles.filter((t) => matchEntry(o, t.bindtap, t.idx, t.tab))
    const viaGroup = []
    for (const [gid, g] of Object.entries(groups)) {
      for (const it of g.items) {
        if (matchEntry(o, it.tap, it.idx != null ? String(it.idx) : '', it.dataset && it.dataset.tab)) viaGroup.push({ gid, it })
      }
    }
    if (!direct.length && !viaGroup.length) {
      errs.push(`入口丢失：改版前的「${o.name}」在工作台已无任何可达入口（磁贴或二级面板）`)
      continue
    }
    for (const t of direct) {
      if (!setEq(t.keys, o.keys)) errs.push(`权限条件变化：「${o.name}」磁贴 wx:if=[${t.keys}]，改版前=[${o.keys}]`)
    }
    for (const { gid, it } of viaGroup) {
      if (!setEq(uniq(it.keys), o.keys)) errs.push(`权限条件变化：「${o.name}」在面板 ${gid} 的 keys=[${it.keys}]，改版前=[${o.keys}]`)
      if (!groupTiles.some((t) => t.dataGroup === gid)) errs.push(`入口丢失：「${o.name}」所在面板 ${gid} 没有磁贴`)
    }
  }
  // 扫码主按钮
  if (!/<view class="hub-scan-cta" wx:if="\{\{menu\.verify \|\| menu\.grantPoints \|\| menu\.staffConsole\}\}">[\s\S]{0,200}bindtap="goScanMember"/.test(src.wxml)) {
    errs.push('入口丢失：首屏「扫顾客会员码」主按钮（menu.verify || menu.grantPoints || menu.staffConsole → goScanMember）')
  }

  // 4) 分区
  const secIds = sections.map((s) => s.id)
  for (const s of secs) if (!secIds.includes(s.id)) errs.push(`分区 hubSec.${s.id} 在 HUB_SECTIONS 里没有定义`)
  for (const s of sections) {
    if (!secs.some((x) => x.id === s.id)) {
      errs.push(`HUB_SECTIONS.${s.id}（${s.title}）在 index.wxml 里没有分区块`)
      continue
    }
    const union = uniq(tiles.filter((t) => t.sec === s.id).flatMap((t) => t.keys))
    if (!setEq(uniq(s.keys), union)) {
      errs.push(`分区「${s.title}」keys=[${s.keys}] 与区内磁贴菜单键之并=[${union}] 不一致 —— 分区可能被错误隐藏或空显示`)
    }
  }
  for (const t of tiles) if (!t.sec) errs.push(`磁贴「${t.label}」不在任何 hub-sec 分区内`)

  // 5) 行为：各角色下「改版前可见 ⇔ 改版后可达」
  const roleIds = [roles.WORKSPACE_SUPER_ADMIN, roles.WORKSPACE_STORE_MANAGER, roles.WORKSPACE_STORE_STAFF, roles.WORKSPACE_SPECIMEN_ARTISAN]
  for (const role of roleIds) {
    const menu = {}
    Object.values(roles.MENU_KEYS).forEach((k) => { menu[k] = roles.canSeeMenu(role, k) })
    let flags
    try {
      flags = nav.sectionFlags(menu)
    } catch (e) {
      errs.push(`sectionFlags 执行失败：${e.message}`)
      break
    }
    const visibleTile = (t) => t.keys.some((k) => menu[k]) && flags[t.sec] === true
    for (const o of ORIGINAL) {
      const before = o.keys.some((k) => menu[k])
      const direct = tiles.some((t) => matchEntry(o, t.bindtap, t.idx, t.tab) && visibleTile(t))
      let viaGroup = false
      for (const [gid, g] of Object.entries(groups)) {
        const gt = groupTiles.find((t) => t.dataGroup === gid)
        if (!gt || !visibleTile(gt)) continue
        let vis
        try {
          vis = nav.visibleItems(gid, menu)
        } catch (e) {
          errs.push(`visibleItems 执行失败：${e.message}`)
          vis = []
        }
        if (vis.some((it) => matchEntry(o, it.tap, it.idx != null ? String(it.idx) : '', it.dataset && it.dataset.tab))) viaGroup = true
      }
      const after = direct || viaGroup
      if (before && !after) errs.push(`角色 ${role}：「${o.name}」改版前可见，改版后不可达`)
      if (!before && after) errs.push(`角色 ${role}：「${o.name}」改版前不可见，改版后却能进入（权限被放宽）`)
    }
    for (const gid of Object.keys(groups)) {
      const vis = nav.visibleItems(gid, menu)
      const expect = groups[gid].items.filter((it) => it.keys.some((k) => menu[k]))
      if (vis.length !== expect.length) errs.push(`角色 ${role}：面板 ${gid} 可见子项 ${vis.length} 个，按权限应为 ${expect.length} 个`)
    }
  }
  // 单子项直接进入、多子项开面板
  const openBody = (src.indexJs.match(/\n  openHubGroup\(e\) \{([\s\S]*?)\n  \},/) || [])[1] || ''
  if (!/items\.length === 1\)[\s\S]{0,80}invokeItem\(this, items\[0\]\)/.test(openBody)) {
    errs.push('openHubGroup 须在只有一个可见子项时直接进入该子功能（不多点一层）')
  }
  if (!/hubNav\.visibleItems\(/.test(openBody)) errs.push('openHubGroup 须按权限过滤子项（hubNav.visibleItems）')

  // 6) 入口层不弹原生 modal；可见文案无技术字段
  for (const [k, code] of [['hubNav.js', src.hubNav], ['index.js', src.indexJs]]) {
    if (/wx\.showModal\s*\(/.test(code)) errs.push(`${k} 出现 wx.showModal —— 入口层不新增原生弹窗`)
  }
  const texts = []
  const hubBlock = (src.wxml.match(/<view class="grid-item full-width hub-nav">[\s\S]*?<!-- 数据图表/) || [''])[0]
  if (!hubBlock) errs.push('找不到 hub-nav 入口块（守卫锚点需要同步更新）')
  hubBlock.replace(/<!--[\s\S]*?-->/g, '').replace(/>([^<>{}]+)</g, (_, t) => { if (t.trim()) texts.push(t.trim()); return '' })
  for (const g of Object.values(groups)) for (const it of g.items) texts.push(it.label, it.desc)
  for (const t of nav.HUB_TODOS || []) texts.push(t.label)
  for (const s of sections) texts.push(s.title)
  for (const t of texts) {
    const low = String(t || '').toLowerCase()
    const hit = TECH_WORDS.find((w) => low.includes(w))
    if (hit) errs.push(`可见文案含技术字段「${hit}」：${t}`)
  }
  for (const t of nav.HUB_TODOS || []) {
    if (!hasMethod(pageCode, t.tap)) errs.push(`待办条「${t.label}」的入口 ${t.tap} 在页面上不存在`)
  }
  return errs
}

function run(src) {
  const errs = judge(src)
  return { ok: errs.length === 0, errs }
}

const selftest = process.argv.includes('--selftest')
const base = loadSrc()

if (!selftest) {
  const { ok, errs } = run(base)
  if (!ok) {
    console.error(`${TAG} ✗ ${errs.length} 处问题：`)
    errs.forEach((e) => console.error('  -', e))
    process.exitCode = 1
  } else {
    console.log(`${TAG} ✓ 改版前 ${ORIGINAL.length} 个入口均可达、权限条件未变、无重复磁贴、分区与合并面板口径一致（超管 / 店长 / 店员 / 标本师四角色实跑）`)
  }
} else {
  const rep = (key, from, to) => (s) => {
    if (!s[key].includes(from)) throw new Error(`注入锚点失效：${key} 里找不到 ${from.slice(0, 60)}`)
    return { ...s, [key]: s[key].replace(from, to) }
  }
  const cases = [
    // 不误报对照：只改磁贴名、入口与权限仍在 → 必须仍通过
    ['删掉飞书同步磁贴', rep('wxml', '<text>飞书同步</text>', '<text>飞书</text>'), null],
    ['直达磁贴整枚删除', (s) => ({ ...s, wxml: s.wxml.replace(/<view class="hub-tile" hover-class="hub-press" hover-stay-time="80" wx:if="\{\{menu\.feishuSync\}\}"[\s\S]*?<\/view>\s*<\/view>\s*<\/view>/, '</view>') }), /入口丢失：改版前的「飞书同步」/],
    ['面板子项生日礼包被删', rep('hubNav', "      { id: 'birthdayGift',", "      // { id: 'birthdayGift',"), /入口丢失：改版前的「生日礼包」/],
    ['重复磁贴（账本复制一枚）', (s) => {
      const m = s.wxml.match(/<view class="hub-tile"[^>]*data-idx="8"[^>]*>[\s\S]*?<text>账本<\/text>\s*<\/view>/)
      if (!m) throw new Error('注入锚点失效：账本磁贴')
      return { ...s, wxml: s.wxml.replace(m[0], `${m[0]}\n${m[0]}`) }
    }, /重复磁贴/],
    ['合并磁贴漏掉钱包权限', rep('wxml', 'wx:if="{{menu.welcomeGift || menu.walletConfig}}"', 'wx:if="{{menu.welcomeGift}}"'), /合并磁贴条件不等于子项权限之并/],
    ['直达磁贴权限被换', rep('wxml', 'wx:if="{{menu.depositOps}}"', 'wx:if="{{menu.orders}}"'), /权限条件变化：「售罄孤品定金」/],
    ['面板子项权限被放宽', rep('hubNav', "keys: ['payslipAdmin'], tap: 'goPayslipAdminGuarded'", "keys: ['payslipAdmin', 'myPayslip'], tap: 'goPayslipAdminGuarded'"), /权限条件变化：「工资维护」|权限被放宽/],
    ['分区 keys 漏一个', rep('hubNav', "'approvals', 'depositOps'] }", "'approvals'] }"), /分区「订单履约」/],
    ['visibleItems 不按权限过滤', rep('hubNav', 'return g.items.filter((it) => it.keys.some((k) => m[k] === true))', 'return g.items.slice()'), /权限被放宽|可见子项/],
    ['sectionFlags 恒 false', rep('hubNav', 'out[s.id] = s.keys.some((k) => m[k] === true)', 'out[s.id] = false'), /改版后不可达/],
    ['单子项不再直达', rep('indexJs', 'hubNav.invokeItem(this, items[0])', 'this.setData({ hubSheet: hubNav.buildSheet(id, this.data) })'), /只有一个可见子项时直接进入/],
    ['入口 handler 写错', rep('wxml', 'bindtap="goDepositOps"', 'bindtap="goDepositOpsX"'), /goDepositOpsX 在页面上不存在/],
    ['磁贴移出分区', (s) => ({ ...s, wxml: s.wxml.replace('<view class="hub-todo" wx:if="{{hubTodo.items.length}}">', '<view class="hub-tile" hover-class="hub-press" hover-stay-time="80" wx:if="{{menu.ledger}}" bindtap="goLedgerX"><text>散落</text></view>\n      <view class="hub-todo" wx:if="{{hubTodo.items.length}}">') }), /不在任何 hub-sec 分区内/],
    ['入口层新增原生弹窗', (s) => ({ ...s, indexJs: s.indexJs.replace('  closeHubGroup() {', '  closeHubGroup() {\n    wx.showModal({ title: "x" })') }), /wx\.showModal/],
    ['技术文案回流', rep('hubNav', "desc: '手机号 · 角色分配'", "desc: '手机号 · openid · 角色分配'"), /技术字段「openid」/],
    ['扫码主按钮丢失', rep('wxml', 'bindtap="goScanMember"', 'bindtap="goScanMemberOff"'), /扫顾客会员码/]
  ]
  let bad = 0
  const baseline = run(base)
  if (!baseline.ok) {
    console.error(`${TAG} selftest ✗ 基线本身不通过：`, baseline.errs)
    process.exit(1)
  }
  for (const [name, mut, expect] of cases) {
    let s
    try {
      s = mut(base)
    } catch (e) {
      console.error(`${TAG} selftest ✗ ${name}：${e.message}`)
      bad += 1
      continue
    }
    const r = run(s)
    if (name === '删掉飞书同步磁贴') {
      if (r.ok) console.log(`${TAG} selftest ✓ 不误报：${name}（只改磁贴名，入口与权限仍在）`)
      else { console.error(`${TAG} selftest ✗ 误报：${name} → ${r.errs[0]}`); bad += 1 }
      continue
    }
    const hit = !r.ok && r.errs.some((e) => expect.test(e))
    if (hit) console.log(`${TAG} selftest ✓ 检出：${name}`)
    else {
      console.error(`${TAG} selftest ✗ 未检出：${name}${r.errs.length ? ` → ${r.errs[0]}` : '（守卫仍通过）'}`)
      bad += 1
    }
  }
  if (bad) {
    console.error(`${TAG} selftest ✗ ${bad} 条注入未按预期`)
    process.exitCode = 1
  } else {
    console.log(`${TAG} selftest ✓ ${cases.length - 1} 个回归注入全部检出 + 1 个不误报对照（内存副本，不写盘）`)
  }
}
