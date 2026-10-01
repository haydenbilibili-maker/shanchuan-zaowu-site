#!/usr/bin/env node
/**
 * 创建专题档案阅读计数的两个集合并部署规则（wiki_stats / wiki_view_marks，均仅云函数可读写）
 * 读写方：云函数 wikiViewStats（miniprogram/cloudfunctions/wikiViewStats）。幂等：已存在则只重写规则。
 *
 * 用法：cd admin && node scripts/provision-wiki-stats.mjs
 * 凭据：admin/.env 的 TCB_SECRET_ID / TCB_SECRET_KEY（勿提交）
 */
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { loadDotEnv, provisionOne, initManager } from './lib/cloudbaseProvision.mjs'

const ADMIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(ADMIN_DIR, '..')
const NAMES = ['wiki_stats', 'wiki_view_marks']

loadDotEnv(ADMIN_DIR)
const { TCB_SECRET_ID: secretId, TCB_SECRET_KEY: secretKey } = process.env
if (!secretId || !secretKey) {
  console.error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY（admin/.env）')
  process.exit(1)
}
const app = await initManager({ secretId, secretKey })
let failed = 0
for (const name of NAMES) {
  const r = await provisionOne(app.database, app.permission, ROOT, name)
  if (r.status === 'failed' || !r.rulesOk) failed += 1
}
process.exit(failed ? 1 : 0)
