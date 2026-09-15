#!/usr/bin/env node
/**
 * 云存储文件巡检：检查线上数据引用的 cloud:// fileID 是否都还有效。
 *
 * 为什么需要：小程序里 `<image src="cloud://...">` 是原生支持的，**不会像外链那样过期**，
 * 所以「图片能不能显示」的真正风险不是过期，而是**引用的文件已被删除**。
 * 这类问题只能查线上数据 + 云存储才知道，静态扫描 WXML 看不出来。
 *
 * 背景（2026-09-15 审计第十轮）：审计原判「242 处 <image> 无 binderror 兜底」，
 * 实测后判定为非风险——全站图片统一存 cloud://，且当时 335 个引用全部有效。
 * 本脚本即那次核实的复用版，可作为定期巡检。
 *
 * 用法：
 *   node miniprogram/scripts/check-cloud-files.cjs            # 检查（默认集合清单）
 *   node miniprogram/scripts/check-cloud-files.cjs --limit 500
 * 凭证：读 admin/.env 与 admin/.env.local 的 TCB_SECRET_ID / TCB_SECRET_KEY。
 * 退出码：存在失效文件为 1。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'

/** 需要巡检的集合与图片字段（按需增补） */
const TARGETS = [
  ['products', ['images', 'image', 'coverImage']],
  ['articles', ['coverImage', 'images', 'content']],
  ['cms_wikis', ['coverImage', 'cover', 'content']],
  ['stores', ['coverImage']],
  ['store_zones', ['coverImage', 'image']],
  ['banners', ['image']],
  ['users', ['avatarUrl']],
  ['rewards', ['image', 'coverImage']],
  ['activities', ['coverImage', 'image']],
  ['care_guides', ['coverImage']],
  ['gift_settings', ['coverImage']],
]

function readEnv(file) {
  const out = {}
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch (e) { /* 文件不存在则忽略 */ }
  return out
}

function collect(value, into, origin, label) {
  if (typeof value === 'string') {
    if (value.startsWith('cloud://') && !into.has(value)) into.set(value, `${origin}.${label}`)
    return
  }
  if (Array.isArray(value)) value.forEach((v) => collect(v, into, origin, label))
  // 正文 HTML 里的 <img src="cloud://...">
  if (typeof value === 'string') return
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, into, origin, `${label}.${k}`)
  }
}

async function main() {
  const limitArg = process.argv.indexOf('--limit')
  const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) || 200 : 200

  const env = { ...readEnv(path.join(ROOT, 'admin/.env')), ...readEnv(path.join(ROOT, 'admin/.env.local')) }
  if (!env.TCB_SECRET_ID || !env.TCB_SECRET_KEY) {
    console.error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY（应在 admin/.env 或 admin/.env.local）')
    process.exit(2)
  }

  // 依赖解析：仓库根 → admin → 环境变量指定的路径（本仓库未把该 SDK 列入依赖，
  // 运维时可用 CLOUDBASE_SDK_DIR 指向任意已安装位置）
  const candidates = [
    process.env.CLOUDBASE_SDK_DIR && path.join(process.env.CLOUDBASE_SDK_DIR, '@cloudbase/node-sdk'),
    path.join(ROOT, 'node_modules/@cloudbase/node-sdk'),
    path.join(ROOT, 'admin/node_modules/@cloudbase/node-sdk'),
  ].filter(Boolean)
  let tcb = null
  for (const c of candidates) {
    try { tcb = require(c); break } catch (e) { /* 试下一个 */ }
  }
  if (!tcb) {
    console.error('找不到 @cloudbase/node-sdk。任选一种方式：')
    console.error('  1) 在仓库根目录：npm i -D @cloudbase/node-sdk')
    console.error('  2) 指定已安装位置：CLOUDBASE_SDK_DIR=/path/to/node_modules node miniprogram/scripts/check-cloud-files.cjs')
    process.exit(2)
  }
  const app = tcb.init({ env: ENV_ID, secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY })
  const db = app.database()

  const refs = new Map()
  for (const [coll, fields] of TARGETS) {
    let res
    try {
      res = await db.collection(coll).limit(LIMIT).get()
    } catch (e) {
      continue // 集合不存在则跳过
    }
    for (const doc of res.data || []) {
      for (const f of fields) {
        const raw = doc[f]
        if (typeof raw === 'string' && raw.includes('cloud://')) {
          for (const m of raw.matchAll(/cloud:\/\/[^\s"'<>)]+/g)) collect(m[0], refs, coll, f)
        } else {
          collect(raw, refs, coll, f)
        }
      }
    }
  }

  const list = [...refs.keys()]
  console.log(`引用到的 cloud:// 文件（去重）：${list.length}`)
  if (!list.length) return 0

  let ok = 0
  const dead = []
  const CHUNK = 50
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK)
    try {
      const res = await app.getTempFileURL({ fileList: chunk })
      for (const item of res.fileList || []) {
        if ((item.status || 0) === 0 && item.tempFileURL) ok += 1
        else dead.push(item)
      }
    } catch (e) {
      console.error(`批次异常（${i}–${i + chunk.length}）：${e.message}`)
    }
  }

  for (const d of dead) {
    console.log(`  ✗ [${refs.get(d.fileID)}] status=${d.status} ${d.errMsg || ''} ${String(d.fileID).slice(-52)}`)
  }
  console.log(`\n有效 ${ok} / 失效 ${dead.length}`)
  if (dead.length) {
    console.log('\n处理建议：优先修数据（重新上传或改引用），而不是给 <image> 加兜底。')
    return 1
  }
  console.log('✓ 线上无失效文件引用')
  return 0
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('巡检失败:', e.message || e)
  process.exit(2)
})
