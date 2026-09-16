#!/usr/bin/env node
/**
 * 导航事实来源守卫（审计 P1「导航 3–4 份事实来源」）
 *
 * 背景：导航信息曾经分散在四处 —— `modulesRegistry.MODULES` 里 7 条手抄的 nav-* 条目、
 * `GROUPS`、`config/adminNavDomains.NAV_DOMAINS` 里重抄一遍的域名称/条目名称、以及
 * `App.vue` 里 8 条硬编码 `el-menu-item`。手抄必然漂移，实际已漂出 6 处**同屏两名**：
 *   77 物业 / 物业成本      76 采购 / 采购管理        78 库存同步 / 飞书同步中心
 *   38 工单 / 标本定制工单  40 山海有信 / 山海有信工单  12 智能中心 / AI 智能中心
 * 即导航大屏叫一个名，侧栏/命令面板/标签页/面包屑叫另一个名。
 *
 * 现状：域身份只在 `GROUPS` 定义一次，条目名称/图标只在 `MODULES` 定义一次，
 * `NAV_DOMAINS` 与侧栏全部派生。本守卫把这些不变量钉住，防止有人再抄回去。
 *
 * 用法：
 *   node admin/scripts/check-nav-sources.mjs
 *   node admin/scripts/check-nav-sources.mjs --selftest   # 证明守卫真的能失败
 */
'use strict'

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADMIN = resolve(HERE, '..')
const REGISTRY = resolve(ADMIN, 'src', 'utils', 'modulesRegistry.js')
const NAVDOMAINS = resolve(ADMIN, 'src', 'config', 'adminNavDomains.js')
const APP = resolve(ADMIN, 'src', 'App.vue')

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const load = (p) => import(`file://${p}?t=${Date.now()}`)

/** @returns {Promise<{failures: string[], pass: number, domainCount: number, entryCount: number}>} */
export async function runChecks({ registryPath, navPath, appPath }) {
  const reg = await load(registryPath)
  const nav = await load(navPath)
  const { GROUPS, MODULES_BY_ID, MODULES_CANONICAL } = reg
  const { NAV_DOMAINS, NAV_DOMAIN_IDS, NAV_SIDEBAR_ITEMS, MODULE_TO_NAV_DOMAIN, NAV_CURATED_IDS } = nav
  const { MODULE_ALIASES } = await load(resolve(dirname(registryPath), 'moduleAliases.js'))

  const failures = []
  let pass = 0
  const check = (name, cond, detail) => {
    if (cond) pass += 1
    else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }

  const groups = Object.values(GROUPS)
  const groupNavIds = groups.map((g) => g.navId)

  // 1) 域身份唯一来源：GROUPS 的 navId 就是域的集合与顺序
  check(
    '域集合/顺序 = GROUPS.navId',
    JSON.stringify(NAV_DOMAIN_IDS) === JSON.stringify(groupNavIds),
    `NAV_DOMAIN_IDS=${NAV_DOMAIN_IDS.join(',')} / GROUPS=${groupNavIds.join(',')}`
  )

  groups.forEach((g) => {
    const d = NAV_DOMAINS[g.navId]
    check(`域 ${g.navId} 已构造`, !!d)
    if (!d) return
    check(`域 ${g.navId}.id === GROUPS.navId`, d.id === g.navId, `实际 ${d.id}`)
    check(`域 ${g.navId}.title === GROUPS.name`, d.title === g.name, `域内「${d.title}」vs GROUPS「${g.name}」`)
    check(`域 ${g.navId}.overline === GROUPS.overline`, d.overline === g.overline, `域内「${d.overline}」vs GROUPS「${g.overline}」`)
    check(`域 ${g.navId}.icon === GROUPS.navIcon`, d.icon === g.navIcon, `域内「${d.icon}」vs GROUPS「${g.navIcon}」`)
    check(`域 ${g.navId} 有副标题`, !!d.subtitle)
    check(`域 ${g.navId} 有分区`, d.sections.length > 0)
  })

  // 2) 条目身份唯一来源：MODULES_BY_ID（防「同屏两名」复发）+ 落点唯一
  const seenEntry = new Map()
  Object.values(NAV_DOMAINS).forEach((d) => {
    const keys = d.sections.map((s) => s.key)
    check(`域 ${d.id} 分区 key 唯一`, new Set(keys).size === keys.length, keys.join(','))
    d.sections.forEach((s) => {
      check(`域 ${d.id}/${s.key} 非空分区`, s.entries.length > 0)
      s.entries.forEach((e) => {
        const mod = MODULES_BY_ID[e.id]
        check(`条目 ${e.id} 已注册`, !!mod)
        if (mod) {
          check(`条目 ${e.id}.title === MODULES.name`, e.title === mod.name, `域内「${e.title}」vs 注册表「${mod.name}」`)
          check(`条目 ${e.id}.icon === MODULES.icon`, e.icon === mod.icon, `域内「${e.icon}」vs 注册表「${mod.icon}」`)
          const gk = GROUPS[mod.group]
          check(`条目 ${e.id} 的 group 与所在域一致`, !!gk && gk.navId === d.id, `group ${mod.group} → ${gk?.navId}，却在 ${d.id}`)
        }
        check(`条目 ${e.id} 有说明`, !!e.desc)
        check(`条目 ${e.id} 不是别名`, !MODULE_ALIASES[e.id], `别名应指向 Hub ${MODULE_ALIASES[e.id]?.hub}`)
        check(`条目 ${e.id} 只落一次`, !seenEntry.has(e.id), `又出现在 ${d.id}/${s.key}（首次 ${seenEntry.get(e.id)}）`)
        if (!seenEntry.has(e.id)) seenEntry.set(e.id, `${d.id}/${s.key}`)
      })
    })
  })

  // 3) 覆盖完整：规范模块（排除 7 条 nav-* 伪模块）必须都能从导航大屏进得去
  const navModuleIds = new Set(groupNavIds.map(String))
  const orphans = MODULES_CANONICAL.map((m) => String(m.id))
    .filter((id) => !navModuleIds.has(id) && !seenEntry.has(id))
  check(
    '所有规范模块都已策展进导航域（无「注册了但大屏进不去」）',
    orphans.length === 0,
    `未策展：${orphans.map((id) => `${id} ${MODULES_BY_ID[id]?.name || '?'}`).join('、')}`
  )

  // 4) 反向：策展数据不得留下多余 id
  const extra = [...new Set(NAV_CURATED_IDS.map(String))].filter((id) => !seenEntry.has(id))
  check('策展数据无多余 id', extra.length === 0, `多余：${extra.join('、')}`)

  // 5) MODULE_TO_NAV_DOMAIN 派生正确
  const badMap = [...seenEntry.keys()].filter((id) => MODULE_TO_NAV_DOMAIN[id] !== seenEntry.get(id).split('/')[0])
  check('MODULE_TO_NAV_DOMAIN 与策展一致', badMap.length === 0, `不一致：${badMap.join('、')}`)

  // 6) 侧栏项派生正确
  check('侧栏项数 = 域数', NAV_SIDEBAR_ITEMS.length === groups.length, `${NAV_SIDEBAR_ITEMS.length} vs ${groups.length}`)
  groups.forEach((g, i) => {
    const it = NAV_SIDEBAR_ITEMS[i]
    check(`侧栏第 ${i + 1} 项 = ${g.navId}`, !!it && it.id === g.navId, `实际 ${it?.id}`)
    if (it) check(`侧栏 ${it.id} 名称/图标派生自 GROUPS`, it.title === g.name && it.icon === g.navIcon, `${it.title}/${it.icon}`)
  })

  // 7) 侧栏 DOM 必须数据驱动，禁止再手写 el-menu-item（否则又是第二份事实来源）
  const appSrc = readFileSync(appPath, 'utf8')
  const literalNavItems = appSrc.match(/index="nav-[a-z-]+"/g) || []
  check('App.vue 未手写 nav-* 菜单项', literalNavItems.length === 0, `发现 ${literalNavItems.length} 条：${literalNavItems.join(',')}`)
  check('App.vue 侧栏为 v-for 数据驱动', /v-for="item in NAV_SIDEBAR_ITEMS"/.test(appSrc))
  check('App.vue 侧栏图标走 resolveEpIcon', /<component :is="resolveEpIcon\(item\.icon\)" \/>/.test(appSrc))
  check('App.vue HOME 项取自注册表（homeNavItem）', /homeNavItem/.test(appSrc))

  // 8) 注册表 ↔ 渲染方一一对应（审计「重复实现对照」）
  //    `MODULES` 是「有哪些模块」，`TAB_COMPONENT_MAP` + 内联分支是「哪些真能渲染」。
  //    两者脱节有两个方向，都会骗人：
  //      · 注册表有、渲染方无 → 打开就弹「未注册 / 已回退驾驶舱」（实测：藏品档案库 id 1 曾误报）
  //      · 渲染方有、注册表无 → 命令面板搜不到，变成谁也发现不了的隐性功能
  const mapBlock = appSrc.slice(
    appSrc.indexOf('const TAB_COMPONENT_MAP = {'),
    appSrc.indexOf('\n}', appSrc.indexOf('const TAB_COMPONENT_MAP = {'))
  )
  const mapKeys = [...mapBlock.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1])
  const inlineBlock = appSrc.slice(
    appSrc.indexOf('const INLINE_TAB_IDS = new Set('),
    appSrc.indexOf(')', appSrc.indexOf('const INLINE_TAB_IDS = new Set('))
  )
  const inlineIds = [...inlineBlock.matchAll(/'([^']+)'/g)].map((m) => m[1])
  check('解析到 TAB_COMPONENT_MAP 键', mapKeys.length > 0, `解析到 ${mapKeys.length} 个`)
  check('解析到 INLINE_TAB_IDS', inlineIds.length > 0, `解析到 ${inlineIds.length} 个`)

  const navModuleIdsList = [...navModuleIds]
  const renderable = new Set([...mapKeys, ...inlineIds])
  const noRenderer = MODULES_CANONICAL.map((m) => String(m.id))
    .filter((id) => !renderable.has(id))
  check(
    '每个规范模块都有渲染方（TAB_COMPONENT_MAP ∪ INLINE_TAB_IDS）',
    noRenderer.length === 0,
    `无渲染方（打开会误报「未注册」）：${noRenderer.map((id) => `${id} ${MODULES_BY_ID[id]?.name || '?'}`).join('、')}`
  )
  const notInRegistry = mapKeys.filter((k) => !MODULES_BY_ID[k])
  check(
    'TAB_COMPONENT_MAP 的键都在注册表里（否则命令面板搜不到 → 隐性功能）',
    notInRegistry.length === 0,
    `孤儿键：${notInRegistry.join('、')}`
  )
  const aliasKeys = mapKeys.filter((k) => MODULE_ALIASES[k])
  check(
    'TAB_COMPONENT_MAP 不含「已并入」别名键',
    aliasKeys.length === 0,
    `含别名：${aliasKeys.map((k) => `${k}→${MODULE_ALIASES[k].hub}`).join('、')}`
  )
  const staleInline = inlineIds.filter((id) => !MODULES_BY_ID[id] && !navModuleIdsList.includes(id))
  check('INLINE_TAB_IDS 的 id 都已注册', staleInline.length === 0, `未注册：${staleInline.join('、')}`)

  return { failures, pass, domainCount: NAV_DOMAIN_IDS.length, entryCount: seenEntry.size }
}

const REAL = { registryPath: REGISTRY, navPath: NAVDOMAINS, appPath: APP }

if (argv.includes('--selftest')) {
  console.log('自检：注入 3 种真实回归，守卫必须各自失败\n')
  const regSrc = readFileSync(REGISTRY, 'utf8')
  const navSrc = readFileSync(NAVDOMAINS, 'utf8')
  const appSrc = readFileSync(APP, 'utf8')
  const TMP_REG = resolve(ADMIN, 'src', 'utils', '__selftest_registry.js')
  const TMP_NAV = resolve(ADMIN, 'src', 'config', '__selftest_navdomains.js')
  const TMP_APP = resolve(ADMIN, 'src', '__selftest_App.vue')

  // 临时 nav 源指向临时 registry，使「新增模块但忘记策展」走完整派生链
  const navForTmpReg = navSrc.replace(
    "from '../utils/modulesRegistry.js'",
    "from '../utils/__selftest_registry.js'"
  )

  const cases = [
    {
      label: '新增模块但忘记策展（导航大屏进不去）',
      files: [
        [TMP_REG, regSrc.replace(
          "  { id: '77', name: '物业成本'",
          "  { id: '999', name: '自检幽灵模块', group: 'STUDIO', subgroup: '工作室', icon: 'Box', keywords: 'selftest' },\n  { id: '77', name: '物业成本'"
        )],
        [TMP_NAV, navForTmpReg],
      ],
      run: { registryPath: TMP_REG, navPath: TMP_NAV, appPath: APP },
      expect: /未策展：999/,
    },
    {
      label: '条目被指到「已并入」别名（应指向 Hub）',
      files: [
        [TMP_NAV, navSrc.replace(
          "{ id: '79', desc: '出货账本核对（SSOT ops_shipments）' },",
          "{ id: '55', desc: '出货账本核对（SSOT ops_shipments）' },"
        )],
      ],
      run: { registryPath: REGISTRY, navPath: TMP_NAV, appPath: APP },
      expect: /条目 55 不是别名/,
    },
    {
      label: 'App.vue 又手写 nav-* 菜单项（第二份事实来源）',
      files: [
        [TMP_APP, appSrc.replace(
          '<el-menu-item-group title="DOMAINS">',
          '<el-menu-item-group title="DOMAINS">\n<el-menu-item index="nav-overview">手抄一份</el-menu-item>'
        )],
      ],
      run: { registryPath: REGISTRY, navPath: NAVDOMAINS, appPath: TMP_APP },
      expect: /未手写 nav-\* 菜单项/,
    },
    {
      label: '内联模块漏登记 INLINE_TAB_IDS（打开会误报「未注册/已回退驾驶舱」）',
      files: [
        [TMP_APP, appSrc.replace("const INLINE_TAB_IDS = new Set(['1'])", 'const INLINE_TAB_IDS = new Set([])')],
      ],
      run: { registryPath: REGISTRY, navPath: NAVDOMAINS, appPath: TMP_APP },
      expect: /每个规范模块都有渲染方/,
    },
  ]

  let allDetected = true
  for (const c of cases) {
    let detected = false
    let reason = ''
    try {
      c.files.forEach(([p, content]) => {
        const orig = p.endsWith('.vue') ? appSrc : (p === TMP_NAV ? navSrc : regSrc)
        if (content === orig) throw new Error(`锚点未命中，未构造出回归样本（${p}）`)
        writeFileSync(p, content, 'utf8')
      })
      const { failures } = await runChecks(c.run)
      const hit = failures.find((f) => c.expect.test(f))
      detected = !!hit
      reason = hit || failures[0] || '(无失败项)'
    } catch (e) {
      reason = `构造/执行异常：${e.message}`
    } finally {
      c.files.forEach(([p]) => { try { unlinkSync(p) } catch { /* ignore */ } })
    }
    console.log(`${detected ? '✓' : '✗'} ${c.label} → ${detected ? '已检出' : '【漏检】'}`)
    if (reason) console.log(`    · ${reason}`)
    if (!detected) allDetected = false
  }
  console.log()
  if (!allDetected) {
    console.error('自检失败：注入的回归未被检出，守卫不可信。')
    process.exit(1)
  }
  console.log('自检通过：注入的回归都被检出。\n')
}

const { failures, pass, domainCount, entryCount } = await runChecks(REAL)
console.log(`导航事实来源守卫：${pass} 项通过，${failures.length} 项失败（${domainCount} 个域 / ${entryCount} 个条目）`)
if (failures.length) {
  console.error('\n失败明细：')
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('全部通过：域身份仅来自 GROUPS、条目名称/图标仅来自 MODULES、侧栏数据驱动、模块无遗漏。')
