#!/usr/bin/env node
/**
 * 批量应用数据库安全规则（cloudbase/rules/*.json）到 CloudBase 环境
 *
 * 背景：规则文件在仓库里是"源码"，要在云开发控制台逐集合粘贴才算生效。
 * 本脚本用 @cloudbase/manager-node 的 permission.modifyResourcePermission
 * （resourceType=collection + permission=CUSTOM + securityRule）批量应用，并读回校验。
 *
 * 用法：
 *   cd admin && node scripts/apply-database-rules.mjs --dry-run           # 只读：打印当前规则与差异
 *   cd admin && node scripts/apply-database-rules.mjs --only studio_inventory,ops_purchases
 *   cd admin && node scripts/apply-database-rules.mjs                     # 应用全部规则文件
 *   cd admin && node scripts/apply-database-rules.mjs --force             # 即使已一致也重写
 *
 * 凭据：admin/.env 的 TCB_SECRET_ID / TCB_SECRET_KEY（勿提交）
 * 安全：默认逐条比对，已一致则跳过；集合不存在则跳过并提示；任何失败都会在结尾汇总并非零退出。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_DIR = join(__dirname, '..')
const ROOT = join(ADMIN_DIR, '..')
const RULES_DIR = join(ROOT, 'cloudbase', 'rules')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'

function loadDotEnv() {
  for (const name of ['.env', '.env.local']) {
    const path = join(ADMIN_DIR, name)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (key && val && !process.env[key]) process.env[key] = val
    }
  }
}

function parseArgs(argv) {
  const out = { dryRun: false, force: false, only: null, probe: null, createMissing: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--force') out.force = true
    else if (a === '--create-missing') out.createMissing = true
    else if (a === '--probe') {
      out.probe = String(argv[i + 1] || '').trim()
      i += 1
    }
    else if (a === '--only') {
      out.only = String(argv[i + 1] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      i += 1
    }
  }
  return out
}

/** 归一化规则 JSON 便于比较（键排序、忽略空白） */
function normalizeRule(raw) {
  if (raw == null) return ''
  if (typeof raw === 'object') return JSON.stringify(sortKeys(raw))
  const text = String(raw).trim()
  if (!text) return ''
  try {
    return JSON.stringify(sortKeys(JSON.parse(text)))
  } catch {
    return text
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortKeys(value[k])
        return acc
      }, {})
  }
  return value
}

/** 兼容返回体结构：新版嵌在 Data 下，旧版在顶层 */
function readPermissionList(res) {
  if (!res) return []
  const list = (res.Data && res.Data.PermissionList) || res.PermissionList
  return Array.isArray(list) ? list : []
}

function loadRuleFiles(only) {
  const files = readdirSync(RULES_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort()
  const targets = []
  for (const f of files) {
    const name = f.slice(0, -5)
    if (only && !only.includes(name)) continue
    const text = readFileSync(join(RULES_DIR, f), 'utf8')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      targets.push({ name, error: `规则 JSON 非法：${e.message}` })
      continue
    }
    targets.push({ name, rule: parsed, text: JSON.stringify(parsed) })
  }
  return targets
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  loadDotEnv()

  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) {
    console.error('✗ 缺少 TCB_SECRET_ID / TCB_SECRET_KEY（写入 admin/.env 后重试）')
    process.exit(2)
  }

  const targets = loadRuleFiles(args.only)
  if (!targets.length) {
    console.error('✗ 没有匹配的规则文件')
    process.exit(2)
  }

  const { default: CloudBase } = await import('@cloudbase/manager-node')
  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const { database, permission } = app

  // 探查模式：打印某个集合权限接口的原始返回，用于确认接口可用性与字段结构
  if (args.probe) {
    console.log(`探查集合：${args.probe}\n`)
    try {
      const raw = await permission.describeResourcePermission({
        resourceType: 'collection',
        resources: [args.probe],
      })
      console.log('describeResourcePermission →')
      console.log(JSON.stringify(raw, null, 2))
    } catch (e) {
      console.log('describeResourcePermission 失败：', (e && (e.message || e.errMsg)) || e)
    }
    try {
      const list = await permission.describeResourcePermission({ resourceType: 'collection' })
      const rows = (list && list.PermissionList) || []
      console.log(`\n不带 resources 的返回：TotalCount=${list && list.TotalCount} 实际条目=${rows.length}`)
      console.log(JSON.stringify(rows.slice(0, 5), null, 2))
    } catch (e) {
      console.log('\n不带 resources 的调用失败：', (e && (e.message || e.errMsg)) || e)
    }
    return
  }

  console.log(`环境：${ENV_ID}   目标规则：${targets.length} 个   ${args.dryRun ? '模式：只读预演' : '模式：写入'}\n`)

  const results = { applied: [], skippedSame: [], missing: [], failed: [] }

  for (const t of targets) {
    if (t.error) {
      results.failed.push(`${t.name}: ${t.error}`)
      console.log(`✗ ${t.name}  ${t.error}`)
      continue
    }

    let exists = true
    try {
      const res = await database.checkCollectionExists(t.name)
      exists = !!(res && (res.Exists ?? res.exist ?? true))
    } catch (e) {
      // 查询失败不阻断，交给后续写接口暴露真实错误
      exists = true
    }
    if (!exists) {
      if (args.createMissing && !args.dryRun) {
        try {
          await database.createCollectionIfNotExists(t.name)
          exists = true
          console.log(`+ ${t.name}  集合已创建，继续应用规则`)
        } catch (e) {
          results.failed.push(`${t.name}: 创建集合失败 ${(e && (e.message || e.errMsg)) || e}`)
          console.log(`✗ ${t.name}  创建集合失败`)
          continue
        }
      }
    }
    if (!exists) {
      results.missing.push(t.name)
      console.log(`· ${t.name}  集合不存在，跳过`)
      continue
    }

    let currentRule = ''
    let currentPermission = ''
    try {
      const desc = await permission.describeResourcePermission({
        resourceType: 'collection',
        resources: [t.name],
      })
      const row = readPermissionList(desc)[0] || null
      currentRule = row ? normalizeRule(row.SecurityRule) : ''
      currentPermission = row ? String(row.Permission || '') : ''
    } catch (e) {
      console.log(`· ${t.name}  读取当前权限失败：${e.message}`)
    }

    const wantRule = normalizeRule(t.rule)
    if (!args.force && currentRule && currentRule === wantRule) {
      results.skippedSame.push(t.name)
      console.log(`= ${t.name}  已一致（${currentPermission || 'CUSTOM'}）`)
      continue
    }

    const before = currentRule || '(未读到)'
    if (args.dryRun) {
      console.log(`~ ${t.name}  将写入：${t.text}`)
      console.log(`    当前：${before}`)
      continue
    }

    try {
      await permission.modifyResourcePermission({
        resourceType: 'collection',
        resource: t.name,
        permission: 'CUSTOM',
        securityRule: t.text,
      })
      const verify = await permission.describeResourcePermission({
        resourceType: 'collection',
        resources: [t.name],
      })
      const row = readPermissionList(verify)[0] || null
      const after = row ? normalizeRule(row.SecurityRule) : ''
      if (after === wantRule) {
        results.applied.push(t.name)
        console.log(`✓ ${t.name}  ${before}  →  ${t.text}`)
      } else {
        results.failed.push(`${t.name}: 写入后校验不一致（实际 ${after || '(空)'}）`)
        console.log(`✗ ${t.name}  写入后校验不一致：${after || '(空)'}`)
      }
    } catch (e) {
      const msg = (e && (e.message || e.errMsg)) || String(e)
      results.failed.push(`${t.name}: ${msg}`)
      console.log(`✗ ${t.name}  ${msg}`)
    }
  }

  console.log('\n== 汇总 ==')
  console.log(`  ${args.dryRun ? '待写入' : '已写入'}：${results.applied.length}`)
  console.log(`  已一致跳过：${results.skippedSame.length}${results.skippedSame.length ? ' → ' + results.skippedSame.join(', ') : ''}`)
  console.log(`  集合不存在：${results.missing.length}${results.missing.length ? ' → ' + results.missing.join(', ') : ''}`)
  console.log(`  失败：${results.failed.length}${results.failed.length ? ' → ' + results.failed.join(' | ') : ''}`)

  if (results.failed.length) process.exit(1)
}

main().catch((e) => {
  console.error('✗ 执行失败：', (e && (e.message || e.errMsg)) || e)
  process.exit(1)
})
