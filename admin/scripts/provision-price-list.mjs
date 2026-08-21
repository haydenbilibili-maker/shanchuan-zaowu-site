#!/usr/bin/env node
/**
 * 官网报价单集合：price_list_items
 *
 * 幂等：已存在则跳过创建；每次尝试部署 cloudbase/rules/price_list_items.json
 *
 * 用法：
 *   1. admin/.env 写入 TCB_SECRET_ID / TCB_SECRET_KEY（勿提交）
 *   2. cd admin && npm run provision:price-list
 */
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import {
  ENV_ID,
  loadDotEnv,
  printManual,
  provisionOne,
  initManager,
} from './lib/cloudbaseProvision.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_DIR = join(__dirname, '..')
const ROOT = join(ADMIN_DIR, '../')

export const COLLECTIONS = ['price_list_items']

async function main() {
  loadDotEnv(ADMIN_DIR)
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) {
    console.log('未设置 TCB_SECRET_ID / TCB_SECRET_KEY')
    console.log('请写入 admin/.env（见 admin/.env.example）后重试。\n')
    COLLECTIONS.forEach((n) => printManual(ROOT, n))
    process.exitCode = 1
    return
  }

  let app
  try {
    app = await initManager({ secretId, secretKey, envId: ENV_ID })
  } catch (e) {
    console.log(e.message || e)
    COLLECTIONS.forEach((n) => printManual(ROOT, n))
    process.exitCode = 1
    return
  }

  const { database, permission } = app
  console.log('环境:', ENV_ID)
  console.log('集合:', COLLECTIONS.join(', '))
  console.log('')

  const summary = { created: [], existed: [], failed: [] }
  for (const name of COLLECTIONS) {
    const r = await provisionOne(database, permission, ROOT, name)
    if (r.status === 'created') summary.created.push(name)
    else if (r.status === 'existed') summary.existed.push(name)
    else summary.failed.push(name)
  }

  console.log('\n—— 汇总 ——')
  console.log('新建:', summary.created.length ? summary.created.join(', ') : '（无）')
  console.log('已存在:', summary.existed.length ? summary.existed.join(', ') : '（无）')
  console.log('失败:', summary.failed.length ? summary.failed.join(', ') : '（无）')

  if (summary.failed.length) process.exitCode = 1
  else console.log('\n完成。Admin 菜单：业务运营 → 报价单配置（57）。')
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
