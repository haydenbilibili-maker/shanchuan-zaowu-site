#!/usr/bin/env node
/**
 * 为 manageStaff 合并写入 MANAGER_UI_PASSWORD（工作台 UI 门帘）。
 * 不会清空已有 ADMIN_OPS_KEY / MESSAGE_ADMIN_OPENIDS 等变量。
 *
 * 用法：
 *   MANAGER_UI_PASSWORD='xxxx' node scripts/provision-manager-ui-password.cjs
 *   MANAGER_UI_PASSWORD='admin888' node scripts/provision-manager-ui-password.cjs --allow-short
 *   node scripts/provision-manager-ui-password.cjs --generate
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'
const FN = 'manageStaff'
const ADMIN_ENV = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/admin/.env'
const MANAGER_NODE = '/Users/hayden_lee/LifeOS_Workspace/Business_Projects/shanchuanzaowu/node_modules/@cloudbase/manager-node'
const GENERATE = process.argv.includes('--generate')
const ALLOW_SHORT = process.argv.includes('--allow-short')

function loadDotEnv() {
  if (!fs.existsSync(ADMIN_ENV)) throw new Error('缺少 ' + ADMIN_ENV)
  for (const line of fs.readFileSync(ADMIN_ENV, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[k]) process.env[k] = v
  }
}

function envListToObject(list) {
  const out = {}
  ;(list || []).forEach((item) => {
    if (item && item.Key) out[item.Key] = item.Value == null ? '' : String(item.Value)
  })
  return out
}

async function main() {
  loadDotEnv()
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey) throw new Error('缺少 TCB_SECRET_ID / TCB_SECRET_KEY')

  let password = String(process.env.MANAGER_UI_PASSWORD || '').trim()
  if (GENERATE || !password) {
    password = crypto.randomBytes(24).toString('base64url')
  }
  if (password.length < 12 && !ALLOW_SHORT) {
    throw new Error('MANAGER_UI_PASSWORD 至少 12 位（运营约定短口令请加 --allow-short）')
  }
  if (!password) throw new Error('MANAGER_UI_PASSWORD 为空')

  const CloudBase = require(MANAGER_NODE)
  const app = CloudBase.init({ secretId, secretKey, envId: ENV_ID })
  const fnSvc = app.functions || app.function || app

  // manager-node：app.functions.getFunctionDetail / updateFunctionConfig
  const detail = await app.functions.getFunctionDetail(FN)
  const existing = envListToObject(
    (detail && detail.Environment && detail.Environment.Variables) ||
      (detail && detail.EnvVariables) ||
      []
  )

  const merged = Object.assign({}, existing, {
    MANAGER_UI_PASSWORD: password
  })
  // 明文与 hash 二选一即可；有明文时去掉旧 hash，避免歧义
  delete merged.MANAGER_UI_PASSWORD_HASH

  await app.functions.updateFunctionConfig({
    name: FN,
    envVariables: merged
  })

  const out = {
    envId: ENV_ID,
    function: FN,
    at: new Date().toISOString(),
    keysKept: Object.keys(existing).sort(),
    keysAfter: Object.keys(merged).sort(),
    managerUiPasswordSet: true,
    passwordLength: password.length
  }
  const outPath = path.join(__dirname, 'provision-manager-ui-password.result.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log('ok →', outPath)
  console.log('MANAGER_UI_PASSWORD_SET length=', password.length)
  // 明文仅打印一次到 stdout，勿写入仓库文件
  console.log('MANAGER_UI_PASSWORD_PLAINTEXT=' + password)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
