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
 *   9) 2026-10-01 展示改版·方案 A（产品负责人点名，见 judgeLayout）：N1 不再有小金点 / 双圈 / 长按这类要解释的暗号、
 *      N2 每个入口都有一句大白话说明、N3 待处理横条包含所有带角标的入口（同一种红色数字）、N4「编辑」是常用的显式入口、
 *      N5 搜索只在入口 > 20 的角色出现、N6 每个分区单独一块卡片、入口全部直接可见（2026-10-10 撤回手风琴）；常用本地 key 不变。
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

/** 分区开标签（hub-grp 独立卡片；wx:if 与锚点 id 必须一致） */
const SEC_RE = /<view class="hub-grp[^"]*" wx:if="\{\{hubSec\.(\w+)\}\}" id="hub-sec-(\w+)">/g

function parseTiles(wxml, errs) {
  const secs = []
  let m
  const secRe = new RegExp(SEC_RE.source, 'g')
  while ((m = secRe.exec(wxml))) {
    if (m[1] !== m[2]) errs.push(`分区开标签 id 不一致：wx:if=${m[1]} / 锚点=${m[2]}（显隐与折叠会对不上）`)
    secs.push({ id: m[1], at: m.index })
  }
  const looseSecs = (wxml.match(/<view class="hub-grp[\s"]/g) || []).length
  if (looseSecs !== secs.length) errs.push(`有 ${looseSecs - secs.length} 个分区开标签不是「class="hub-grp…" wx:if="{{hubSec.<id>}}" id="hub-sec-<id>"」形态`)
  const tiles = []
  const tileRe = /<view class="hub-row"[^>]*>/g
  while ((m = tileRe.exec(wxml))) {
    const tag = m[0]
    const after = wxml.slice(m.index + tag.length, m.index + tag.length + 900)
    const lm = after.match(/<text class="hub-row-name">([^<]+)<\/text>/)
    const label = lm ? lm[1].trim() : ''
    const dm = after.match(/<text class="hub-row-desc">([^<]*)<\/text>/)
    const im = after.match(/<image class="hub-ico-img" src="([^"]+)"/)
    let sec = null
    for (const s of secs) if (s.at < m.index) sec = s.id
    const close = closeOf(wxml, m.index)
    const t = {
      tag,
      label,
      sec,
      body: close > 0 ? wxml.slice(m.index + tag.length, close) : '',
      desc: dm ? dm[1].trim() : '',
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
  for (const t of tiles) if (!t.sec) errs.push(`磁贴「${t.label}」不在任何 hub-grp 分区内`)

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
  // 入口区：搜索 → 待办 → 扫码 → 常用（金卡 / 经营信号在其上方，不进本扫描）+ 全部功能列表
  const hubTop = (src.wxml.match(/<!-- 功能搜索[\s\S]*?<!-- 瀑布流布局容器/) || [''])[0]
  if (!hubTop) errs.push('找不到首屏入口块（功能搜索 → 瀑布流布局容器之间；守卫锚点需要同步更新）')
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
  // 保存：编辑面板经 persistFavs —— 先归一化再按角色写回同一 key，其它角色的保存值原样保留（旧数据不丢）
  const persist = (src.indexJs.match(/\nfunction persistFavs\(page, ids\) \{([\s\S]*?)\n\}/) || [])[1] || ''
  if (!/hubNav\.normalizeFavs\(/.test(persist) || !/setStorageSync\(hubNav\.FAV_STORAGE_KEY, store\)/.test(persist) ||
    !/const store = readFavStore\(\)/.test(persist) || !/store\[page\.data\.workspaceRole \|\| 'unknown'\] = /.test(persist)) {
    errs.push('onFavSave 须先归一化（映射 / 权限 / 上限）再写本地 storage：persistFavs 须 normalizeFavs → 读整份 store → 只改本角色 → 写回 FAV_STORAGE_KEY')
  }
  const favSave = (src.indexJs.match(/\n  onFavSave\(\) \{([\s\S]*?)\n  \},/) || [])[1] || ''
  if (!/persistFavs\(this, /.test(favSave)) errs.push('onFavSave 须先归一化（映射 / 权限 / 上限）再写本地 storage（经 persistFavs）')
  if (!/function loadFavIds[\s\S]{0,300}hubNav\.normalizeFavs\([\s\S]{0,120}hubNav\.defaultFavs\(/.test(src.indexJs)) {
    errs.push('loadFavIds 须对已保存值归一化、未配置时用角色默认')
  }
  if (nav.FAV_STORAGE_KEY !== 'manager_hub_favs_v1') errs.push(`常用本地 key 须保持 manager_hub_favs_v1（当前 ${nav.FAV_STORAGE_KEY}）—— 换 key 等于把已有收藏全部弄丢`)
  judgeLayout(src, nav, roles, tiles, secs, errs)
  return errs
}

/**
 * 2026-10-01 展示改版·方案 A（产品负责人点名）：
 *   N1 不再有需要解释的暗号 —— 无常用小金点（hub-pin / hubPinned）、无双圈（is-group / is-stack）、无长按手势、无副标题 / 折角箭头，
 *      可见文案里也不再出现「长按」「双圈」之类的说明；列表行内部只有「图标 / 名称 + 说明 / 红色数字角标 / ›」，样式里不加别的点状标记；
 *   N2 每个入口都有一句大白话说明 —— 清单 desc 非空、≤ 16 字、无英文字母与技术词，且与列表行里的说明逐字一致；
 *   N3 待处理横条包含所有带角标的入口 —— 每个入口角标的数据源都映射到 HUB_TODOS（badge / merged），权限键一致；
 *      三角色计数全 > 0 时实跑；新单未读合并在待发订单数里；横条用同一枚 hub-badge 红色数字；
 *      首屏顺序 信息流 → 搜索（超管）→ 待处理 → 金卡 → 经营信号 → 扫码 → 常用 → 全部功能；
 *   N4「编辑」是常用的显式入口（常用区右上角，tap-press，打开编辑面板），全工作台没有长按加入；
 *   N5 搜索只在入口 > 20 的角色出现（超管有、店长 / 店员没有），按名称 / 别名 / 分组名 / 子项名找，只在有权限的入口里找；
 *   N6 每个分区单独一块描边卡片、组头只有分区名、入口列表无条件显示（所有角色都不折叠；2026-10-10 产品负责人撤回手风琴）。
 *   另：列表行同一规格（class 只许 hub-row、tap-press 80ms、data-fid = 清单 id），二级面板入口点按走 openHubGroup（底部 sheet）。
 */
function menuOf(roles, role) {
  const menu = {}
  Object.values(roles.MENU_KEYS).forEach((k) => { menu[k] = roles.canSeeMenu(role, k) })
  return menu
}

const DESC_MAX = 16
const DESC_TECH = /[A-Za-z]|云函数|接口|字段|集合|数据库|参数|缓存|配置项|权限键|同步率/

function judgeLayout(src, nav, roles, tiles, secs, errs) {
  const wx = src.wxml.replace(/<!--[\s\S]*?-->/g, '')
  const css = src.hubWxss.replace(/\/\*[\s\S]*?\*\//g, '')
  const entries = nav.HUB_ENTRIES || []
  const pageCode = `${src.config}\n${src.indexJs}`
  const sigOf = (t) => `${t.bindtap}|${t.idx || ''}|${t.tab || ''}|${t.dataGroup || ''}`
  const entrySig = (e) => `${e.tap}|${e.idx != null ? String(e.idx) : ''}|${e.tab || ''}|${e.group || ''}`
  const SUPER = roles.WORKSPACE_SUPER_ADMIN
  const MGR = roles.WORKSPACE_STORE_MANAGER
  const STAFF = roles.WORKSPACE_STORE_STAFF
  const ROLES3 = [[SUPER, '超管'], [MGR, '店长'], [STAFF, '店员']]

  // ── N1 暗号清零 ──
  for (const [re, what] of [
    [/hub-pin\b|hubPinned/, '常用小金点（hub-pin / hubPinned）'],
    [/is-group|is-stack/, '双圈 / 合并标记（is-group / is-stack）'],
    [/bindlongpress/, '长按手势（bindlongpress）'],
    [/hub-tile-sub/, '磁贴副标题（hub-tile-sub）']
  ]) {
    if (re.test(wx)) errs.push(`N1 工作台又出现${what} —— 需要靠说明文字解释的暗号已按产品负责人口径去掉`)
  }
  for (const [re, what] of [[/\.hub-pin\b/, '.hub-pin'], [/\.is-group|\.is-stack/, '.is-group / .is-stack'], [/::?after/, '::after 角标 / 折角'], [/\.hub-dot|\.dotr/, '额外的点状标记']]) {
    if (re.test(css)) errs.push(`N1 hubNav.wxss 又出现 ${what} 样式（只保留红色数字角标一种标记）`)
  }
  if (/\n  onHubPin\(|pinToggle/.test(src.indexJs) || /pinToggle/.test(src.hubNav)) errs.push('N1 长按加常用（onHubPin / pinToggle）应已移除 —— 常用只经「编辑」管理')
  const hubTop = (src.wxml.match(/<!-- 功能搜索[\s\S]*?<!-- 瀑布流布局容器/) || [''])[0]
  const hubCat = (src.wxml.match(/<view class="grid-item full-width hub-nav">[\s\S]*?<!-- 数据图表/) || [''])[0]
  const visible = [hubTop, hubCat].map((b) => b.replace(/<!--[\s\S]*?(-->|$)/g, '')).join('\n')
  for (const w of ['长按', '双圈', '金点']) {
    if (visible.includes(w)) errs.push(`N1 可见文案里出现「${w}」—— 要靠说明解释的交互就是失败的交互`)
  }
  for (const t of tiles) {
    const cls = (t.tag.match(/class="([^"]*)"/) || [])[1]
    if (cls !== 'hub-row') errs.push(`N1 入口「${t.label}」class="${cls}" —— 列表行只许 hub-row 一种`)
    if (t.hover !== 'tap-press' || attr(t.tag, 'hover-stay-time') !== '80') errs.push(`N1 入口「${t.label}」按压态须 hover-class="tap-press" hover-stay-time="80"`)
    const e = entries.find((x) => entrySig(x) === sigOf(t))
    if (!e || t.fid !== e.id) errs.push(`N1 入口「${t.label}」须 data-fid="${e ? e.id : '?'}"（= 清单 id）`)
    const body = t.body.replace(/<!--[\s\S]*?-->/g, '')
    const shape = /^\s*<view class="hub-ico"><image class="hub-ico-img" [^>]*\/><\/view>\s*<view class="hub-row-main"><text class="hub-row-name">[^<]+<\/text><text class="hub-row-desc">[^<]*<\/text><\/view>\s*((?:<view class="hub-badge( hub-badge--live)?" wx:(?:el)?if="[^"]+">[^<]*<\/view>\s*)*)<text class="hub-row-go">›<\/text>\s*$/.exec(body)
    if (!shape) errs.push(`N1 入口「${t.label}」内部须只有「图标 / 名称 + 说明 / 红色数字角标 / ›」，不得再加点、圈或别的标记`)
  }
  for (const e of entries) {
    if (e.group && e.tap !== 'openHubGroup') errs.push(`N1 有二级菜单的入口「${e.label}」须点按走 openHubGroup（底部 sheet 展开）`)
  }
  if (!/\n  openHubGroup\(e\) \{[\s\S]*?hubSheet: hubNav\.buildSheet\(id, this\.data\)/.test(src.indexJs)) errs.push('N1 openHubGroup 须用底部 sheet（hubSheet ← buildSheet）展开多个子项')

  // ── N2 每个入口都有说明 ──
  for (const e of entries) {
    const d = String(e.desc || '')
    if (!d.trim()) { errs.push(`N2 入口「${e.label}」没有说明（每个入口都要一句大白话）`); continue }
    if (d.length > DESC_MAX) errs.push(`N2 入口「${e.label}」说明 ${d.length} 字，超过 ${DESC_MAX} 字（一行放不下）：${d}`)
    const tech = d.match(DESC_TECH)
    if (tech) errs.push(`N2 入口「${e.label}」说明里有技术词 / 英文「${tech[0]}」：${d}`)
    const t = tiles.find((x) => sigOf(x) === entrySig(e))
    if (t && t.desc !== d) errs.push(`N2 入口「${e.label}」列表行说明「${t.desc}」与清单「${d}」不一致`)
  }

  // ── N3 待处理横条包含所有带角标的入口 ──
  const todos = nav.HUB_TODOS || []
  const sourceOf = (expr) => (expr.replace(/menu\.\w+ &&/, '').match(/([A-Za-z_]\w*)(?:\.length)? > 0/) || [])[1]
  const todoOf = (v) => todos.find((x) => x.badge === v || x.merged === v)
  for (const t of tiles) {
    const badges = t.body.match(/<view class="hub-badge"[^>]*?wx:(?:el)?if="\{\{([^}]*)\}\}"/g) || []
    for (const b of badges) {
      const expr = b.match(/wx:(?:el)?if="\{\{([^}]*)\}\}"/)[1]
      const gate = (expr.match(/menu\.(\w+) &&/) || [])[1]
      const v = sourceOf(expr)
      if (!v) { errs.push(`N3 入口「${t.label}」角标条件「${expr}」读不出数据源`); continue }
      const td = todoOf(v)
      if (!td) { errs.push(`N3 待处理横条缺「${t.label}」的角标（数据源 ${v}）—— 带角标的入口都要汇总到顶部`); continue }
      const want = gate ? [gate] : t.keys
      if (!setEq(uniq(td.keys), want)) errs.push(`N3 待办「${td.label}」权限键 [${td.keys}] 与入口「${t.label}」角标口径 [${want}] 不一致`)
      if (!hasMethod(pageCode, td.tap)) errs.push(`N3 待办「${td.label}」入口 ${td.tap} 不存在`)
    }
  }
  const allCounts = {
    orders: [1, 2], newOrderUnreadCount: 3, customOrders: [1], supportTickets: [1], framerRecruitApps: [1],
    approvalPendingCount: 2, invoicePendingCount: 1, giftTodoCount: 4
  }
  for (const [role, label] of ROLES3) {
    const menu = menuOf(roles, role)
    let todo
    try {
      todo = nav.buildTodos({ ...allCounts, menu })
    } catch (e) {
      errs.push(`N3 buildTodos 执行失败：${e.message}`)
      break
    }
    for (const t of tiles) {
      if (!/class="hub-badge"/.test(t.body) || !t.keys.some((k) => menu[k])) continue
      const expr = (t.body.match(/<view class="hub-badge"[^>]*?wx:(?:el)?if="\{\{([^}]*)\}\}"/) || [])[1] || ''
      const gate = (expr.match(/menu\.(\w+) &&/) || [])[1]
      if (gate && !menu[gate]) continue
      const td = todoOf(sourceOf(expr))
      if (td && !todo.items.some((it) => it.id === td.id)) errs.push(`N3 ${label}：入口「${t.label}」有角标，待处理横条却没有「${td.label}」`)
    }
    if (menu.orders) {
      const only = nav.buildTodos({ menu, orders: [], newOrderUnreadCount: 3 }).items.find((it) => it.id === 'orders')
      if (!only || only.count !== '3') errs.push(`N3 ${label}：只有新单未读（3）时待发订单没算进去 —— 新单未读合并在待发订单数里`)
    }
  }
  if (!/<view\s+class="hub-todo-chip"\s+wx:for="\{\{hubTodo\.items\}\}"[\s\S]{0,120}bindtap="onHubTodo"[\s\S]{0,80}hover-class="tap-press"[\s\S]{0,200}<text class="hub-badge">\{\{item\.count\}\}<\/text>/.test(src.wxml)) {
    errs.push('N3 待处理横条须按 hubTodo.items 渲染、绑 onHubTodo、tap-press，计数用同一枚 hub-badge 红色数字')
  }
  const at = (re) => { const m = re.exec(src.wxml); return m ? m.index : -1 }
  const feedAt = at(/<!-- 信息流跑马灯/)
  const searchAt = at(/<view class="hub-search" wx:if="\{\{hubCat\.search\}\}">/)
  const todoAt = at(/<view class="hub-todo" wx:if="\{\{hubTodo\.items\.length\}\}">/)
  const kpiAt = at(/<view class="kpi-card gold-card"/)
  const signalAt = at(/<view class="ops-signal-board/)
  const ctaAt = at(/<view class="hub-scan-cta"/)
  const favAt = at(/<view class="hub-fav">/)
  const catAt = at(/<view class="grid-item full-width hub-nav">/)
  if ([feedAt, searchAt, todoAt, kpiAt, signalAt, ctaAt, favAt, catAt].some((x) => x < 0)
    || !(feedAt < searchAt && searchAt < todoAt && todoAt < kpiAt && kpiAt < signalAt && signalAt < ctaAt && ctaAt < favAt && favAt < catAt)) {
    errs.push('N3 首屏顺序须为「信息流 → 搜索（超管）→ 待处理横条 → 金卡 → 经营信号 → 扫码主按钮 → 我的常用 → 全部功能」')
  }

  // ── N4「编辑」是常用的显式入口 ──
  const favBlock = (src.wxml.match(/<view class="hub-fav">[\s\S]*?<!-- 瀑布流布局容器/) || [''])[0]
  if (!/<view class="hub-fav-head">[\s\S]{0,300}<view class="hub-fav-edit" bindtap="openFavEditor" hover-class="tap-press" hover-stay-time="80">编辑<\/view>/.test(favBlock)) {
    errs.push('N4 常用区右上角须有「编辑」按钮（hub-fav-edit → openFavEditor，tap-press）—— 加入常用要有显式入口')
  }
  if (!hasMethod(src.indexJs, 'openFavEditor')) errs.push('N4 openFavEditor 不存在')
  if (!/还没有常用入口[^<]*「编辑」/.test(favBlock)) errs.push('N4 常用为空时须指向「编辑」')

  // ── N5 搜索只在入口 > 20 的角色出现 ──
  if (!/<view class="hub-search" wx:if="\{\{hubCat\.search\}\}">[\s\S]{0,400}<input [^>]*bindinput="onHubSearch"/.test(src.wxml)) errs.push('N5 搜索框须 wx:if="{{hubCat.search}}" 并绑 onHubSearch')
  if (!/<view\s+class="hub-row"\s+wx:for="\{\{hubFound\}\}"[\s\S]{0,120}bindtap="onHubFav"/.test(src.wxml)) errs.push('N5 搜索结果须按 hubFound 渲染、点按走 onHubFav（进入前再判权限）')
  if (!/\n  onHubSearch\(e\) \{[\s\S]{0,300}hubNav\.searchEntries\(/.test(src.indexJs)) errs.push('N5 onHubSearch 须经 hubNav.searchEntries')
  for (const [role, label] of ROLES3) {
    const menu = menuOf(roles, role)
    let cat
    try { cat = nav.buildCatalog(menu) } catch (e) { errs.push(`N5 buildCatalog 执行失败：${e.message}`); return }
    const n = entries.filter((e) => e.keys.some((k) => menu[k])).length
    if (cat.hubCat.total !== n) errs.push(`N5 ${label}：全部功能计数 ${cat.hubCat.total} ≠ 可见入口 ${n}`)
    if (cat.hubCat.search !== (n > 20)) errs.push(`N5 ${label}：可见入口 ${n} 个，搜索框应${n > 20 ? '显示' : '隐藏'}（hubCat.search=${cat.hubCat.search}）`)
  }
  if (nav.buildCatalog(menuOf(roles, SUPER)).hubCat.search !== true) errs.push('N5 超管须有搜索框')
  if (nav.buildCatalog(menuOf(roles, MGR)).hubCat.search !== false) errs.push('N5 店长不应出搜索框（入口 ≤ 20）')
  try {
    const sm = { menu: menuOf(roles, SUPER) }
    const first = (q) => (nav.searchEntries(q, sm)[0] || {}).id
    if (first('审批') !== 'approvals') errs.push('N5 超管搜「审批」首条须为审批（按名称）')
    if (first('运费') !== 'rules') errs.push('N5 超管搜「运费」须找到规则配置（按别名 / 子项名）')
    if (first('出货') !== 'shipment') errs.push('N5 超管搜「出货」首条须为出货中心')
    const studio = nav.searchEntries('工作室', sm).map((x) => x.id)
    if (!['studioDashboard', 'purchase', 'inventory'].every((id) => studio.includes(id))) errs.push('N5 超管搜分组名「工作室」须列出该组入口')
    if (nav.searchEntries('飞书', { menu: menuOf(roles, MGR) }).length) errs.push('N5 搜索须只在有权限的入口里找（店长搜到了飞书同步）')
    if (nav.searchEntries('  ', sm).length) errs.push('N5 空白搜索词不应出结果')
  } catch (e) {
    errs.push(`N5 searchEntries 执行失败：${e.message}`)
  }

  // ── N6 每个分区单独一块卡片、入口全部直接可见（2026-10-10 撤回手风琴） ──
  const catBlock = (src.wxml.match(/<view class="hub-cat" id="hub-cat">[\s\S]*?<!-- 数据图表/) || [''])[0]
  if (/<view class="hub-cat-body"/.test(catBlock)) errs.push('N6 全部功能又被包进一整块面板（hub-cat-body）—— 每个分区须单独一块卡片')
  if (!/<view class="hub-cat-head">\s*<view class="hub-titles">\s*<text class="hub-en">ALL FUNCTIONS<\/text>\s*<text class="hub-cn">全部功能<\/text>/.test(catBlock)) {
    errs.push('N6 全部功能标题须为英文小标题 + 中文主标两行（hub-titles / ALL FUNCTIONS / 全部功能）')
  }
  for (const s of secs) {
    const close = closeOf(src.wxml, s.at)
    const body = close > 0 ? src.wxml.slice(s.at, close) : ''
    const open = (body.match(/^<view [^>]*>/) || [''])[0]
    if (!/^<view class="hub-grp" wx:if=/.test(open)) errs.push(`N6 分区 ${s.id} 开标签须只用 class="hub-grp"（不带折叠态 class）`)
    if (!new RegExp(`<view class="hub-grp-head">\\s*<text class="hub-grp-title">[^<]+</text>\\s*</view>`).test(body)) errs.push(`N6 分区 ${s.id} 组头须只有分区名（不能点、无箭头 / 芯片）`)
    const lists = body.match(/<view class="hub-list"[^>]*>/g) || []
    if (lists.length !== 1 || lists[0] !== '<view class="hub-list">') errs.push(`N6 分区 ${s.id} 入口列表须恰好一个且无条件显示（<view class="hub-list">）`)
  }
  for (const [code, file] of [[wx, 'index.wxml'], [src.indexJs, 'index.js'], [src.hubNav, 'hubNav.js']]) {
    const m = code.match(/hubFold|hubPeek|onHubFold|is-folded/)
    if (m) errs.push(`N6 ${file} 仍有折叠残留「${m[0]}」—— 入口须全部直接可见`)
  }
  if (/\.hub-grp-(arrow|chip|accent|peek|mark)|\.hub-cat-body|\.is-folded/.test(css)) errs.push('N6 hubNav.wxss 仍有手风琴专用样式（箭头 / 芯片 / 色条 / 整块面板）')
  if (!/\.hub-grp \{[^}]*border: 1rpx solid[^}]*border-radius: 24rpx/.test(css)) errs.push('N6 .hub-grp 须是独立描边圆角卡片')
  for (const [role, label] of ROLES3) {
    const menu = menuOf(roles, role)
    const cat = nav.buildCatalog(menu)
    if (Object.keys(cat).some((k) => k !== 'hubCat')) errs.push(`N6 ${label}：buildCatalog 只应返回 hubCat（当前 ${Object.keys(cat)}）—— 不再有折叠状态`)
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
    console.log(`${TAG} ✓ 改版前 ${ORIGINAL.length} 个入口均可达、权限条件未变、无重复磁贴、分区与合并面板口径一致、清单 ↔ 磁贴 ${(loadNavEntries(base)).length} 枚逐枚一致、常用区权限 / 映射 / 上限 / 默认值成立（超管 / 店长 / 店员 / 标本师四角色实跑）；无暗号标记、每个入口有大白话说明、待处理横条含全部角标入口、「编辑」显式管理常用、搜索只给入口 > 20 的角色、每个分区单独成块且入口全部可见（三角色实跑）`)
  }
} else {
  const rep = (key, from, to) => (s) => {
    if (!s[key].includes(from)) throw new Error(`注入锚点失效：${key} 里找不到 ${from.slice(0, 60)}`)
    return { ...s, [key]: s[key].replace(from, to) }
  }
  const cases = [
    // 不误报对照：清单与磁贴同步改名、入口与权限仍在 → 必须仍通过
    ['飞书同步同步改名', (s) => rep('hubNav', "label: '飞书同步'", "label: '飞书'")(rep('wxml', '<text class="hub-row-name">飞书同步</text>', '<text class="hub-row-name">飞书</text>')(s)), null],
    ['直达磁贴整枚删除', (s) => {
      const m = s.wxml.match(/\n\s*<view class="hub-row" hover-class="tap-press" hover-stay-time="80" data-fid="feishu"[\s\S]*?<text class="hub-row-go">›<\/text>\s*<\/view>/)
      if (!m) throw new Error('注入锚点失效：飞书同步磁贴')
      return { ...s, wxml: s.wxml.replace(m[0], '') }
    }, /入口丢失：改版前的「飞书同步」/],
    ['面板子项生日礼包被删', rep('hubNav', "      { id: 'birthdayGift',", "      // { id: 'birthdayGift',"), /入口丢失：改版前的「生日礼包」/],
    ['重复磁贴（账本复制一枚）', (s) => {
      const m = s.wxml.match(/<view class="hub-row"[^>]*data-idx="8"[^>]*>[\s\S]*?<text class="hub-row-go">›<\/text>\s*<\/view>/)
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
    ['磁贴移出分区', rep('wxml', '<view class="hub-todo" wx:if="{{hubTodo.items.length}}">', '<view class="hub-row" hover-class="tap-press" hover-stay-time="80" wx:if="{{menu.ledger}}" bindtap="goLedgerX"><text class="hub-row-name">散落</text></view>\n      <view class="hub-todo" wx:if="{{hubTodo.items.length}}">'), /不在任何 hub-grp 分区内/],
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
    ['常用编辑新增原生弹窗', (s) => ({ ...s, indexJs: s.indexJs.replace('  onFavReset() {', '  onFavReset() {\n    wx.showModal({ title: "恢复默认？" })') }), /wx\.showModal/],
    // N1 不再有要解释的暗号
    ['N1 常用小金点复活', rep('wxml', '<text class="hub-row-go">›</text>', '<view class="hub-pin" wx:if="{{hubPinned.orders}}"></view>\n              <text class="hub-row-go">›</text>'), /N1 工作台又出现常用小金点/],
    ['N1 双圈复活（常用区）', rep('wxml', '        <view class="hub-ico">\n          <image class="hub-ico-img" src="{{item.icon}}"', "        <view class=\"hub-ico {{item.group ? 'is-stack' : ''}}\">\n          <image class=\"hub-ico-img\" src=\"{{item.icon}}\""), /N1 工作台又出现双圈/],
    ['N1 双圈样式复活', (s) => ({ ...s, hubWxss: `${s.hubWxss}\n.hub-ico.is-stack { border: 2rpx solid #C4A76C; }\n` }), /N1 hubNav\.wxss 又出现 \.is-group/],
    ['N1 长按加常用复活', rep('wxml', 'data-fid="points" wx:if', 'data-fid="points" bindlongpress="onHubPin" wx:if'), /N1 工作台又出现长按手势/],
    ['N1 说明行又靠文字解释暗号', rep('wxml', '<text class="hub-cat-count">{{hubCat.total}} 项</text>', '<text class="hub-cat-count">{{hubCat.total}} 项 · 长按加入常用</text>'), /N1 可见文案里出现「长按」/],
    ['N1 列表行多一个红点', rep('wxml', '<text class="hub-row-name">账本</text><text class="hub-row-desc">', '<text class="hub-row-name">账本</text><view class="hub-dot"></view><text class="hub-row-desc">'), /N1 入口「账本」内部须只有/],
    ['N1 入口按压退回本地类', rep('wxml', 'hover-class="tap-press" hover-stay-time="80" data-fid="ledger"', 'hover-class="hub-press" hover-stay-time="80" data-fid="ledger"'), /N1 入口「账本」按压态/],
    ['N1 二级菜单入口不再走 sheet', rep('hubNav', "tap: 'openHubGroup', group: 'rules'", "tap: 'goRules', group: 'rules'"), /N1 有二级菜单的入口「规则配置」须点按走 openHubGroup|清单入口 rules/],
    // N2 每个入口都有说明
    ['N2 入口说明被清空', (s) => rep('hubNav', "desc: '房租、水电和物业费'", "desc: ''")(rep('wxml', '<text class="hub-row-desc">房租、水电和物业费</text>', '<text class="hub-row-desc"></text>')(s)), /N2 入口「物业」没有说明/],
    ['N2 说明里混进技术词', (s) => rep('hubNav', "desc: '工作室打包发货'", "desc: '工作室发货 SKU'")(rep('wxml', '<text class="hub-row-desc">工作室打包发货</text>', '<text class="hub-row-desc">工作室发货 SKU</text>')(s)), /N2 入口「出货中心」说明里有技术词/],
    ['N2 说明太长一行放不下', (s) => rep('hubNav', "desc: '顾客申请的发票，开好再回复'", "desc: '顾客申请的发票，开好之后再在这里回复顾客'")(rep('wxml', '<text class="hub-row-desc">顾客申请的发票，开好再回复</text>', '<text class="hub-row-desc">顾客申请的发票，开好之后再在这里回复顾客</text>')(s)), /N2 入口「发票」说明 \d+ 字/],
    ['N2 列表说明与清单漂移', rep('wxml', '<text class="hub-row-desc">每天收了多少钱，一笔笔对得上</text>', '<text class="hub-row-desc">营收</text>'), /N2 入口「账本」列表行说明/],
    // N3 待处理横条包含所有带角标的入口
    ['N3 待办漏掉发票', rep('hubNav', "  { id: 'invoice', label: '发票', keys: ['invoice'], badge: 'invoicePendingCount', tap: 'goInvoiceRequests' },\n", ''), /N3 待处理横条缺「发票」的角标/],
    ['N3 新单未读不再合并进待发', rep('hubNav', " merged: 'newOrderUnreadCount',", ''), /N3 待处理横条缺「订单」的角标（数据源 newOrderUnreadCount）|新单未读合并/],
    ['N3 待办权限键写宽', rep('hubNav', "{ id: 'recruit', label: '合作申请', keys: ['framerRecruit']", "{ id: 'recruit', label: '合作申请', keys: ['framers', 'framerRecruit']"), /N3 待办「合作申请」权限键/],
    ['N3 计数为 1 的项被吞', rep('hubNav', '    if (n <= 0) return\n', '    if (n <= 1) return\n'), /N3 .*待处理横条却没有/],
    ['N3 横条计数换成另一种标记', rep('wxml', '<text class="hub-badge">{{item.count}}</text>', '<text class="hub-todo-num">{{item.count}}</text>'), /N3 待处理横条须按 hubTodo\.items 渲染/],
    ['N3 搜索待办挪到金卡之后', (s) => {
      const m = s.wxml.match(/  <!-- 功能搜索[\s\S]*?\n  <!-- 核心指标卡片/)
      if (!m) throw new Error('注入锚点失效：搜索+待办块')
      const block = m[0].replace(/\n  <!-- 核心指标卡片$/, '\n')
      // 把搜索+待办挪到经营信号之后，破坏「信息流 → 搜索 → 待处理 → 金卡」顺序
      return { ...s, wxml: s.wxml.replace(m[0], '\n  <!-- 核心指标卡片').replace('  <!-- 首屏主 CTA', `${block}  <!-- 首屏主 CTA`) }
    }, /N3 首屏顺序须为/],
    // N4「编辑」入口
    ['N4 编辑按钮被删', rep('wxml', '<view class="hub-fav-edit" bindtap="openFavEditor" hover-class="tap-press" hover-stay-time="80">编辑</view>', ''), /N4 常用区右上角须有「编辑」按钮/],
    ['N4 空态不再指向编辑', rep('wxml', '<text>还没有常用入口，点右上角「编辑」挑选</text>', '<text>还没有常用入口</text>'), /N4 常用为空时须指向「编辑」/],
    // N5 搜索只在入口 > 20 的角色出现
    ['N5 搜索给所有角色', rep('hubNav', 'return { hubCat: { total: vis.length, search: vis.length > MANY_ENTRIES } }', 'return { hubCat: { total: vis.length, search: true } }'), /N5 店长：可见入口 16 个，搜索框应隐藏/],
    ['N5 搜索框不再受开关控制', rep('wxml', '<view class="hub-search" wx:if="{{hubCat.search}}">', '<view class="hub-search">'), /N5 搜索框须 wx:if/],
    ['N5 搜索不按权限过滤', rep('hubNav', '  visibleEntries(d.menu).forEach((e, i) => {', '  HUB_ENTRIES.forEach((e, i) => {'), /N5 搜索须只在有权限的入口里找/],
    ['N5 搜索不认别名', rep('hubNav', 'return [e.label, ...(e.alias || []), sec.title, sec.short, ...subs]', 'return [e.label, sec.title, sec.short]'), /N5 超管搜「运费」/],
    ['N5 搜索不认分组名', rep('hubNav', 'return [e.label, ...(e.alias || []), sec.title, sec.short, ...subs]', 'return [e.label, ...(e.alias || []), ...subs]'), /N5 超管搜分组名「工作室」/],
    // N6 每个分区单独一块、入口全部可见
    ['N6 分区列表又被折叠', rep('wxml', '<view class="hub-grp" wx:if="{{hubSec.biz}}" id="hub-sec-biz">\n          <view class="hub-grp-head">\n            <text class="hub-grp-title">经营数据</text>\n          </view>\n          <view class="hub-list">', '<view class="hub-grp" wx:if="{{hubSec.biz}}" id="hub-sec-biz">\n          <view class="hub-grp-head">\n            <text class="hub-grp-title">经营数据</text>\n          </view>\n          <view class="hub-list" wx:if="{{!hubFold.biz}}">'), /N6 分区 biz 入口列表须恰好一个且无条件显示/],
    ['N6 组头又能点开收起', rep('wxml', '          <view class="hub-grp-head">\n            <text class="hub-grp-title">工作室</text>', '          <view class="hub-grp-head" bindtap="onHubFold" data-sec="studio" hover-class="tap-press" hover-stay-time="80">\n            <text class="hub-grp-title">工作室</text>'), /N6 分区 studio 组头须只有分区名/],
    ['N6 分区又并进一整块面板', (s) => rep('wxml', '<view class="hub-grp" wx:if="{{hubSec.orders}}"', '<view class="hub-cat-body">\n        <view class="hub-grp" wx:if="{{hubSec.orders}}"')(rep('wxml', '          </view>\n        </view>\n      </view>\n    </view>\n\n    <!-- 数据图表', '          </view>\n        </view>\n        </view>\n      </view>\n    </view>\n\n    <!-- 数据图表')(s)), /N6 全部功能又被包进一整块面板/],
    ['N6 分区开标签带折叠态', rep('wxml', '<view class="hub-grp" wx:if="{{hubSec.org}}"', "<view class=\"hub-grp {{hubFold.org ? 'is-folded' : 'is-open'}}\" wx:if=\"{{hubSec.org}}\""), /N6 分区 org 开标签须只用 class="hub-grp"/],
    ['N6 buildCatalog 回流折叠状态', rep('hubNav', '  return { hubCat: { total: vis.length, search: vis.length > MANY_ENTRIES } }', '  const hubFold = {}\n  return { hubCat: { total: vis.length, search: vis.length > MANY_ENTRIES }, hubFold }'), /N6 hubNav\.js 仍有折叠残留|buildCatalog 只应返回 hubCat/],
    ['N6 手风琴芯片样式回流', (s) => ({ ...s, hubWxss: `${s.hubWxss}\n.hub-grp-chip { width: 44rpx; }\n` }), /N6 hubNav\.wxss 仍有手风琴专用样式/],
    ['N6 分区卡片去掉描边', rep('hubWxss', '  border: 1rpx solid rgba(196, 167, 108, 0.14);\n  border-radius: 24rpx;\n  overflow: hidden;\n}\n.hub-grp-head', '  border-radius: 24rpx;\n  overflow: hidden;\n}\n.hub-grp-head'), /N6 \.hub-grp 须是独立描边圆角卡片/],
    ['N6 中英标题并成一行', rep('wxml', '<view class="hub-titles">\n            <text class="hub-en">ALL FUNCTIONS</text>\n            <text class="hub-cn">全部功能</text>\n          </view>', '<text class="hub-cn">全部功能 ALL FUNCTIONS</text>'), /N6 全部功能标题须为英文小标题/]
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
