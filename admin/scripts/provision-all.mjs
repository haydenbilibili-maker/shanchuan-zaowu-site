#!/usr/bin/env node
/**
 * 统一入口：按顺序幂等创建仓库已知 CloudBase 业务集合 + 部署安全规则。
 *
 * 用法：
 *   cd admin && npm run provision:all
 *   cd admin && node scripts/provision-all.mjs
 *   cd admin && node scripts/provision-all.mjs --only=miniapp-ops
 *   cd admin && node scripts/provision-all.mjs --dry-run
 *
 * 密钥：admin/.env 中 TCB_SECRET_ID / TCB_SECRET_KEY（勿提交）
 */
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { ENV_ID, loadDotEnv } from './lib/cloudbaseProvision.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_DIR = join(__dirname, '..')

/** @type {{ id: string, script: string, title: string }[]} */
export const PROVISION_JOBS = [
  { id: 'content', script: 'provision-content-collections.mjs', title: '内容工厂' },
  { id: 'purchase-intents', script: 'provision-purchase-intents.mjs', title: '采购意向' },
  { id: 'purchase-orders', script: 'provision-purchase-orders.mjs', title: '订货单' },
  { id: 'fulfillment-p1', script: 'provision-fulfillment-p1.mjs', title: '出货/库存流水' },
  { id: 'feishu-bridge', script: 'provision-feishu-bridge.mjs', title: '飞书镜像' },
  { id: 'miniapp-ops', script: 'provision-miniapp-ops.mjs', title: '小程序运营对齐（养护/门店/伴宠/积分/候补/客服入口）' },
  { id: 'price-list', script: 'provision-price-list.mjs', title: '官网报价单（price_list_items）' },
]

function parseArgs(argv) {
  const only = []
  let dryRun = false
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true
    else if (a.startsWith('--only=')) {
      only.push(...a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean))
    }
  }
  return { only, dryRun }
}

function runNode(scriptPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: ADMIN_DIR,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

async function main() {
  loadDotEnv(ADMIN_DIR)
  const { only, dryRun } = parseArgs(process.argv.slice(2))
  const jobs = only.length
    ? PROVISION_JOBS.filter((j) => only.includes(j.id))
    : PROVISION_JOBS

  if (!jobs.length) {
    console.error('无匹配任务。可用 id:', PROVISION_JOBS.map((j) => j.id).join(', '))
    process.exitCode = 1
    return
  }

  console.log('CloudBase 环境:', ENV_ID)
  console.log('任务:', jobs.map((j) => j.id).join(', '))
  if (dryRun) {
    console.log('\n[dry-run] 将执行：')
    for (const j of jobs) {
      const p = join(__dirname, j.script)
      console.log(`- ${j.id}: ${j.title} → ${existsSync(p) ? 'OK' : 'MISSING'} ${j.script}`)
    }
    return
  }

  if (!process.env.TCB_SECRET_ID || !process.env.TCB_SECRET_KEY) {
    console.error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY（写入 admin/.env 后重试）')
    process.exitCode = 1
    return
  }

  let failed = 0
  for (const j of jobs) {
    const p = join(__dirname, j.script)
    console.log(`\n======== ${j.title} (${j.id}) ========`)
    if (!existsSync(p)) {
      console.error('脚本不存在', p)
      failed += 1
      continue
    }
    const code = await runNode(p)
    if (code !== 0) {
      console.warn(`任务退出码 ${code}:`, j.id)
      failed += 1
    }
  }

  console.log('\n======== provision:all 结束 ========')
  if (failed) {
    console.warn(`有 ${failed} 个任务失败（见上方日志；规则失败时集合可能已创建）`)
    process.exitCode = 1
  } else {
    console.log('全部任务完成。')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
