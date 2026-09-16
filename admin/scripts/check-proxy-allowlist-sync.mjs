#!/usr/bin/env node
/**
 * 代理白名单**两侧对齐**守卫（本轮新建）
 *
 * 背景：管理类云函数有**两份**允许名单，必须逐项一致：
 *   · `functions/_lib/cloudbaseCallFn.mjs` 的 `ALLOWED_FUNCTIONS`（Pages Function，服务端真正执法）
 *   · `admin/src/utils/cloudbaseCdnDb.js` 的 `ADMIN_PROXY_FUNCTIONS`（前端，决定走不走代理）
 * 两个文件的注释都写着「须与对方对齐」，但此前**没有任何检查在管这件事**。
 *
 * 漂移的两种后果（都很难查）：
 *   · 只加前端：ERP 会把请求发给代理，代理回「不在 Admin 代理白名单内」→ 功能不可用；
 *   · 只加服务端：前端仍走 CDN 直写 → 被集合规则拒绝（或更早的静默假成功）。
 *
 * 本轮就是因为 `verifyBooking` 要接进 ERP，才手工核对了两边 —— 这类事不该靠人记。
 *
 * 用法：
 *   node admin/scripts/check-proxy-allowlist-sync.mjs
 *   node admin/scripts/check-proxy-allowlist-sync.mjs --selftest
 */
'use strict'

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const SERVER = resolve(ROOT, 'functions', '_lib', 'cloudbaseCallFn.mjs')
const CLIENT = resolve(ROOT, 'admin', 'src', 'utils', 'cloudbaseCdnDb.js')
/** 集合级允许名单（第二对，与函数级名单同一类风险） */
const COLL_SERVER = resolve(ROOT, 'miniprogram', 'cloudfunctions', 'manageStoreContent', 'index.js')
const COLL_CLIENT = CLIENT

/**
 * 从源码里取出某个 `const NAME = ...([ ... ])`（或 Object.freeze([...])）里的字符串项。
 * 纯文本解析，注释里的字面量会被剥掉 —— 否则注释中提到的函数名会造成假阳性。
 */
export function extractList(src, constName) {
  // 兼容三种写法：`= [...]`、`= Object.freeze([...])`、`= new Set([...])`
  const m = src.match(
    new RegExp(`${constName}\\s*=\\s*(?:Object\\.freeze\\(|new Set\\()?\\[([\\s\\S]*?)\\]`),
  )
  if (!m) return null
  const body = m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '')) // 去行尾注释
    .join('\n')
  return [...body.matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)].map((x) => x[1])
}

/** 返回 { onlyServer, onlyClient }；两者都缺则为解析失败 */
export function diffAllowlists(serverSrc, clientSrc) {
  const s = extractList(serverSrc, 'ALLOWED_FUNCTIONS')
  const c = extractList(clientSrc, 'ADMIN_PROXY_FUNCTIONS')
  if (!s || !c) return null
  const S = new Set(s)
  const C = new Set(c)
  return {
    server: s,
    client: c,
    onlyServer: [...S].filter((x) => !C.has(x)).sort(),
    onlyClient: [...C].filter((x) => !S.has(x)).sort(),
  }
}

/**
 * 纯函数：取出对象字面量的**顶层**键名（缩进 2 空格那一层）。
 * 只取顶层是因为 `configs` 这种键下面还嵌着 allowSetDocIds 等子对象，
 * 递归抓会把子键也当成集合名。
 */
export function extractObjectKeys(src, constName) {
  const start = src.indexOf(`const ${constName} = {`)
  if (start < 0) return null
  let depth = 0
  let end = -1
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  if (end < 0) return null
  const body = src.slice(start, end)
  const keys = []
  for (const line of body.split('\n')) {
    const m = line.match(/^\s{2}([a-z][a-z0-9_]*)\s*:/)
    if (m) keys.push(m[1])
  }
  return keys
}

/** 返回集合级名单的 { onlyServer, onlyClient } */
export function diffCollectionAllowlists(serverSrc, clientSrc) {
  const s = extractObjectKeys(serverSrc, 'ALLOWED_COLLECTIONS')
  const c = extractList(clientSrc, 'STORE_CONTENT_WRITE_COLLECTIONS')
  if (!s || !c) return null
  const S = new Set(s)
  const C = new Set(c)
  return {
    server: s,
    client: c,
    onlyServer: [...S].filter((x) => !C.has(x)).sort(),
    onlyClient: [...C].filter((x) => !S.has(x)).sort(),
  }
}

const selftest = process.argv.includes('--selftest')

if (!selftest) {
  const serverSrc = readFileSync(SERVER, 'utf8')
  const clientSrc = readFileSync(CLIENT, 'utf8')
  const d = diffAllowlists(serverSrc, clientSrc)
  if (!d) {
    console.error('✗ 无法从源码解析出白名单（常量名被改名了？）')
    process.exit(1)
  }
  console.log(`代理白名单对齐守卫：服务端 ${d.server.length} 项 / 前端 ${d.client.length} 项`)
  let bad = 0
  if (d.onlyServer.length) {
    bad += d.onlyServer.length
    console.error(`✗ 只在服务端名单里（前端不会走代理 → 形同未接入）：${d.onlyServer.join('、')}`)
  }
  if (d.onlyClient.length) {
    bad += d.onlyClient.length
    console.error(`✗ 只在前端名单里（代理会拒绝 → ERP 收到「不在白名单」）：${d.onlyClient.join('、')}`)
  }
  if (bad) {
    console.error('\n✗ 两侧白名单漂移。补齐后重跑；确属有意为之请在注释里写明理由。')
    process.exit(1)
  }
  // 第二对：集合级允许名单（前端决定走不走代理 / 服务端真正执法）
  const collServerSrc = readFileSync(COLL_SERVER, 'utf8')
  const cd = diffCollectionAllowlists(collServerSrc, clientSrc)
  if (!cd) {
    console.error('✗ 无法解析集合级允许名单（常量名被改名了？）')
    process.exit(1)
  }
  console.log(`集合级名单：服务端 ${cd.server.length} 项 / 前端 ${cd.client.length} 项`)
  if (cd.onlyServer.length) {
    bad += cd.onlyServer.length
    console.error(`✗ 只在服务端集合名单里（前端走 CDN 直写 → 被集合规则拒绝）：${cd.onlyServer.join('、')}`)
  }
  if (cd.onlyClient.length) {
    bad += cd.onlyClient.length
    console.error(`✗ 只在前端集合名单里（服务端会拒绝该集合）：${cd.onlyClient.join('、')}`)
  }

  if (bad) {
    console.error('\n✗ 两侧白名单漂移。补齐后重跑；确属有意为之请在注释里写明理由。')
    process.exit(1)
  }
  const shared = d.server.filter((x) => d.client.includes(x))
  console.log(`全部通过：函数级两侧逐项一致（交集 ${shared.length} 项）；集合级两侧逐项一致（${cd.server.length} 项）。`)
  process.exit(0)
}

// ── 自检：三种漂移各注入一次，必须都检出 ──
console.log('自检：注入「只加服务端 / 只加前端 / 注释干扰」，守卫必须分别失败\n')

const serverSrc = readFileSync(SERVER, 'utf8')
const clientSrc = readFileSync(CLIENT, 'utf8')

const base = diffAllowlists(serverSrc, clientSrc)
if (!base || base.onlyServer.length || base.onlyClient.length) {
  console.error('✗ 自检前提不成立：当前仓库两侧本就不一致，请先修好再跑自检')
  process.exit(1)
}
console.log(`✓ 现状一致（各 ${base.server.length} 项）`)

// ① 只加服务端
{
  const s2 = serverSrc.replace(
    /'verifyBooking',/,
    "'verifyBooking',\n  'zzOnlyServerProbe',",
  )
  const d = diffAllowlists(s2, clientSrc)
  if (d.onlyServer.includes('zzOnlyServerProbe') && d.onlyClient.length === 0) {
    console.log('✓ 检出「只加服务端」：zzOnlyServerProbe')
  } else {
    console.error('✗ 未检出「只加服务端」')
    process.exit(1)
  }
}

// ② 只加前端
{
  const c2 = clientSrc.replace(
    /'verifyBooking',/,
    "'verifyBooking',\n  'zzOnlyClientProbe',",
  )
  const d = diffAllowlists(serverSrc, c2)
  if (d.onlyClient.includes('zzOnlyClientProbe') && d.onlyServer.length === 0) {
    console.log('✓ 检出「只加前端」：zzOnlyClientProbe')
  } else {
    console.error('✗ 未检出「只加前端」')
    process.exit(1)
  }
}

// ③ 注释里的函数名不得被当成名单项（否则会造出假漂移）
{
  const c3 = clientSrc.replace(
    /const ADMIN_PROXY_FUNCTIONS/,
    "// 说明文字里提到 'zzCommentedOutProbe' 不算名单\nconst ADMIN_PROXY_FUNCTIONS",
  )
  const d = diffAllowlists(serverSrc, c3)
  if (d.onlyServer.length === 0 && d.onlyClient.length === 0) {
    console.log('✓ 注释中的函数名未被误当名单项')
  } else {
    console.error(`✗ 注释干扰造成假漂移：onlyServer=${d.onlyServer} onlyClient=${d.onlyClient}`)
    process.exit(1)
  }
}

console.log('\n自检通过：两类真实漂移都能检出，且注释不会造成假阳性。')
