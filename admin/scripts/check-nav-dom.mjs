#!/usr/bin/env node
/**
 * 导航 / 深链的**浏览器 DOM** 验收守卫
 *
 * 为什么必须有它：静态单测只能证明数据层，证明不了「界面真的画出来了」。
 * 实测价值（2026-09-16）：本脚本第一次跑就抓到两个只有真 DOM 才会暴露的问题 ——
 *   1) 粘 `#/m/42` 打开退款审核：面包屑/主区/域返回条都已切换，但**标签栏仍只显示「经营驾驶舱」**，
 *      因为深链走的是 `activeTabId.value = id`，绕过了 `useTabsManager.openTab()`（已修）。
 *   2) App.vue 因 `<keep-alive>` 内塞了两个子节点而在 dev 管线编译失败，整页停在「加载中…」，
 *      而 `npm run build:admin` 依然退出码 0（已修，并由 check-sfc-dev-transform.mjs 兜住）。
 *
 * 依赖：需要先跑起验收环境 `npm run dev:admin`（默认 http://localhost:5178/admin/）。
 * 本脚本自己拉起无头 Chrome（CDP 直连，零依赖），不需要 puppeteer。
 *
 * 用法：
 *   npm run dev:admin            # 另一个终端
 *   node admin/scripts/check-nav-dom.mjs
 *   node admin/scripts/check-nav-dom.mjs --selftest   # 改坏源文件，证明守卫能失败
 */
'use strict'

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome } from './lib/cdp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADMIN = resolve(HERE, '..')
const REGISTRY = resolve(ADMIN, 'src', 'utils', 'modulesRegistry.js')

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const BASE = argOf('--base', process.env.ADMIN_BASE_URL || 'http://localhost:5178/admin/')
const TOKEN = 'verified_888'

/**
 * 冻结快照：一级导航的**用户可见名称与顺序**。
 *
 * 为什么不能只跟派生数据比：那等于「DOM 与它自己的来源比」，把来源改名后两边一起变，
 * 断言照样通过（自检里实测过这个漏洞）。改名是产品决策，必须显式改这里，
 * 否则守卫就是空的。
 */
const FROZEN_SIDEBAR = ['经营驾驶舱', '总览决策', '业务运营', '工作室', '客户经营', '小程序配置', '组织治理', '战略与知识']

/**
 * 冻结快照：曾经「同屏两名」的 6 个条目，锁死在注册表名上。
 * 回归方向是被人改回导航大屏里的短名（物业/采购/库存同步/工单/山海有信/智能中心）。
 * 键为所属域，值为该域内必须出现的条目名。
 */
const FROZEN_ENTRY_NAMES = {
  'nav-studio': ['物业成本', '采购管理', '飞书同步中心', '标本定制工单'],
  'nav-customer': ['山海有信工单'],
  'nav-intelligence': ['AI 智能中心'],
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function assertServerUp() {
  try {
    const res = await fetch(BASE, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    throw new Error(
      `验收环境不可达：${BASE}（${e.message}）。\n` +
      '请先在另一个终端执行 `npm run dev:admin`，或用 --base 指定地址。'
    )
  }
}

/** 读侧栏 DOM：一级菜单项文本 + 图标是否真的渲染出 svg */
const SIDEBAR_EXPR = `(() => {
  const items = [...document.querySelectorAll('.el-menu-vertical .el-menu-item')]
  return items.map((li) => ({
    text: (li.innerText || '').trim(),
    svg: li.querySelectorAll('.el-icon svg').length,
  }))
})()`

const TAB_NAMES_EXPR = `[...document.querySelectorAll('.tabs-strip .tab-name')].map(e => e.innerText.trim())`

/** 等 dev server 真的开始吐出新源码（Vite 的 watcher 有一拍延迟，不能靠 sleep 猜） */
async function waitForServedRegistry(mustInclude, timeoutMs = 15000) {
  const url = `${BASE}src/utils/modulesRegistry.js`
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      last = await (await fetch(url, { cache: 'no-store' })).text()
      if (last.includes(mustInclude)) return true
    } catch { /* ignore */ }
    await sleep(200)
  }
  console.error(`  · 等待 dev server 提供包含 ${JSON.stringify(mustInclude)} 的模块超时`)
  return false
}

async function main() {
  await assertServerUp()

  const reg = await import(`file://${REGISTRY}?t=${Date.now()}`)
  const nav = await import(`file://${resolve(ADMIN, 'src', 'config', 'adminNavDomains.js')}?t=${Date.now()}`)
  const groups = Object.values(reg.GROUPS)
  const expectedSidebar = [
    { title: reg.MODULES_BY_ID['0']?.name || '经营驾驶舱' },
    ...groups.map((g) => ({ title: g.name })),
  ]

  const failures = []
  let pass = 0
  const check = (name, cond, detail) => {
    if (cond) pass += 1
    else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }
  /**
   * 等条件成立；超时**记成失败项**而不是抛出去。
   * 必须这样：一旦抛出去，前面已收集的失败项会全部丢失，
   * 自检就会看到「构造/执行异常」而不是真正的断言失败（实测踩过）。
   */
  const softWait = async (label, expr, timeoutMs) => {
    try {
      await chrome.waitFor(expr, { label, timeoutMs })
      return true
    } catch (e) {
      check(label, false, `等待超时（${String(e.message).split('\n')[0].slice(0, 80)}）`)
      return false
    }
  }

  const chrome = await launchChrome({})
  const pageErrors = []
  chrome.on('Runtime.exceptionThrown', (p) =>
    pageErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text))
  try {
    // ── 0. 登录（预置口令门禁 token 后真刷新，走的是用户真实路径）────────────────
    await chrome.goto(BASE)
    await chrome.evaluate(`localStorage.setItem('sc_admin_token', ${JSON.stringify(TOKEN)})`)
    await chrome.reload()
    const loggedIn = await softWait('登录后进入控制台（无登录遮罩）', `!document.querySelector('.login-mask')`)
    if (!loggedIn) {
      failures.push('登录失败：后续断言无法进行')
      return { failures, pass }
    }

    // ── 1. 侧栏：DOM 项 = GROUPS 派生，且图标真的渲染 ────────────────────────────
    await softWait(
      '侧栏菜单渲染完成',
      `(() => { const a = ${SIDEBAR_EXPR}; return a.length >= ${expectedSidebar.length} ? a : false })()`
    )
    const sidebar = await chrome.evaluate(SIDEBAR_EXPR)
    check(
      `侧栏项数 = ${expectedSidebar.length}（HOME + ${groups.length} 域）`,
      sidebar.length === expectedSidebar.length,
      `实际 ${sidebar.length}：${sidebar.map((s) => s.text).join('/')}`
    )
    expectedSidebar.forEach((want, i) => {
      check(`侧栏第 ${i + 1} 项 = 「${want.title}」`, sidebar[i]?.text === want.title, `实际「${sidebar[i]?.text}」`)
    })
    check(
      '侧栏一级项 = 冻结快照（改名必须显式改守卫）',
      JSON.stringify(sidebar.map((s) => s.text)) === JSON.stringify(FROZEN_SIDEBAR),
      `实际 ${sidebar.map((s) => s.text).join('/')}`
    )
    const noIcon = sidebar.filter((s) => s.svg === 0).map((s) => s.text)
    check('侧栏每项都渲染出图标 svg（不是空 el-icon）', noIcon.length === 0, `无图标：${noIcon.join('、')}`)

    // ── 2. 深链：主区、面包屑、标签栏三者必须一致 ───────────────────────────────
    await chrome.goto(`${BASE}#/m/42`)
    await softWait('深链 #/m/42 面包屑切到退款审核', `document.querySelector('.breadcrumb .bc-item.current')?.innerText.includes('退款审核')`)
    const tabs42 = await chrome.evaluate(TAB_NAMES_EXPR)
    check('深链 #/m/42 → 标签栏出现「退款审核」', tabs42.includes('退款审核'), `标签栏：${tabs42.join('/')}`)
    const crumb42 = await chrome.evaluate(`[...document.querySelectorAll('.breadcrumb .bc-item')].map(e=>e.innerText.trim())`)
    check('深链 #/m/42 → 面包屑末项为「退款审核」', crumb42[crumb42.length - 1] === '退款审核', `面包屑：${crumb42.join(' › ')}`)
    const active42 = await chrome.evaluate(`document.querySelector('.el-menu-vertical .el-menu-item.is-active')?.innerText.trim() || ''`)
    check('深链 #/m/42 → 侧栏高亮所属域「业务运营」', active42 === '业务运营', `实际「${active42}」`)

    // ── 3. 别名深链：必须归一化到 Hub，且 hash 被改写 ───────────────────────────
    await chrome.goto(`${BASE}#/m/16`)
    await softWait('别名深链 #/m/16 落到 Hub 预约中心', `[...document.querySelectorAll('.tabs-strip .tab-name')].some(e => e.innerText.trim() === '预约中心')`)
    const tabs16 = await chrome.evaluate(TAB_NAMES_EXPR)
    check('别名深链 #/m/16 → 标签栏为 Hub「预约中心」', tabs16.includes('预约中心'), `标签栏：${tabs16.join('/')}`)
    check('别名深链 #/m/16 → 标签栏不出现别名名「预约规则配置」', !tabs16.includes('预约规则配置'), `标签栏：${tabs16.join('/')}`)
    const hash16 = await chrome.evaluate('location.hash')
    check('别名深链 #/m/16 → hash 规范化为 #/m/37', hash16 === '#/m/37', `实际 ${hash16}`)

    // ── 4. 未注册 id：必须有可见告警（不再静默回退驾驶舱）────────────────────────
    await chrome.goto(`${BASE}#/m/999`)
    await softWait('未注册 id 的可见告警出现', `!!document.querySelector('.unknown-tabs-alert')`)
    const alertText = await chrome.evaluate(`document.querySelector('.unknown-tabs-alert')?.innerText || ''`)
    check('未注册深链 #/m/999 → 告警文案包含 999', alertText.includes('999'), alertText.replace(/\s+/g, ' ').slice(0, 120))
    check('未注册深链 → 告警文案说明已回退驾驶舱', /回退/.test(alertText))

    // ── 4b. 内联渲染的模块（藏品档案库 1）不得误报「未注册」──────────────────────
    // 实测回归（本轮两个）：
    //  a) id 1 由 App.vue 的 `v-if="currentTab === '1'"` 内联渲染，不在 TAB_COMPONENT_MAP
    //     里，于是打开 ERP 最常用的藏品库会弹「未注册 / 已回退驾驶舱」，而页面其实正确；
    //  b) 告警曾是会话级累计（`push`），从 #/m/999 切到任何正常模块后仍挂着 999 ——
    //     告警一旦说谎就等于训练运营忽略它。
    // 本步骤顺序在 #/m/999 之后，因此同时锁住「离开坏 id 后告警必须消失」。
    await chrome.goto(`${BASE}#/m/1`)
    await softWait('藏品档案库(1) 内联分支渲染', `document.querySelector('.breadcrumb .bc-item.current')?.innerText.includes('藏品档案库')`)
    const tab1Crumb = await chrome.evaluate(`document.querySelector('.breadcrumb .bc-item.current')?.innerText || ''`)
    check('深链 #/m/1 → 面包屑为「藏品档案库」', tab1Crumb === '藏品档案库', `实际「${tab1Crumb}」`)
    const tab1Alert = await chrome.evaluate(`document.querySelector('.unknown-tabs-alert')?.innerText || ''`)
    check(
      '深链 #/m/1（内联模块）不弹「未注册」告警',
      tab1Alert === '',
      `实际：${tab1Alert.replace(/\s+/g, ' ').slice(0, 120)}`
    )
    check(
      '离开未注册 id 后告警消失（告警只反映当前 tab，不是会话累计）',
      tab1Alert === '' && !/999/.test(tab1Alert),
      `残留：${tab1Alert.replace(/\s+/g, ' ').slice(0, 120)}`
    )

    // ── 5. 七个导航大屏：标题/overline/条目名称必须与派生数据一致 ────────────────
    for (const g of groups) {
      const domain = nav.NAV_DOMAINS[g.navId]
      await chrome.goto(`${BASE}#/m/${g.navId}`)
      const rendered = await softWait(
        `导航大屏 ${g.navId} 渲染出标题「${domain.title}」`,
        `document.querySelector('.admin-nav-hub .hub-title')?.innerText.trim() === ${JSON.stringify(domain.title)}`
      )
      if (!rendered) continue
      const hub = await chrome.evaluate(`({
        title: document.querySelector('.admin-nav-hub .hub-title')?.innerText.trim(),
        overline: document.querySelector('.admin-nav-hub .hub-overline')?.innerText.trim(),
        entries: [...document.querySelectorAll('.admin-nav-hub .entry-title')].map(e => e.innerText.trim()),
        icons: document.querySelectorAll('.admin-nav-hub .entry-card .entry-icon svg').length,
      })`)
      check(`导航大屏 ${g.navId} 标题 = 「${domain.title}」`, hub.title === domain.title, `实际「${hub.title}」`)
      check(`导航大屏 ${g.navId} overline = 「${g.overline}」`, hub.overline === g.overline, `实际「${hub.overline}」`)
      const wantEntries = domain.sections.flatMap((s) => s.entries.map((e) => e.title))
      check(
        `导航大屏 ${g.navId} 条目名称与注册表一致（${wantEntries.length} 条）`,
        JSON.stringify(hub.entries) === JSON.stringify(wantEntries),
        `期望 ${wantEntries.join('/')}；实际 ${hub.entries.join('/')}`
      )
      check(`导航大屏 ${g.navId} 每个条目都渲染出图标`, hub.icons === wantEntries.length, `图标 ${hub.icons} / 条目 ${wantEntries.length}`)
      const frozen = FROZEN_ENTRY_NAMES[g.navId]
      if (frozen) {
        const missing = frozen.filter((n) => !hub.entries.includes(n))
        check(
          `导航大屏 ${g.navId} 保留冻结的注册表名（无「同屏两名」回归）`,
          missing.length === 0,
          `DOM 里找不到：${missing.join('、')}；实际 ${hub.entries.join('/')}`
        )
      }
    }

    // ── 6. 权益与营销：死配置不得伪装成「暂无数据」（本轮只读核对发现的集合缺失）────
    // 线上核对结论：`vip_cards` / `equity_goods` 在云开发里不存在（DescribeTable 报 not exist）。
    // 这两个页签原来看起来完全正常（有新建按钮、空列表），只有点保存才报错 ——
    // 等于把「环境未就绪」显示成「没有数据」。另外还删掉了一个空白且读错集合的「会员等级体系」页签。
    await chrome.goto(`${BASE}#/m/6`)
    await softWait('权益与营销页签渲染', `document.querySelectorAll('.tabs-wrapper .el-radio-button__inner').length >= 4`)
    const tabLabels = await chrome.evaluate(`[...document.querySelectorAll('.tabs-wrapper .el-radio-button__inner')].map(e => e.innerText.trim())`)
    check('权益与营销不再有空白/读错集合的「会员等级体系」页签', !tabLabels.some((t) => t.includes('会员等级')), `页签：${tabLabels.join('/')}`)
    const panelSub = await chrome.evaluate(`document.querySelector('.panel-sub')?.innerText || ''`)
    check('页面说明告知等级体系已并入会员经营', /会员等级体系已并入/.test(panelSub), `实际「${panelSub}」`)

    const clickTab = async (name) => {
      const ok = await chrome.evaluate(`(() => {
        const el = [...document.querySelectorAll('.tabs-wrapper .el-radio-button__inner')].find(e => e.innerText.includes(${JSON.stringify(name)}))
        if (!el) return false
        el.click(); return true
      })()`)
      if (ok) await sleep(1200)
      return ok
    }
    for (const [tabName, coll] of [['会员权益卡', 'vip_cards'], ['虚拟权益商品', 'equity_goods']]) {
      check(`能切到「${tabName}」页签`, await clickTab(tabName))
      const alert = await chrome.evaluate(`document.querySelector('.missing-collection-alert')?.innerText.replace(/\\s+/g, ' ').trim() || ''`)
      check(`「${tabName}」页显示集合缺失告警且点名 ${coll}`, alert.includes(coll) && /不存在|未创建/.test(alert), `实际：${alert.slice(0, 100)}`)
      check(`「${tabName}」页显式说明「不是没有数据」`, /不是没有数据/.test(alert), `实际：${alert.slice(0, 100)}`)
      const newBtnDisabled = await chrome.evaluate(`!!document.querySelector('.list-area .el-button.is-disabled')`)
      check(`「${tabName}」页的新建按钮已禁用`, newBtnDisabled)
    }
    // 反向：正常页签（优惠券，集合存在）不得出现该告警，否则就是狼来了
    check('能切回「优惠券配置」页签', await clickTab('优惠券'))
    const couponAlert = await chrome.evaluate(`document.querySelector('.missing-collection-alert')?.innerText || ''`)
    check('「优惠券配置」页不出现集合缺失告警（避免狼来了）', couponAlert === '', `实际：${couponAlert.slice(0, 80)}`)

    check('运行期间无页面级异常', pageErrors.length === 0, pageErrors.map((e) => String(e).split('\n')[0]).join(' | '))
  } catch (e) {
    // 任何未预期的异常都记成失败项，绝不吞掉已收集的失败
    failures.push(`执行中断：${String(e?.message || e).split('\n')[0]}`)
  } finally {
    await chrome.close()
  }

  return { failures, pass }
}

if (argv.includes('--selftest')) {
  console.log('自检：先跑基线，再把 GROUPS 里的「业务运营」改名为「业务运营【自检】」，DOM 断言必须失败\n')
  const original = readFileSync(REGISTRY, 'utf8')
  const mutated = original.replace("name: '业务运营'", "name: '业务运营【自检】'")
  let detected = false
  let reason = ''
  let baselineOk = false
  try {
    // ① 基线：改坏之前必须全绿，否则「能失败」没有意义
    const base = await main()
    baselineOk = base.failures.length === 0
    console.log(`${baselineOk ? '✓' : '✗'} 基线（未改坏）→ ${baselineOk ? `${base.pass} 项全通过` : `已失败：${base.failures[0]}`}`)
    if (!baselineOk) throw new Error('基线未通过，自检无意义')

    // ② 注入回归
    if (mutated === original) throw new Error('锚点未命中，未构造出回归样本')
    writeFileSync(REGISTRY, mutated, 'utf8')
    // 等 Vite 真正换到改坏后的源码，避免「因为还没生效而假通过」
    if (!(await waitForServedRegistry('业务运营【自检】'))) throw new Error('dev server 未生效改动，自检无效')
    const { failures } = await main()
    const hit = failures.find((f) => /冻结快照/.test(f) || /侧栏第 3 项/.test(f) || /侧栏项数/.test(f))
    detected = !!hit
    reason = hit || failures[0] || '(无失败项)'
  } catch (e) {
    reason = `构造/执行异常：${e.message}`
  } finally {
    writeFileSync(REGISTRY, original, 'utf8')
    const restored = readFileSync(REGISTRY, 'utf8')
    if (restored !== original) {
      console.error('✗ 严重：源文件未还原干净，请检查 admin/src/utils/modulesRegistry.js')
      process.exit(1)
    }
    await waitForServedRegistry("name: '业务运营'")
  }
  console.log(`${detected ? '✓' : '✗'} 改名后的侧栏 → ${detected ? '已检出' : '【漏检】'}`)
  console.log(`    · ${reason}`)
  console.log()
  if (!detected) {
    console.error('自检失败：改坏源文件却没被 DOM 断言抓到，守卫不可信。')
    process.exit(1)
  }
  console.log('自检通过：基线全绿，且改坏源文件后 DOM 断言确实会失败。\n')
  // 不再跑一次正式巡检：Vite 刚被改动过，紧接着再跑会读到尚未失效的缓存，
  // 那属于 Vite HMR 的时序，不是守卫要断言的东西。正式巡检请单独执行。
  process.exit(0)
}

const { failures, pass } = await main()
console.log(`导航/深链 DOM 验收守卫：${pass} 项通过，${failures.length} 项失败（${BASE}）`)
if (failures.length) {
  console.error('\n失败明细：')
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('全部通过：侧栏与七个导航大屏按派生数据真实渲染，深链/别名/未注册 id 三态行为正确。')
