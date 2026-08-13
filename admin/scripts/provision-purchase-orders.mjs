#!/usr/bin/env node
/**
 * 创建 CloudBase 集合 purchase_orders 并部署自定义安全规则
 *
 * 用法：
 *   1. admin/.env 写入 TCB_SECRET_ID / TCB_SECRET_KEY（勿提交 git）
 *   2. cd admin && node scripts/provision-purchase-orders.mjs
 */
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_DIR = join(__dirname, '..')
const ROOT = join(ADMIN_DIR, '../')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const COLLECTION = 'purchase_orders'
const RULE_PATH = join(ROOT, 'cloudbase/rules/purchase_orders.json')

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

function printManual() {
  let rule = '{}'
  try {
    rule = readFileSync(RULE_PATH, 'utf8').trim()
  } catch {
    /* ignore */
  }
  console.log('\n—— 控制台手动步骤 ——')
  console.log('环境:', ENV_ID)
  console.log('1. https://console.cloud.tencent.com/tcb → 数据库 → 新建集合 →', COLLECTION)
  console.log('2. 集合 → 权限设置 → 自定义安全规则 → 粘贴：')
  console.log(rule)
  console.log('3. 微信开发者工具上传并部署云函数 managePurchaseOrder')
  console.log('文档: cloudbase/schema/purchase_orders.md')
  console.log('蓝图: admin/docs/订货履约与成品库存_Phase1_技术蓝图.md\n')
}

async function main() {
  loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) {
    console.log('未设置 TCB_SECRET_ID / TCB_SECRET_KEY。')
    printManual()
    process.exitCode = 1
    return
  }

  if (!existsSync(RULE_PATH)) {
    console.error('缺少规则文件:', RULE_PATH)
    process.exit(1)
  }
  const ruleObj = JSON.parse(readFileSync(RULE_PATH, 'utf8'))
  const securityRule = JSON.stringify(ruleObj)

  let CloudBase
  try {
    CloudBase = (await import('@cloudbase/manager-node')).default
  } catch {
    console.log('未安装 @cloudbase/manager-node。运行: npm install（仓库根或 admin）')
    printManual()
    process.exitCode = 1
    return
  }

  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const { database, permission } = app

  console.log('环境:', ENV_ID)
  console.log('集合:', COLLECTION)

  try {
    const created = await database.createCollectionIfNotExists(COLLECTION)
    if (created?.IsCreated) {
      console.log('✓ 集合已创建', COLLECTION)
    } else {
      console.log('· 集合已存在', COLLECTION)
    }
  } catch (e) {
    const msg = e.message || String(e)
    if (/exist|已存在|already/i.test(msg)) {
      console.log('· 集合已存在', COLLECTION)
    } else {
      console.warn('⚠ 创建集合失败:', msg)
      printManual()
      process.exitCode = 1
      return
    }
  }

  try {
    const res = await permission.modifyResourcePermission({
      resourceType: 'collection',
      resource: COLLECTION,
      permission: 'CUSTOM',
      securityRule,
    })
    console.log('✓ 安全规则已部署', securityRule)
    if (res?.RequestId) console.log('  RequestId:', res.RequestId)
  } catch (e) {
    console.warn('⚠ 规则部署失败:', e.message || e)
    console.log('请在控制台手动粘贴规则。')
    printManual()
    process.exitCode = 1
    return
  }

  console.log('\n完成。下一步：部署云函数 managePurchaseOrder → 店长后台「订货」下单 → ERP「订货履约」确认。')
}

main().catch((e) => {
  console.error(e)
  printManual()
  process.exit(1)
})
