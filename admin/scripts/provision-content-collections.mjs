#!/usr/bin/env node
/**
 * 在 CloudBase 创建 5 张内容工厂集合（需腾讯云 API 密钥）
 *
 * 用法：
 *   1. 在 admin/.env 写入 TCB_SECRET_ID / TCB_SECRET_KEY（勿提交 git）
 *   2. cd admin && npm run provision:content
 *
 * 或一次性 export：
 *   export TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx
 *   cd admin && node scripts/provision-content-collections.mjs
 */
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_DIR = join(__dirname, '..')
const ROOT = join(ADMIN_DIR, '../')
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'

const COLLECTIONS = [
  'content_topics',
  'content_assets',
  'content_pieces',
  'content_reviews',
  'content_analytics',
]

/** 读取 admin/.env（不覆盖已 export 的环境变量） */
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

function printManualChecklist() {
  console.log('\n请在 CloudBase 控制台手动完成：\n')
  console.log('环境:', ENV_ID)
  console.log('文档: cloudbase/schema/content_factory.md\n')
  for (const name of COLLECTIONS) {
    const rulePath = `cloudbase/rules/${name}.json`
    let rule = '{}'
    try {
      rule = readFileSync(join(ROOT, rulePath), 'utf8').trim()
    } catch {
      /* ignore */
    }
    console.log(`• 新建集合「${name}」`)
    console.log(`  权限 JSON → ${rulePath}`)
    console.log(`  ${rule}\n`)
  }
}

async function tryProvision() {
  loadDotEnv()

  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) {
    console.log('未设置 TCB_SECRET_ID / TCB_SECRET_KEY。')
    console.log('请写入 admin/.env 后重试（见 admin/.env.example 说明）。\n')
    printManualChecklist()
    return
  }

  let CloudBase
  try {
    CloudBase = (await import('@cloudbase/manager-node')).default
  } catch {
    console.log('未安装 @cloudbase/manager-node。运行: cd admin && npm install')
    printManualChecklist()
    return
  }

  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const { database } = app

  for (const name of COLLECTIONS) {
    try {
      if (typeof database.createCollectionIfNotExists === 'function') {
        await database.createCollectionIfNotExists(name)
      } else {
        await database.createCollection(name)
      }
      console.log('✓ 集合已就绪', name)
    } catch (e) {
      const msg = e.message || String(e)
      if (/exist|已存在|already/i.test(msg)) {
        console.log('· 集合已存在', name)
      } else {
        console.warn('⚠', name, msg)
      }
    }
  }

  console.log('\n集合已创建。请在控制台为各集合粘贴 cloudbase/rules/content_*.json 权限规则。')
  console.log('然后运行: cd admin && node scripts/test-content-db.mjs')
}

tryProvision().catch((e) => {
  console.error(e)
  printManualChecklist()
  process.exit(1)
})
