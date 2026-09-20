#!/usr/bin/env node
/**
 * check:order-badge-sync —— 「藏品订单」数字角标与订单页签的**口径同源**守卫
 *
 * ## 为什么必须有
 *
 * 角标数字来自云函数 `getUserStats` 的分状态计数，而"点进去看到几条"来自
 * `subpackages/business/orders/index.js` 的页签 where 条件 —— **同一套语义写在两处**。
 * 一旦有人给某个页签加了一个状态（例如「待付款」再加 `fulfilling` 之类），
 * 角标就会与列表对不上，出现「角标 0、点进去有 1 条」这种**看起来像丢单**的事故，
 * 而所有既有检查都不会发现（两边各自都"合法"）。
 *
 * ## 断言
 *
 *   ① `getUserStats` 的 `ORDER_BADGE_BUCKETS` 与订单页 `switch (this.data.curTab)`
 *      的 status 集合**逐桶相等**（5 桶：待付款/待发货/待收货/已签收/售后）
 *   ② 分桶覆盖两条来源：买家 `_openid`（并排除 `source=exchange` 兑换单）与受礼人
 *      `giftMeta.receiverOpenid` —— 只算一条会少算受礼单
 *   ③ 「我的」页：只给 pay/paid/shipped/refund 渲染角标（已签收是终态，累计数会常年挂数字），
 *      且初载请求 `withOrderCounts`、onShow 走轻量 `action:'orderCounts'`
 *   ④ 角标文案走 `formatBadgeText`（0/空不渲染、>99 显示 99+）
 *
 * 用法：
 *   node miniprogram/scripts/check-order-badge-sync.mjs
 *   node miniprogram/scripts/check-order-badge-sync.mjs --selftest
 *   node miniprogram/scripts/check-order-badge-sync.mjs --root <dir>   # 自检用（临时副本）
 */
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP_DEFAULT = join(HERE, '..')

const REL = {
  cloudFn: 'cloudfunctions/getUserStats/index.js',
  statusManifest: 'scripts/lib/orderStatusAllowed.json',
  ordersPage: 'subpackages/business/orders/index.js',
  userPageJs: 'pages/user/index.js',
  userPageWxml: 'pages/user/index.wxml'
}

/** 角标桶 → 订单页的页签序号（tab 1..5；0 是「全部」） */
const BUCKET_TAB = { pay: 1, paid: 2, shipped: 3, signed: 4, refund: 5 }

/** 解析订单页顶部的 ORDER_STATUS 枚举字面量 */
function parseStatusEnum (src) {
  const at = src.indexOf('const ORDER_STATUS = {')
  if (at < 0) return null
  const body = src.slice(at, src.indexOf('}', at))
  const out = {}
  const re = /([A-Z_]+)\s*:\s*'([^']+)'/g
  let m
  while ((m = re.exec(body))) out[m[1]] = m[2]
  return out
}

/** 把 `_.in([...])` / 单值表达式里的 ORDER_STATUS.X 与字符串字面量解析成字符串数组 */
function resolveStatusExpr (expr, enumMap) {
  const out = []
  const re = /ORDER_STATUS\.([A-Z_]+)|'([^']+)'/g
  let m
  while ((m = re.exec(expr))) {
    if (m[1]) {
      if (enumMap[m[1]] == null) return null // 枚举里没有 → 判据不可信
      out.push(enumMap[m[1]])
    } else out.push(m[2])
  }
  return out.length ? out : null
}

/** 从订单页 switch 提取每个 case 的 status 集合 */
function parseTabStatuses (src, enumMap) {
  const switchAt = src.indexOf('switch (this.data.curTab)')
  if (switchAt < 0) return null
  const region = src.slice(switchAt, switchAt + 2000)
  const parts = region.split(/case\s+(\d+):/).slice(1)
  const out = {}
  for (let i = 0; i < parts.length; i += 2) {
    const tab = Number(parts[i])
    const body = parts[i + 1] || ''
    const m = body.match(/statusFilter\.status\s*=\s*([\s\S]*?);/)
    if (!m) continue
    const statuses = resolveStatusExpr(m[1], enumMap)
    if (statuses) out[tab] = statuses.slice().sort()
  }
  return out
}

/** 从云函数提取 ORDER_BADGE_BUCKETS */
function parseCloudBuckets (src) {
  const at = src.indexOf('const ORDER_BADGE_BUCKETS = {')
  if (at < 0) return null
  const body = src.slice(at, src.indexOf('\n}', at))
  const out = {}
  const re = /(\w+)\s*:\s*\[([^\]]*)\]/g
  let m
  while ((m = re.exec(body))) {
    const statuses = []
    const sre = /'([^']+)'/g
    let s
    while ((s = sre.exec(m[2]))) statuses.push(s[1])
    out[m[1]] = statuses.slice().sort()
  }
  return Object.keys(out).length ? out : null
}

function check (root) {
  const problems = []
  const read = (key) => readFileSync(join(root, REL[key]), 'utf8')
  let cloud = ''
  let orders = ''
  let userJs = ''
  let userWxml = ''
  try {
    cloud = read('cloudFn')
    orders = read('ordersPage')
    userJs = read('userPageJs')
    userWxml = read('userPageWxml')
  } catch (e) {
    return [`读取失败：${e.message}`]
  }

  // ① 逐桶相等
  const enumMap = parseStatusEnum(orders)
  if (!enumMap) problems.push(`${REL.ordersPage} 找不到 ORDER_STATUS 枚举（守卫的锚点需要同步更新）`)
  const tabs = enumMap ? parseTabStatuses(orders, enumMap) : null
  const buckets = parseCloudBuckets(cloud)
  if (!tabs) problems.push(`${REL.ordersPage} 解析不出页签 status 集合（锚点变了？）`)
  if (!buckets) problems.push(`${REL.cloudFn} 解析不出 ORDER_BADGE_BUCKETS（锚点变了？）`)
  if (tabs && buckets) {
    // 页签里仍列着若干**幽灵状态**（契约 C3 §4.2 待清理）；它们零写入方，
    // 所以桶里不列它们**不改变计数**。比较时按事实源把它们从页签侧剔除，
    // 同时反过来断言"桶里不得出现幽灵值"（这是 check:order-status-enum 教会的一条）。
    let ghostTokens = new Set()
    try {
      const manifest = JSON.parse(readFileSync(join(root, REL.statusManifest), 'utf8'))
      ghostTokens = new Set([
        ...(manifest.ghosts || []), ...(manifest.suspected_ghosts || []), ...(manifest.typo_relics || [])
      ])
    } catch (e) {
      problems.push(`读不到状态事实源 ${REL.statusManifest}：${e.message}`)
    }
    Object.entries(BUCKET_TAB).forEach(([bucket, tab]) => {
      const a = buckets[bucket]
      const ghostsInBucket = (a || []).filter((v) => ghostTokens.has(v))
      if (ghostsInBucket.length) {
        problems.push(`角标桶「${bucket}」列了幽灵状态 ${ghostsInBucket.join('、')} —— 事实源的 ghosts 零写入方，写回代码会被 check:order-status-enum 拦下`)
      }
      const b = tabs[tab] ? tabs[tab].filter((v) => !ghostTokens.has(v)) : null
      if (!a) { problems.push(`云函数缺桶「${bucket}」`); return }
      if (!b) { problems.push(`订单页缺页签 ${tab}（${bucket}）的 status 集合`); return }
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        problems.push(
          `桶「${bucket}」与订单页签 ${tab} 口径不一致：\n` +
          `      云函数 ${JSON.stringify(a)}\n      订单页 ${JSON.stringify(b)}\n` +
          '      ⇒ 角标数字会与点进去的条数不符（"角标 0、列表有 1 条"）'
        )
      }
    })
    const extra = Object.keys(buckets).filter((k) => !BUCKET_TAB[k])
    if (extra.length) problems.push(`云函数多了未映射的桶：${extra.join('、')}`)
  }

  // ② 两条来源 + 排除兑换单
  // 买家键是对象字面量的无引号键（`_openid: openid`）；受礼人键带引号（见下）
  if (!/['"]?_openid['"]?\s*:\s*openid/.test(cloud)) problems.push('云函数未按买家 `_openid` 计数')
  if (!/source:\s*_\.neq\('exchange'\)/.test(cloud)) {
    problems.push('云函数未排除兑换单（`source: _.neq(\'exchange\')`）—— 兑换单不属于藏品订单')
  }
  // ⚠️ 必须连引号一起匹配：只写 /giftMeta\.receiverOpenid/ 时，
  //    把键改成 receiverOpenidx 也能"通过"（前缀匹配）—— 这是判据太松，自检抓出来过。
  if (!/['"]giftMeta\.receiverOpenid['"]/.test(cloud)) {
    problems.push('云函数未统计受礼单（`giftMeta.receiverOpenid`）—— 受礼人的待发货会少算')
  }

  // ③ 我的页接线
  const countMentions = (src, re) => (src.match(re) || []).length
  if (!/withOrderCounts:\s*true/.test(userJs)) problems.push('「我的」页初载未请求 withOrderCounts')
  if (!/action:\s*'orderCounts'/.test(userJs)) problems.push('「我的」页 onShow 未走轻量 action: orderCounts')
  if (!/refreshOrderBadges\(\)/.test(userJs)) problems.push('「我的」页未在 onShow 调用 refreshOrderBadges()')
  // 每个角标在 wxml 里天然出现两次（wx:if 与 text 各一次）→ 只数 wx:if 那一处
  ;['pay', 'paid', 'shipped', 'refund'].forEach((k) => {
    const re = new RegExp(`wx:if="\\{\\{orderBadges\\.${k}\\}\\}"`, 'g')
    const n = countMentions(userWxml, re)
    if (n !== 1) problems.push(`${REL.userPageWxml} 应有且只有一处 orderBadges.${k} 角标（当前 ${n} 处）`)
  })
  if (/orderBadges\.signed/.test(userWxml)) {
    problems.push('「我的」页渲染了已签收角标 —— 终态累计数会常年挂数字，不应显示')
  }

  // ④ 文案规范
  if (!/formatBadgeText/.test(userJs)) problems.push('「我的」页角标未走 formatBadgeText（0/空不渲染、>99 显示 99+）')

  return problems
}

// ────────────────────────────── 自检 ──────────────────────────────
function selftest () {
  let bad = 0
  const t = (name, ok, extra) => {
    if (!ok) bad += 1
    console.log(`${ok ? '✓' : '✗'} ${name}${ok || !extra ? '' : ` —— ${extra}`}`)
  }

  const tmp = mkdtempSync(join(tmpdir(), 'order-badge-sync-'))
  try {
    const copy = () => {
      for (const [key, rel] of Object.entries(REL)) {
        const dst = join(tmp, rel)
        mkdirSync(dirname(dst), { recursive: true })
        writeFileSync(dst, readFileSync(join(MP_DEFAULT, rel)))
      }
    }
    const run = () => spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', tmp], { encoding: 'utf8' })
    copy()
    const base = run()
    t('基线（真文件副本）通过', base.status === 0, (base.stdout || '') + (base.stderr || ''))

    const injections = [
      {
        name: '订单页给「待付款」多加了一个状态（角标会少算）',
        file: REL.ordersPage,
        mutate: (s) => s.replace(
          "statusFilter.status = _.in([ORDER_STATUS.PENDING_PAY, 'fulfilling']);",
          "statusFilter.status = _.in([ORDER_STATUS.PENDING_PAY, 'fulfilling', 'pending_review']);"
        ),
        expect: /桶「pay」与订单页签 1 口径不一致/
      },
      {
        name: '云函数漏掉受礼单来源（受礼人的待发货角标少算）',
        file: REL.cloudFn,
        mutate: (s) => s.replace(/'giftMeta\.receiverOpenid': openid/g, "'giftMeta.receiverOpenidx': openid"),
        expect: /未统计受礼单/
      },
      {
        name: '云函数不再排除兑换单',
        file: REL.cloudFn,
        mutate: (s) => s.replace("source: _.neq('exchange'), ", ''),
        expect: /未排除兑换单/
      },
      {
        name: '角标桶写回幽灵状态 refund_approved（check:order-status-enum 教会的一条）',
        file: REL.cloudFn,
        mutate: (t) => t.replace(
          "refund: ['aftersales', 'refunding', 'refunded', 'expired_refunding']",
          "refund: ['aftersales', 'refunding', 'refunded', 'expired_refunding', 'refund_approved']"
        ),
        expect: /列了幽灵状态/
      },
      {
        name: '我的页给已签收也挂了角标',
        file: REL.userPageWxml,
        mutate: (s) => s.replace(
          '<image class="om-icon icon-gold" src="/assets/icons/done.png"></image>',
          '<image class="om-icon icon-gold" src="/assets/icons/done.png"></image><view wx:if="{{orderBadges.signed}}"><text>{{orderBadges.signed}}</text></view>'
        ),
        expect: /已签收角标/
      }
    ]
    for (const inj of injections) {
      copy()
      const abs = join(tmp, inj.file)
      const orig = readFileSync(abs, 'utf8')
      const mutated = inj.mutate(orig)
      if (mutated === orig) {
        bad += 1
        console.log(`✗ 注入锚点缺失：${inj.name}`)
        continue
      }
      writeFileSync(abs, mutated)
      const res = run()
      const out = `${res.stdout || ''}${res.stderr || ''}`
      if (res.status !== 0 && inj.expect.test(out)) {
        console.log(`✓ ${inj.name} → 被守卫拦下`)
      } else {
        bad += 1
        console.log(`✗ ${inj.name} → 未被拦下（status=${res.status}）\n${out.slice(0, 400)}`)
      }
    }
    copy()
    t('注入全部还原后重新通过', run().status === 0)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：5 处真实注入（页签加状态 / 漏受礼单 / 不排除兑换单 / 已签收也挂角标 / 桶里写回幽灵状态）全部拦下')
}

function main () {
  if (process.argv.includes('--selftest')) return selftest()
  const i = process.argv.indexOf('--root')
  const root = i >= 0 ? process.argv[i + 1] : MP_DEFAULT
  const problems = check(root)
  if (problems.length) {
    console.error('✗ 「藏品订单」角标与订单页签口径不同源：')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('✓ 「藏品订单」角标口径同源：5 桶与订单页签 status 集合逐桶相等 /')
  console.log('  买家(排除兑换单)+受礼单两条来源都算 / 四格显示(已签收不挂) / onShow 走轻量 orderCounts / 文案走 formatBadgeText')
}

main()
