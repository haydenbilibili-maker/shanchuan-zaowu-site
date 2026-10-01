#!/usr/bin/env node
/**
 * 超管 / 店长工作台「功能入口清单」守卫（manager 域）
 *
 * 2026-09-30 产品负责人：工作台入口全局改版（七分区 + 待办条 + 合并磁贴二级面板）。
 * 合并与搬家最容易「顺手把一个功能弄丢」或「把权限条件写宽 / 写窄」，本守卫钉住：
 *   1) ORIGINAL 里改版前的 48 个磁贴/链接入口（会员调级 / 荣誉馆长 09-30 拆回后各算一个） + 首屏扫码主按钮，每个仍至少有一条可达路径：
 *      直接磁贴（bindtap + data-idx / data-tab 一致），或合并磁贴的二级面板子项（hubNav.HUB_GROUPS）；
 *   2) 权限条件不丢：直达磁贴的 wx:if 菜单键集合 = 改版前的集合；面板子项 keys = 改版前集合；
 *      合并磁贴 wx:if = 其子项 keys 之并（任一子功能有权限即显示）；
 *   3) 无重复磁贴（同入口 / 同名各只能一枚），每个合并面板恰好一枚磁贴；
 *   4) 分区：每枚磁贴都在某个 hub-sec 内，分区 wx:if 用 hubSec.<id>，且 HUB_SECTIONS[id].keys = 区内磁贴菜单键之并；
 *   5) 行为（真跑 hubNav.js + workspaceRoles.js）：超管 / 店长 / 店员 各角色下，改版前可见的入口改版后仍可达，
 *      改版前不可见的入口改版后也不出现；sectionFlags 不藏掉有可见磁贴的分区；单子项面板直接进入；
 *   6) 入口 handler 在页面上真实存在；hub 入口层不弹原生 modal；可见文案无技术字段名；
 *   7) 统一清单 hubNav.HUB_ENTRIES ↔ index.wxml 分区磁贴逐枚一致（入口 / 名称 / 图标 / 权限键 / 分区），id 唯一；
 *   8) 「我的常用」：只含有权限入口、旧 id / 被合并 id 映射到现行 id、未知 id 过滤、上限 8 生效、各角色默认值存在且有效、
 *      点常用磁贴再判权限、保存前归一化、常用区按清单 wx:for 渲染；
 *   9) 2026-10-01 展示改版（产品负责人点名，见 judgeLayout）：L1 入口少的分组不独占一张大卡（5 列便当流排、三角色实排）、
 *      L2 所有入口规格一致、L3 待办聚合包含所有带角标的入口；常用本地 key 不变、长按加入同样过权限 / 上限 / 旧 id 映射。
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
  hubWxss: `${MGR}/hubNav.wxss`,
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
  // 2026-09-30 产品负责人：「会员调级」「荣誉馆长」从合并入口重新拆开，恢复合并前各自的权限键
  { name: '会员调级', handlers: ['goMemberLevelAdjust', 'goMemberLevelAdjustGuarded'], keys: ['memberLevelAdjust'] },
  { name: '荣誉馆长', handlers: ['goHonoraryCurators', 'goHonoraryCuratorsGuarded'], keys: ['honoraryCurators'] },
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

/** 分区开标签（2026-10-01 起带便当列数 span-{{hubSpan.<id>}} 与锚点 id="hub-sec-<id>"，三处 id 必须一致） */
const SEC_RE = /<view class="hub-sec span-\{\{hubSpan\.(\w+)\}\}" wx:if="\{\{hubSec\.(\w+)\}\}" id="hub-sec-(\w+)">/g

function parseTiles(wxml, errs) {
  const secs = []
  let m
  const secRe = new RegExp(SEC_RE.source, 'g')
  while ((m = secRe.exec(wxml))) {
    if (m[1] !== m[2] || m[2] !== m[3]) errs.push(`分区开标签 id 不一致：span=${m[1]} / wx:if=${m[2]} / 锚点=${m[3]}（列数、显隐、锚点会对不上）`)
    secs.push({ id: m[2], at: m.index })
  }
  const looseSecs = (wxml.match(/<view class="hub-sec[\s"]/g) || []).length
  if (looseSecs !== secs.length) errs.push(`有 ${looseSecs - secs.length} 个分区开标签不是「class="hub-sec span-{{hubSpan.<id>}}" wx:if="{{hubSec.<id>}}" id="hub-sec-<id>"」形态（小分区会退回整宽大卡 / 锚点失效）`)
  const tiles = []
  const tileRe = /<view class="hub-tile(?: is-group)?"[^>]*>/g
  while ((m = tileRe.exec(wxml))) {
    const tag = m[0]
    const after = wxml.slice(m.index + tag.length, m.index + tag.length + 900)
    const lm = after.match(/<text>([^<]+)<\/text>/)
    const label = lm ? lm[1].trim() : ''
    const im = after.match(/<image class="hub-ico-img" src="([^"]+)"/)
    let sec = null
    for (const s of secs) if (s.at < m.index) sec = s.id
    const close = closeOf(wxml, m.index)
    const t = {
      tag,
      label,
      sec,
      body: close > 0 ? wxml.slice(m.index + tag.length, close) : '',
      group: /class="hub-tile is-group"/.test(tag),
      bindtap: attr(tag, 'bindtap'),
      idx: attr(tag, 'data-idx'),
      tab: attr(tag, 'data-tab'),
      dataGroup: attr(tag, 'data-group'),
      fid: attr(tag, 'data-fid'),
      longpress: attr(tag, 'bindlongpress'),
      hover: attr(tag, 'hover-class'),
      wxif: attr(tag, 'wx:if'),
      icon: im ? im[1] : ''
    }
    t.keys = menuKeysOf(t.wxif, errs, `磁贴「${label || tag.slice(0, 60)}」`)
    if (!t.wxif) errs.push(`磁贴「${label}」没有 wx:if 权限条件`)
    tiles.push(t)
  }
  return { tiles, secs }
}

/** 从 <view 开标签位置配平找到它的 </view>（返回闭合标签起点；找不到 -1） */
function closeOf(wxml, at) {
  const re = /<view\b[^>]*?(\/?)>|<\/view>/g
  re.lastIndex = at
  let depth = 0
  let m
  while ((m = re.exec(wxml))) {
    if (m[0].startsWith('</')) {
      depth -= 1
      if (depth === 0) return m.index
    } else if (!m[1]) depth += 1
  }
  return -1
}

/** 极简 wxss 规则表：[{ sel, decls: { prop: value } }]（去注释；同选择器多次出现各算一条） */
function cssRules(css) {
  const out = []
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(src))) {
    const decls = {}
    m[2].split(';').forEach((d) => {
      const i = d.indexOf(':')
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim()
    })
    m[1].split(',').forEach((s) => out.push({ sel: s.trim().replace(/\s+/g, ' '), decls }))
  }
  return out
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
  const hubTop = (src.wxml.match(/<!-- 待办卡[\s\S]*?<!-- 核心指标卡片/) || [''])[0]
  if (!hubTop) errs.push('找不到首屏入口块（待办卡 → 核心指标卡片之间；守卫锚点需要同步更新）')
  const hubBlock = hubTop + ((src.wxml.match(/<view class="grid-item full-width hub-nav">[\s\S]*?<!-- 数据图表/) || [''])[0])
  if (!/hub-nav/.test(hubBlock)) errs.push('找不到 hub-nav 入口块（守卫锚点需要同步更新）')
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
  // 7) 统一清单 ↔ 分区磁贴
  const entries = nav.HUB_ENTRIES || []
  const ids = entries.map((e) => e.id)
  if (uniq(ids).length !== ids.length) errs.push('HUB_ENTRIES 的 id 有重复')
  const entrySig = (e) => `${e.tap}|${e.idx != null ? String(e.idx) : ''}|${e.tab || ''}|${e.group || ''}`
  for (const e of entries) {
    const hit = tiles.filter((t) => `${t.bindtap}|${t.idx || ''}|${t.tab || ''}|${t.dataGroup || ''}` === entrySig(e))
    if (hit.length !== 1) {
      errs.push(`清单入口 ${e.id}（${e.label}）在分区磁贴里应恰好一枚，实际 ${hit.length}`)
      continue
    }
    const t = hit[0]
    if (t.label !== e.label) errs.push(`清单与磁贴名称不一致：${e.id} 清单「${e.label}」磁贴「${t.label}」`)
    if (t.icon !== e.icon) errs.push(`清单与磁贴图标不一致：${e.id}`)
    if (!setEq(t.keys, uniq(e.keys))) errs.push(`清单与磁贴权限键不一致：${e.id} 清单=[${e.keys}] 磁贴=[${t.keys}]`)
    if (t.sec !== e.sec) errs.push(`清单与磁贴分区不一致：${e.id} 清单=${e.sec} 磁贴=${t.sec}`)
  }
  if (tiles.length !== entries.length) errs.push(`分区磁贴 ${tiles.length} 枚 ≠ 清单 ${entries.length} 条（有磁贴没进清单，常用区就挑不到它）`)

  // 8) 我的常用
  try {
    const superMenu = {}
    const mgrMenu = {}
    Object.values(roles.MENU_KEYS).forEach((k) => {
      superMenu[k] = roles.canSeeMenu(roles.WORKSPACE_SUPER_ADMIN, k)
      mgrMenu[k] = roles.canSeeMenu(roles.WORKSPACE_STORE_MANAGER, k)
    })
    if (nav.FAV_MAX !== 8) errs.push(`常用上限应为 8（当前 ${nav.FAV_MAX}）`)
    const allIds = entries.map((e) => e.id)
    const capped = nav.normalizeFavs(allIds, superMenu)
    if (capped.length > 8) errs.push(`常用上限未生效：超管全选后仍有 ${capped.length} 个`)
    const mgrOnly = nav.normalizeFavs(['memberCrm', 'feishu', 'orders', 'aiIdentify'], mgrMenu)
    if (JSON.stringify(mgrOnly) !== JSON.stringify(['orders'])) {
      errs.push(`常用区只含有权限入口：店长配置 [memberCrm, feishu, orders, aiIdentify] 应只剩 [orders]，实际 [${mgrOnly}]`)
    }
    const mapped = nav.normalizeFavs(['giftOps', 'memberCurator', 'honoraryCurators', 'shipmentSku', 'giftManage', 'no_such_entry'], superMenu)
    const want = ['gift', 'memberLevel', 'curators', 'shipment']
    if (JSON.stringify(mapped) !== JSON.stringify(want)) {
      errs.push(`失效 id 映射 / 过滤不对：[giftOps, memberCurator, honoraryCurators, shipmentSku, giftManage, no_such_entry] 应得 [${want}]，实际 [${mapped}]`)
    }
    for (const [from, to] of Object.entries(nav.FAV_ID_ALIASES || {})) {
      if (!nav.findEntry(to)) errs.push(`常用映射 ${from} → ${to} 指向不存在的入口`)
    }
    for (const g of Object.values(groups)) {
      for (const it of g.items) {
        if (!nav.findEntry(it.id) && !(nav.FAV_ID_ALIASES || {})[it.id]) errs.push(`被合并入口 ${it.id} 没有常用映射（旧配置会被静默丢掉）`)
      }
    }
    for (const [role, list] of Object.entries(nav.FAV_DEFAULTS || {})) {
      for (const id of list) if (!nav.findEntry(id)) errs.push(`默认常用 ${role} 含不存在的入口 ${id}`)
    }
    for (const [role, menu] of [[roles.WORKSPACE_SUPER_ADMIN, superMenu], [roles.WORKSPACE_STORE_MANAGER, mgrMenu]]) {
      const d = nav.defaultFavs(role, menu)
      if (!d.length) errs.push(`角色 ${role} 没有默认常用`)
      if (d.length > 8) errs.push(`角色 ${role} 默认常用超过上限`)
    }
    const full = allIds.slice(0, 8)
    if (nav.toggleFav(full, allIds[9]).length !== 8) errs.push('常用已满 8 个时 toggleFav 仍能加入')
    const view = nav.buildFavView(['orders', 'support'], { menu: superMenu, orders: [1, 2], supportTickets: [] })
    if (!view[0] || view[0].badge !== '2' || view[1].badge !== '') errs.push('常用区角标与分区磁贴口径不一致（订单 2 / 有信 0）')
  } catch (e) {
    errs.push(`常用区逻辑执行失败：${e.message}`)
  }
  if (!/<view\s+class="hub-tile hub-fav-tile"\s+wx:for="\{\{hubFav\}\}"[\s\S]{0,120}bindtap="onHubFav"/.test(src.wxml)) {
    errs.push('常用区须按清单 wx:for="{{hubFav}}" 渲染并绑 onHubFav')
  }
  if (!/bindtap="openFavEditor"/.test(src.wxml) || !/bindtap="onFavSave"/.test(src.wxml)) errs.push('常用区缺「编辑」入口或编辑面板的保存')
  const favTap = (src.indexJs.match(/\n  onHubFav\(e\) \{([\s\S]*?)\n  \},/) || [])[1] || ''
  if (!/entry\.keys\.some\(/.test(favTap)) errs.push('onHubFav 须在进入前再判一次权限（常用可能来自旧配置）')
  // 保存：编辑面板与长按加入共用 persistFavs —— 先归一化再按角色写回同一 key，其它角色的保存值原样保留（旧数据不丢）
  const persist = (src.indexJs.match(/\nfunction persistFavs\(page, ids\) \{([\s\S]*?)\n\}/) || [])[1] || ''
  if (!/hubNav\.normalizeFavs\(/.test(persist) || !/setStorageSync\(hubNav\.FAV_STORAGE_KEY, store\)/.test(persist) ||
    !/const store = readFavStore\(\)/.test(persist) || !/store\[page\.data\.workspaceRole \|\| 'unknown'\] = /.test(persist)) {
    errs.push('onFavSave 须先归一化（映射 / 权限 / 上限）再写本地 storage：persistFavs 须 normalizeFavs → 读整份 store → 只改本角色 → 写回 FAV_STORAGE_KEY')
  }
  const favSave = (src.indexJs.match(/\n  onFavSave\(\) \{([\s\S]*?)\n  \},/) || [])[1] || ''
  if (!/persistFavs\(this, /.test(favSave)) errs.push('onFavSave 须先归一化（映射 / 权限 / 上限）再写本地 storage（经 persistFavs）')
  const pinFn = (src.indexJs.match(/\n  onHubPin\(e\) \{([\s\S]*?)\n  \},/) || [])[1] || ''
  if (!/hubNav\.pinToggle\(/.test(pinFn) || !/persistFavs\(this, /.test(pinFn)) errs.push('长按加入常用 onHubPin 须经 hubNav.pinToggle（权限 / 上限）并经 persistFavs 保存')
  if (!/function loadFavIds[\s\S]{0,300}hubNav\.normalizeFavs\([\s\S]{0,120}hubNav\.defaultFavs\(/.test(src.indexJs)) {
    errs.push('loadFavIds 须对已保存值归一化、未配置时用角色默认')
  }
  if (nav.FAV_STORAGE_KEY !== 'manager_hub_favs_v1') errs.push(`常用本地 key 须保持 manager_hub_favs_v1（当前 ${nav.FAV_STORAGE_KEY}）—— 换 key 等于把已有收藏全部弄丢`)
  try {
    const mgrMenu = {}
    Object.values(roles.MENU_KEYS).forEach((k) => { mgrMenu[k] = roles.canSeeMenu(roles.WORKSPACE_STORE_MANAGER, k) })
    const add = nav.pinToggle(['orders'], 'ledger', mgrMenu)
    const del = nav.pinToggle(['orders', 'ledger'], 'orders', mgrMenu)
    const deny = nav.pinToggle(['orders'], 'feishu', mgrMenu)
    const full = nav.pinToggle(['orders', 'ledger', 'verify', 'approvals', 'workOrders', 'products', 'points', 'purchase'], 'staffConsole', mgrMenu)
    const legacy = nav.pinToggle(['giftOps', 'orders'], 'ledger', mgrMenu)
    if (JSON.stringify(add.ids) !== '["orders","ledger"]' || !add.added) errs.push('长按加入：未在末尾追加')
    if (JSON.stringify(del.ids) !== '["ledger"]' || del.added || !del.changed) errs.push('长按移出：已在常用的入口未被移出')
    if (deny.changed || deny.ids.includes('feishu')) errs.push('长按加入不按权限过滤：店长能把「飞书同步」加进常用')
    if (!full.full || full.changed || full.ids.length !== 8) errs.push('长按加入：常用已满 8 个时仍能加入')
    if (JSON.stringify(legacy.ids) !== '["gift","orders","ledger"]') errs.push(`长按加入未保留旧 id 映射：[giftOps, orders] + ledger 应得 [gift, orders, ledger]，实际 [${legacy.ids}]`)
  } catch (e) {
    errs.push(`长按加入逻辑执行失败：${e.message}`)
  }

  judgeLayout(src, nav, roles, tiles, secs, errs)
  return errs
}

/** 角色 → 菜单（与页面 applyWorkspaceRole 同源：canSeeMenu） */
function menuOf(roles, role) {
  const menu = {}
  Object.values(roles.MENU_KEYS).forEach((k) => { menu[k] = roles.canSeeMenu(role, k) })
  return menu
}

/** 便当流排模拟：按 CSS 的 span 值与 grid-auto-flow（dense = 首个放得下的行；否则只向后）排成行 */
function packRows(items, cols, dense) {
  const rows = []
  for (const it of items) {
    let row = null
    const from = dense ? 0 : Math.max(rows.length - 1, 0)
    for (let r = from; r < rows.length; r += 1) {
      if (rows[r].used + it.span <= cols) { row = rows[r]; break }
    }
    if (!row) { row = { used: 0, items: [] }; rows.push(row) }
    row.used += it.span
    row.items.push(it)
  }
  return rows
}

/**
 * 2026-10-01 展示改版新增（产品负责人点名）：
 *   L1 入口少的分组不独占一张大卡 —— 分区占列 = 可见入口数（封顶 5），CSS 把 span-N 落成 grid-column: span N，
 *      外层 5 列 + dense；按三角色实排，任意两个「独占一行的小分区」若能拼进一行即判红；店长不得超过 4 行；
 *   L2 所有入口规格一致 —— 磁贴只有 hub-tile / hub-tile is-group 两种 class，统一 tap-press、长按加常用、data-fid = 清单 id，
 *      内部只有「图标 + 名称 + 角标 / 常用金点」，无副标题 / 箭头；尺寸只在 .hub-tile / .hub-ico / .hub-ico-img / .hub-tile > text 定义，
 *      合并入口只许加双圈（border / box-shadow），常用区不得另设尺寸；
 *   L3 待办聚合包含所有带角标的入口 —— 分区磁贴每个计数角标的数据源都在 HUB_TODOS（badge 或 extra），权限键一致；
 *      三角色计数全 > 0 时，每枚可见的带角标磁贴都在待办卡里；待办卡与常用在核心指标卡之前（首屏）。
 */
function judgeLayout(src, nav, roles, tiles, secs, errs) {
  const rules = cssRules(src.hubWxss)
  const declOf = (sel, prop) => {
    let v = null
    rules.forEach((r) => { if (r.sel === sel && r.decls[prop] != null) v = r.decls[prop] })
    return v
  }

  // ── L1 ──
  const colsCss = declOf('.hub-cat-grid', 'grid-template-columns') || ''
  const colsM = colsCss.match(/^repeat\((\d+),/)
  const cols = colsM ? Number(colsM[1]) : 0
  if (cols !== nav.CAT_COLS) errs.push(`L1 全部功能外层须为 ${nav.CAT_COLS} 列网格（.hub-cat-grid 当前 grid-template-columns: ${colsCss || '无'}）`)
  const dense = /dense/.test(declOf('.hub-cat-grid', 'grid-auto-flow') || '')
  if (!dense) errs.push('L1 .hub-cat-grid 须 grid-auto-flow: row dense（小分区回填前面行的空位）')
  const spanCss = {}
  for (let n = 1; n <= 5; n += 1) {
    const v = declOf(`.hub-sec.span-${n}`, 'grid-column') || ''
    const m = v.match(/^span (\d+)$/)
    spanCss[n] = m ? Number(m[1]) : null
    if (spanCss[n] !== n) errs.push(`L1 .hub-sec.span-${n} 须 grid-column: span ${n}（当前 ${v || '无'}）—— 否则小分区又占整宽`)
    const inner = declOf(`.hub-grid.cols-${n}`, 'grid-template-columns') || ''
    if (!(n === 1 ? /^minmax\(0, 1fr\)$/.test(inner) : new RegExp(`^repeat\\(${n},`).test(inner))) errs.push(`L1 .hub-grid.cols-${n} 须 ${n} 列（当前 ${inner || '无'}）`)
  }
  for (const r of rules) {
    if (/^\.hub-sec(?![\w-])/.test(r.sel) && !/^\.hub-sec\.span-\d$/.test(r.sel) && (r.decls['grid-column'] != null || r.decls.width != null)) {
      errs.push(`L1 ${r.sel} 改了 grid-column / width —— 分区宽度只能由 span-N 决定`)
    }
  }
  for (const s of secs) {
    const close = closeOf(src.wxml, s.at)
    const body = close > 0 ? src.wxml.slice(s.at, close) : ''
    if (!new RegExp(`<view class="hub-grid cols-\\{\\{hubSpan\\.${s.id}\\}\\}">`).test(body)) errs.push(`L1 分区 ${s.id} 内层须 class="hub-grid cols-{{hubSpan.${s.id}}}"（列数与所占列一致，磁贴才同宽）`)
  }
  const catGrid = (src.wxml.match(/<view class="hub-cat-grid">/g) || []).length
  if (catGrid !== 1) errs.push(`L1 须恰好一个 .hub-cat-grid 容器（当前 ${catGrid}）`)
  for (const [role, label] of [[roles.WORKSPACE_SUPER_ADMIN, '超管'], [roles.WORKSPACE_STORE_MANAGER, '店长'], [roles.WORKSPACE_STORE_STAFF, '店员']]) {
    const menu = menuOf(roles, role)
    let cat
    try {
      cat = nav.buildCatalog(menu, [])
    } catch (e) {
      errs.push(`L1 buildCatalog 执行失败：${e.message}`)
      return
    }
    const items = []
    for (const s of secs) {
      const n = tiles.filter((t) => t.sec === s.id && t.keys.some((k) => menu[k])).length
      if (!n) continue
      const want = Math.min(n, 5)
      if (cat.hubSpan[s.id] !== want) errs.push(`L1 ${label}：分区 ${s.id} 可见 ${n} 枚，应占 ${want} 列，hubSpan=${cat.hubSpan[s.id]}`)
      items.push({ id: s.id, span: spanCss[cat.hubSpan[s.id]] || 5 })
    }
    const rows = packRows(items, cols || 5, dense)
    const lonely = rows.filter((r) => r.items.length === 1 && r.used < (cols || 5))
    for (let i = 0; i < lonely.length; i += 1) {
      for (let j = i + 1; j < lonely.length; j += 1) {
        if (lonely[i].used + lonely[j].used <= (cols || 5)) {
          errs.push(`L1 ${label}：小分区「${lonely[i].items[0].id}」「${lonely[j].items[0].id}」各占一整行，本可并排（一组一张大卡又回来了）`)
        }
      }
    }
    if (role === roles.WORKSPACE_STORE_MANAGER && rows.length > 4) errs.push(`L1 店长全部功能排成 ${rows.length} 行（${items.length} 个分区），应 ≤ 4 行（一屏放下）`)
    const total = items.length ? tiles.filter((t) => t.keys.some((k) => menu[k])).length : 0
    if (cat.hubCat.total !== total) errs.push(`L1 ${label}：全部功能计数 ${cat.hubCat.total} ≠ 可见磁贴 ${total}`)
    if ((total >= nav.ANCHOR_MIN_ENTRIES) !== (cat.hubCat.anchors.length > 0)) errs.push(`L1 ${label}：分组锚点显隐与入口数（${total}）不符`)
  }
  if (!/<view class="hub-anchors" wx:if="\{\{hubCat\.anchors\.length\}\}">[\s\S]{0,200}bindtap="onHubAnchor"/.test(src.wxml)) errs.push('L1 入口多时的分组锚点（hubCat.anchors → onHubAnchor）缺失')
  if (!/\n  onHubAnchor\(e\) \{[\s\S]{0,300}selector: `#hub-sec-\$\{id\}`/.test(src.indexJs)) errs.push('L1 onHubAnchor 须滚到 #hub-sec-<id>')

  // ── L2 ──
  const entries = nav.HUB_ENTRIES || []
  const sigOf = (t) => `${t.bindtap}|${t.idx || ''}|${t.tab || ''}|${t.dataGroup || ''}`
  const entrySig = (e) => `${e.tap}|${e.idx != null ? String(e.idx) : ''}|${e.tab || ''}|${e.group || ''}`
  for (const t of tiles) {
    const cls = (t.tag.match(/class="([^"]*)"/) || [])[1]
    if (cls !== 'hub-tile' && cls !== 'hub-tile is-group') errs.push(`L2 磁贴「${t.label}」class="${cls}" —— 只许 hub-tile / hub-tile is-group 两种`)
    if (t.hover !== 'tap-press' || attr(t.tag, 'hover-stay-time') !== '80') errs.push(`L2 磁贴「${t.label}」按压态须 hover-class="tap-press" hover-stay-time="80"（app.wxss 统一按压）`)
    const e = entries.find((x) => entrySig(x) === sigOf(t))
    if (t.longpress !== 'onHubPin' || !e || t.fid !== e.id) errs.push(`L2 磁贴「${t.label}」须 bindlongpress="onHubPin" data-fid="${e ? e.id : '?'}"（长按加常用，fid = 清单 id）`)
    if (t.group !== (t.bindtap === 'openHubGroup')) errs.push(`L2 磁贴「${t.label}」is-group 标记与是否打开二级面板不一致`)
    const body = t.body.replace(/<!--[\s\S]*?-->/g, '')
    const shape = /^\s*<view class="hub-ico">[\s\S]*?<image class="hub-ico-img" [^>]*\/>[\s\S]*?<\/view>\s*<text>[^<]+<\/text>\s*(<view class="hub-pin" wx:if="\{\{hubPinned\.(\w+)\}\}"><\/view>)?\s*$/.exec(body)
    if (!shape) errs.push(`L2 磁贴「${t.label}」内部须只有「图标（含角标）+ 名称 + 常用金点」，不得有副标题 / 箭头 / 额外文字`)
    else if (!shape[1] || (e && shape[2] !== e.id)) errs.push(`L2 磁贴「${t.label}」常用金点须为 hubPinned.${e ? e.id : '?'}`)
    const icoBody = (body.match(/<view class="hub-ico">([\s\S]*?)<\/view>\s*<text>/) || [])[1] || ''
    for (const v of icoBody.match(/<view class="[^"]*"/g) || []) {
      if (!/^<view class="hub-badge( hub-badge--live)?"$/.test(v)) errs.push(`L2 磁贴「${t.label}」图标里出现非角标元素 ${v}`)
    }
  }
  const wxNoComment = src.wxml.replace(/<!--[\s\S]*?-->/g, '')
  if (/hub-tile-sub/.test(wxNoComment) || /hub-tile-sub/.test(src.hubWxss)) errs.push('L2 磁贴副标题 hub-tile-sub 又出现了（礼赠「履约·管理」那种特例）')
  if (/is-group::?after/.test(src.hubWxss)) errs.push('L2 合并磁贴又用折角箭头（is-group::after）—— 统一用图标双圈')
  const favTile = (wxNoComment.match(/<view\s+class="hub-tile hub-fav-tile"[\s\S]*?<\/text>\s*<\/view>/) || [''])[0]
  if (!/<view class="hub-ico \{\{item\.group \? 'is-stack' : ''\}\}">\s*<image class="hub-ico-img" [^>]*\/>[\s\S]*?<\/view>\s*<text>\{\{item\.label\}\}<\/text>\s*<\/view>$/.test(favTile)) {
    errs.push('L2 常用磁贴须与全部功能同结构（hub-ico + hub-ico-img + 名称；合并入口同样双圈 is-stack）')
  }
  if (!/hover-class="tap-press"/.test(favTile)) errs.push('L2 常用磁贴按压态须 tap-press')
  const SIZE = /^(width|height|min-height|max-height|min-width|padding|padding-top|padding-bottom|margin|margin-top|font-size|line-height)$/
  const CANON = new Set(['.hub-tile', '.hub-ico', '.hub-ico-img', '.hub-tile > text'])
  for (const r of rules) {
    if (!/\.hub-tile|\.hub-ico|\.hub-fav-tile|\.is-group|\.is-stack/.test(r.sel) || CANON.has(r.sel)) continue
    if (/\.hub-fav-tile/.test(r.sel)) errs.push(`L2 常用磁贴另设样式 ${r.sel} —— 常用与全部功能同一规格`)
    if (/\.is-group|\.is-stack/.test(r.sel)) {
      const extra = Object.keys(r.decls).filter((p) => p !== 'border' && p !== 'box-shadow')
      if (extra.length) errs.push(`L2 合并入口 ${r.sel} 只许加双圈（border / box-shadow），多了 ${extra.join(' / ')}`)
      continue
    }
    const sized = Object.keys(r.decls).filter((p) => SIZE.test(p))
    if (sized.length) errs.push(`L2 ${r.sel} 另设了磁贴尺寸 ${sized.join(' / ')} —— 尺寸只在 .hub-tile / .hub-ico / .hub-ico-img / .hub-tile > text 定义`)
  }
  for (const sel of CANON) if (!rules.some((r) => r.sel === sel)) errs.push(`L2 缺统一磁贴规格 ${sel}`)

  // ── L3 ──
  const todos = nav.HUB_TODOS || []
  for (const t of tiles) {
    const body = t.body
    const badges = body.match(/<view class="hub-badge"[^>]*?wx:(?:el)?if="\{\{([^}]*)\}\}"/g) || []
    for (const b of badges) {
      const expr = b.match(/wx:(?:el)?if="\{\{([^}]*)\}\}"/)[1]
      const gate = (expr.match(/menu\.(\w+) &&/) || [])[1]
      const vm = expr.replace(/menu\.\w+ &&/, '').match(/([A-Za-z_]\w*)(?:\.length)? > 0/)
      if (!vm) {
        errs.push(`L3 磁贴「${t.label}」角标条件「${expr}」读不出数据源`)
        continue
      }
      const v = vm[1]
      const td = todos.find((x) => x.badge === v || x.extra === v)
      if (!td) {
        errs.push(`L3 待办卡缺「${t.label}」的角标（数据源 ${v}）—— 带角标的入口都要汇总到待办`)
        continue
      }
      const want = gate ? [gate] : t.keys
      if (!setEq(uniq(td.keys), want)) errs.push(`L3 待办「${td.label}」权限键 [${td.keys}] 与磁贴「${t.label}」角标口径 [${want}] 不一致`)
      if (!hasMethod(`${src.config}\n${src.indexJs}`, td.tap)) errs.push(`L3 待办「${td.label}」入口 ${td.tap} 不存在`)
    }
  }
  const allCounts = {
    orders: [1, 2], newOrderUnreadCount: 3, customOrders: [1], supportTickets: [1], framerRecruitApps: [1],
    approvalPendingCount: 2, invoicePendingCount: 1, giftTodoCount: 4
  }
  for (const role of [roles.WORKSPACE_SUPER_ADMIN, roles.WORKSPACE_STORE_MANAGER, roles.WORKSPACE_STORE_STAFF]) {
    const menu = menuOf(roles, role)
    let todo
    try {
      todo = nav.buildTodos({ ...allCounts, menu })
    } catch (e) {
      errs.push(`L3 buildTodos 执行失败：${e.message}`)
      break
    }
    for (const t of tiles) {
      if (!/class="hub-badge"/.test(t.body) || !t.keys.some((k) => menu[k])) continue
      const v = ((t.body.match(/<view class="hub-badge"[^>]*?wx:(?:el)?if="\{\{([^}]*)\}\}"/) || [])[1] || '')
      const gate = (v.match(/menu\.(\w+) &&/) || [])[1]
      if (gate && !menu[gate]) continue
      const src0 = (v.replace(/menu\.\w+ &&/, '').match(/([A-Za-z_]\w*)(?:\.length)? > 0/) || [])[1]
      const td = todos.find((x) => x.badge === src0 || x.extra === src0)
      if (td && !todo.items.some((it) => it.id === td.id)) errs.push(`L3 角色 ${role}：磁贴「${t.label}」有角标，待办卡却没有「${td.label}」`)
    }
    const ord = todo.items.find((it) => it.id === 'orders')
    if (menu.orders && (!ord || ord.extra !== '新3')) errs.push(`L3 角色 ${role}：新订单未读（订单磁贴角标的另一数据源）没进待办卡`)
  }
  const at = (re) => { const m = re.exec(src.wxml); return m ? m.index : -1 }
  const todoAt = at(/<view class="hub-todo" wx:if="\{\{hubTodo\.items\.length\}\}">/)
  const favAt = at(/<view class="hub-fav">/)
  const kpiAt = at(/<view class="kpi-card gold-card"/)
  const ctaAt = at(/<view class="hub-scan-cta"/)
  if (todoAt < 0 || favAt < 0 || kpiAt < 0 || !(todoAt < ctaAt && ctaAt < favAt && favAt < kpiAt)) {
    errs.push('L3 首屏顺序须为「待办卡 → 扫码主按钮 → 我的常用 → 核心指标卡」（待办优先、常用为首屏核心）')
  }
  if (!/<view\s+class="hub-todo-cell"\s+wx:for="\{\{hubTodo\.items\}\}"[\s\S]{0,120}bindtap="onHubTodo"[\s\S]{0,80}hover-class="tap-press-soft"/.test(src.wxml)) {
    errs.push('L3 待办格须按 hubTodo.items 渲染、绑 onHubTodo、按压 tap-press-soft')
  }
}

function loadNavEntries(src) {
  try { return evalCjs(src.hubNav).HUB_ENTRIES || [] } catch (e) { return [] }
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
    console.log(`${TAG} ✓ 改版前 ${ORIGINAL.length} 个入口均可达、权限条件未变、无重复磁贴、分区与合并面板口径一致、清单 ↔ 磁贴 ${(loadNavEntries(base)).length} 枚逐枚一致、常用区权限 / 映射 / 上限 / 默认值成立（超管 / 店长 / 店员 / 标本师四角色实跑）；便当流排不留整宽小卡、磁贴同规格、待办含全部角标入口（三角色实排）`)
  }
} else {
  const rep = (key, from, to) => (s) => {
    if (!s[key].includes(from)) throw new Error(`注入锚点失效：${key} 里找不到 ${from.slice(0, 60)}`)
    return { ...s, [key]: s[key].replace(from, to) }
  }
  const cases = [
    // 不误报对照：清单与磁贴同步改名、入口与权限仍在 → 必须仍通过
    ['飞书同步同步改名', (s) => rep('hubNav', "label: '飞书同步'", "label: '飞书'")(rep('wxml', '<text>飞书同步</text>', '<text>飞书</text>')(s)), null],
    ['直达磁贴整枚删除', (s) => {
      const m = s.wxml.match(/\n\s*<view class="hub-tile" hover-class="tap-press" hover-stay-time="80" data-fid="feishu"[\s\S]*?<view class="hub-pin" wx:if="\{\{hubPinned\.feishu\}\}"><\/view>\s*<\/view>/)
      if (!m) throw new Error('注入锚点失效：飞书同步磁贴')
      return { ...s, wxml: s.wxml.replace(m[0], '') }
    }, /入口丢失：改版前的「飞书同步」/],
    ['面板子项生日礼包被删', rep('hubNav', "      { id: 'birthdayGift',", "      // { id: 'birthdayGift',"), /入口丢失：改版前的「生日礼包」/],
    ['重复磁贴（账本复制一枚）', (s) => {
      const m = s.wxml.match(/<view class="hub-tile"[^>]*data-idx="8"[^>]*>[\s\S]*?<text>账本<\/text>\s*<view class="hub-pin"[^>]*><\/view>\s*<\/view>/)
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
    ['磁贴移出分区', rep('wxml', '<view class="hub-todo" wx:if="{{hubTodo.items.length}}">', '<view class="hub-tile" hover-class="tap-press" hover-stay-time="80" wx:if="{{menu.ledger}}" bindtap="goLedgerX"><text>散落</text></view>\n      <view class="hub-todo" wx:if="{{hubTodo.items.length}}">'), /不在任何 hub-sec 分区内/],
    ['入口层新增原生弹窗', (s) => ({ ...s, indexJs: s.indexJs.replace('  closeHubGroup() {', '  closeHubGroup() {\n    wx.showModal({ title: "x" })') }), /wx\.showModal/],
    ['技术文案回流', rep('hubNav', "desc: '手机号 · 角色分配'", "desc: '手机号 · openid · 角色分配'"), /技术字段「openid」/],
    ['扫码主按钮丢失', rep('wxml', 'bindtap="goScanMember"', 'bindtap="goScanMemberOff"'), /扫顾客会员码/],
    ['清单名称与磁贴漂移', rep('hubNav', "{ id: 'ledger', label: '账本'", "{ id: 'ledger', label: '营收'"), /清单与磁贴名称不一致/],
    ['常用不按权限过滤', rep('hubNav', 'if (!entryVisible(findEntry(id), menu)) return', 'if (!findEntry(id)) return'), /常用区只含有权限入口/],
    ['被合并 id 映射丢失', rep('hubNav', "giftOps: 'gift', giftManage: 'gift',", "giftManage: 'gift',"), /失效 id 映射/],
    ['旧合并入口 memberCurator 映射丢失', rep('hubNav', "memberCurator: 'memberLevel', ", ''), /失效 id 映射/],
    ['常用上限失效', rep('hubNav', 'return out.slice(0, FAV_MAX)', 'return out'), /常用上限未生效/],
    ['店长默认常用被清空', rep('hubNav', "store_manager: ['orders', 'ledger', 'verify', 'approvals', 'workOrders', 'gift', 'products', 'points'],", 'store_manager: [],'), /没有默认常用/],
    ['点常用不再判权限', rep('indexJs', 'if (!entry || !entry.keys.some((k) => this.data.menu && this.data.menu[k])) {', 'if (!entry) {'), /onHubFav 须在进入前再判一次权限/],
    ['保存不归一化', rep('indexJs', 'const clean = hubNav.normalizeFavs(ids, page.data.menu)', 'const clean = ids'), /onFavSave 须先归一化/],
    ['保存覆盖其它角色的常用', rep('indexJs', '  const store = readFavStore()\n  store[page.data.workspaceRole', '  const store = {}\n  store[page.data.workspaceRole'), /onFavSave 须先归一化/],
    ['常用本地 key 被换掉', rep('hubNav', "const FAV_STORAGE_KEY = 'manager_hub_favs_v1'", "const FAV_STORAGE_KEY = 'manager_hub_favs_v2'"), /manager_hub_favs_v1/],
    ['长按加入不判权限', rep('hubNav', "  if (!entryVisible(findEntry(id), menu)) return { ids: list, changed: false, added: false, full: false }\n", ''), /长按加入不按权限过滤/],
    ['长按加入不设上限', rep('hubNav', '  if (list.length >= FAV_MAX) return { ids: list, changed: false, added: false, full: true }\n', ''), /常用已满 8 个时仍能加入/],
    ['常用编辑新增原生弹窗', (s) => ({ ...s, indexJs: s.indexJs.replace('  onFavReset() {', '  onFavReset() {\n    wx.showModal({ title: "恢复默认？" })') }), /wx\.showModal/],
    // L1 入口少的分组不独占一张大卡
    ['L1 分区占列恒为整行', rep('hubNav', 'span[s.id] = Math.min(Math.max(n, 1), CAT_COLS)', 'span[s.id] = CAT_COLS'), /L1 店长：分区 biz 可见 1 枚，应占 1 列/],
    ['L1 CSS 把 span-1 落成整宽', rep('hubWxss', '.hub-sec.span-1 { grid-column: span 1; }', '.hub-sec.span-1 { grid-column: span 5; }'), /L1 \.hub-sec\.span-1 须 grid-column: span 1/],
    ['L1 分区卡强制整宽', rep('hubWxss', '.hub-sec {\n  min-width: 0;', '.hub-sec {\n  grid-column: 1 / -1;\n  min-width: 0;'), /L1 \.hub-sec 改了 grid-column/],
    ['L1 分区退回无列数的整卡', rep('wxml', '<view class="hub-sec span-{{hubSpan.biz}}" wx:if="{{hubSec.biz}}" id="hub-sec-biz">', '<view class="hub-sec" wx:if="{{hubSec.biz}}">'), /分区开标签不是/],
    ['L1 外层退回单列', rep('hubWxss', 'grid-template-columns: repeat(5, minmax(0, 1fr));\n  grid-auto-flow: row dense;', 'grid-template-columns: minmax(0, 1fr);\n  grid-auto-flow: row dense;'), /L1 全部功能外层须为 5 列/],
    ['L1 内层列数与所占列脱钩', rep('wxml', '<view class="hub-grid cols-{{hubSpan.members}}">', '<view class="hub-grid cols-4">'), /L1 分区 members 内层须/],
    ['L1 锚点 id 与分区不一致', rep('wxml', 'id="hub-sec-org">', 'id="hub-sec-orgs">'), /分区开标签 id 不一致/],
    // L2 所有入口规格一致
    ['L2 礼赠副标题复活', rep('wxml', '<text>礼赠</text>', '<text>礼赠</text>\n                <view class="hub-tile-sub">履约·管理</view>'), /L2 磁贴「礼赠」内部须只有|hub-tile-sub/],
    ['L2 折角箭头复活', (s) => ({ ...s, hubWxss: `${s.hubWxss}\n.hub-tile.is-group::after { content: ''; border-top: 3rpx solid #C4A76C; }\n` }), /is-group::after/],
    ['L2 常用磁贴另设尺寸', (s) => ({ ...s, hubWxss: `${s.hubWxss}\n.hub-fav-tile { height: 160rpx; }\n` }), /L2 常用磁贴另设样式/],
    ['L2 合并入口图标放大', rep('hubWxss', '.hub-ico.is-stack {\n  border:', '.hub-ico.is-stack {\n  width: 80rpx;\n  border:'), /L2 合并入口 .* 只许加双圈/],
    ['L2 某分区磁贴另设尺寸', (s) => ({ ...s, hubWxss: `${s.hubWxss}\n.hub-sec .hub-tile { height: 160rpx; }\n` }), /L2 \.hub-sec \.hub-tile 另设了磁贴尺寸/],
    ['L2 磁贴按压退回本地类', rep('wxml', 'hover-class="tap-press" hover-stay-time="80" data-fid="ledger"', 'hover-class="hub-press" hover-stay-time="80" data-fid="ledger"'), /L2 磁贴「账本」按压态/],
    ['L2 磁贴丢了长按加常用', rep('wxml', 'data-fid="points" bindlongpress="onHubPin" ', ''), /L2 磁贴「积分」须 bindlongpress/],
    ['L2 常用磁贴结构分叉', rep('wxml', "<view class=\"hub-ico {{item.group ? 'is-stack' : ''}}\">", '<view class="hub-ico hub-ico--big">'), /L2 常用磁贴须与全部功能同结构/],
    // L3 待办聚合包含所有带角标的入口
    ['L3 待办漏掉发票', rep('hubNav', "  { id: 'invoice', label: '发票', keys: ['invoice'], badge: 'invoicePendingCount', tap: 'goInvoiceRequests' },\n", ''), /L3 待办卡缺「发票」的角标/],
    ['L3 新订单未读不进待办', rep('hubNav', " extra: 'newOrderUnreadCount', extraLabel: '新',", ''), /L3 待办卡缺「订单」的角标（数据源 newOrderUnreadCount）|新订单未读/],
    ['L3 待办权限键写宽', rep('hubNav', "{ id: 'recruit', label: '合作申请', keys: ['framerRecruit']", "{ id: 'recruit', label: '合作申请', keys: ['framers', 'framerRecruit']"), /L3 待办「合作申请」权限键/],
    ['L3 待办计数为 0 的项被吞', rep('hubNav', '    if (n <= 0 && x <= 0) return\n', '    if (n <= 1) return\n'), /L3 角色 .*待办卡却没有/],
    ['L3 待办卡挪到核心指标卡之后', (s) => {
      const m = s.wxml.match(/  <!-- 待办卡[\s\S]*?\n  <!-- 首屏主 CTA/)
      if (!m) throw new Error('注入锚点失效：待办卡块')
      const block = m[0].replace(/\n  <!-- 首屏主 CTA$/, '\n')
      return { ...s, wxml: s.wxml.replace(m[0], '\n  <!-- 首屏主 CTA').replace('  <!-- 经营信号', `${block}  <!-- 经营信号`) }
    }, /L3 首屏顺序须为/]
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
    if (name === '飞书同步同步改名') {
      if (r.ok) console.log(`${TAG} selftest ✓ 不误报：${name}（清单与磁贴同步改名，入口与权限仍在）`)
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
