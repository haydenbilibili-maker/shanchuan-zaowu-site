#!/usr/bin/env node
/**
 * 飞书对接：创建 feishu_purchases / feishu_inventory / feishu_sync_logs
 *   cd admin && node scripts/provision-feishu-bridge.mjs
 */
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_DIR = join(__dirname, '..')
const ROOT = join(ADMIN_DIR, '../')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTIONS = ['feishu_purchases', 'feishu_inventory', 'feishu_sync_logs']

function loadDotEnv() {
  const path = join(ADMIN_DIR, '.env')
  if (!existsSync(path)) return
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
    if (!process.env[key]) process.env[key] = val
  }
}

function printManual(name) {
  const rulePath = join(ROOT, `cloudbase/rules/${name}.json`)
  let rule = '{}'
  try {
    rule = readFileSync(rulePath, 'utf8').trim()
  } catch {
    /* ignore */
  }
  console.log('\n—— 手动：', name, '——')
  console.log('1. 控制台新建集合', name)
  console.log('2. 自定义安全规则：')
  console.log(rule)
}

async function provisionOne(database, permission, name) {
  const rulePath = join(ROOT, `cloudbase/rules/${name}.json`)
  if (!existsSync(rulePath)) {
    console.error('缺少规则', rulePath)
    return false
  }
  const securityRule = JSON.stringify(JSON.parse(readFileSync(rulePath, 'utf8')))

  try {
    const created = await database.createCollectionIfNotExists(name)
    console.log(created?.IsCreated ? '✓ 已创建' : '· 已存在', name)
  } catch (e) {
    const msg = e.message || String(e)
    if (/exist|已存在|already/i.test(msg)) console.log('· 已存在', name)
    else {
      console.warn('⚠ 创建失败', name, msg)
      printManual(name)
      return false
    }
  }

  try {
    const res = await permission.modifyResourcePermission({
      resourceType: 'collection',
      resource: name,
      permission: 'CUSTOM',
      securityRule,
    })
    console.log('✓ 规则已部署', name, res?.RequestId || '')
    return true
  } catch (e) {
    console.warn('⚠ 规则失败', name, e.message || e)
    printManual(name)
    return false
  }
}

async function main() {
  loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) {
    console.log('未设置 TCB_SECRET_ID / TCB_SECRET_KEY')
    COLLECTIONS.forEach(printManual)
    process.exitCode = 1
    return
  }

  let CloudBase
  try {
    CloudBase = (await import('@cloudbase/manager-node')).default
  } catch {
    console.log('未安装 @cloudbase/manager-node')
    COLLECTIONS.forEach(printManual)
    process.exitCode = 1
    return
  }

  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const { database, permission } = app
  console.log('环境:', ENV_ID)

  let ok = true
  for (const name of COLLECTIONS) {
    const r = await provisionOne(database, permission, name)
    if (!r) ok = false
  }
  if (!ok) process.exitCode = 1
  else console.log('\n完成。请在微信开发者工具上传云函数 syncFeishuBitable（配置 FEISHU_APP_ID / FEISHU_APP_SECRET）。')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
