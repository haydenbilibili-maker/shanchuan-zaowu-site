#!/usr/bin/env node
/**
 * 生成小程序 URL Link（https://wxaurl.cn/...）—— 短信 / 邮件等微信外渠道一键打开小程序
 *
 * 两种模式（与 generate-store-qr.js 同构）：
 *
 * --via cloud（默认）：调已部署的 `generateUrlLink` 云函数（cloud.openapi.urllink.generate，无需 AppSecret）。
 *   首次使用会给该函数补 `ADMIN_OPS_KEY` 环境变量（新函数默认没有，见错题本 E22）：
 *   值从既有函数 `manageProducts` 拉取，**只打印长度、不回显**，拉取的临时文件用完即删。
 *   前置：`tcb login` 已登录；`admin/.env` 有 TCB_SECRET_ID / TCB_SECRET_KEY（只读，不打印）。
 *   ⚠️ 2026-10-29 实测：云环境的微信 openapi token 仍失效（-501001 invalid wx openapi access_token，
 *   与 docs/需求28_马上有祈福墙_交付记录 §30.2 同一问题），修好云环境关联前这条路走不通。
 *
 * --via wechat：直连微信 API，用 gitignored 的 `miniprogram/scripts/.env.qr`（QR_APPID / QR_APPSECRET）。
 *   用 `cgi-bin/stable_token`（普通模式，不强刷）换 token：不会让其它服务手里的 access_token 失效；
 *   AppSecret 只放在 POST body 里（不进命令行参数 / ps），不打印。
 *
 * 用法：
 *   node miniprogram/scripts/generate-url-link.cjs [--via cloud|wechat] \
 *     --path subpackages/feature/detail/index --query "id=<商品ID>&from=sms1111" \
 *     [--expire 2026-11-27T23:59:59+08:00] [--env-version release]
 *   --expire 缺省 = 现在 + 29 天 23 小时（微信上限 30 天）。
 *
 * 渠道参数：落地页若记录 `from`（如藏品详情的 product_view.properties.source），
 * 用不同的 from 值区分短信 / 社群 / 横幅即可看各渠道效果。
 */
const fs = require('fs')
const https = require('https')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const ENV_ID = process.env.CLOUD_ENV || 'cloud1-8gnkty5bfff9f0bf'
const FN = 'generateUrlLink'
const TMP = path.join(ROOT, 'miniprogram/scripts/.tmp/urllink')

function arg (name, def) {
  const i = process.argv.indexOf('--' + name)
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def
}

function loadAdminEnv () {
  const file = path.join(ROOT, 'admin/.env')
  const env = {}
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  if (!env.TCB_SECRET_ID || !env.TCB_SECRET_KEY) throw new Error('admin/.env 缺少 TCB_SECRET_ID / TCB_SECRET_KEY')
  return env
}

function pullOpsKey () {
  fs.mkdirSync(TMP, { recursive: true })
  const out = path.join(TMP, 'ref.env')
  try {
    execFileSync('tcb', ['fn', 'env', 'pull', 'manageProducts', '--output-file', out, '--env-id', ENV_ID], {
      cwd: path.join(ROOT, 'miniprogram'), stdio: 'pipe'
    })
    const line = fs.readFileSync(out, 'utf8').split('\n').find((l) => l.startsWith('ADMIN_OPS_KEY='))
    const v = line ? line.slice('ADMIN_OPS_KEY='.length).trim() : ''
    if (!v) throw new Error('manageProducts 上没有 ADMIN_OPS_KEY，无法对齐')
    return v
  } finally {
    try { fs.unlinkSync(out) } catch (_) {}
  }
}

/** 读函数上的 ADMIN_OPS_KEY；缺则补配（合并写入，不覆盖其它变量）并复核 */
async function ensureOpsKey (functions) {
  const vars = async () => {
    const d = await functions.getFunctionDetail(FN)
    const map = {}
    for (const v of ((d && d.Environment && d.Environment.Variables) || [])) if (v && v.Key) map[v.Key] = v.Value
    return map
  }
  const cur = await vars()
  if (cur.ADMIN_OPS_KEY) return cur.ADMIN_OPS_KEY
  const key = pullOpsKey()
  await functions.updateFunctionConfig({ name: FN, envVariables: { ...cur, ADMIN_OPS_KEY: key } })
  const after = await vars()
  if (after.ADMIN_OPS_KEY !== key) throw new Error(FN + ' 补配 ADMIN_OPS_KEY 后复核不一致')
  console.log(`已给 ${FN} 补配 ADMIN_OPS_KEY（取自 manageProducts，长度 ${key.length}，不回显）`)
  return key
}

/** `tcb fn invoke --json` 的真实返回值在 data.RetMsg 的 JSON 字符串里（错题本 E22） */
function invoke (payload) {
  fs.mkdirSync(TMP, { recursive: true })
  const f = path.join(TMP, 'invoke-payload.json')
  fs.writeFileSync(f, JSON.stringify(payload), { mode: 0o600 })
  try {
    const out = execFileSync('tcb', ['fn', 'invoke', FN, '-d', '@' + f, '--json', '-e', ENV_ID], {
      cwd: path.join(ROOT, 'miniprogram'), stdio: 'pipe'
    }).toString()
    const parsed = JSON.parse(out.slice(out.indexOf('{')))
    const ret = parsed && parsed.data && parsed.data.RetMsg
    if (typeof ret === 'string' && ret) return JSON.parse(ret)
    return (ret && typeof ret === 'object') ? ret : parsed
  } finally {
    try { fs.unlinkSync(f) } catch (_) {}
  }
}

function postJson (url, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body))
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { reject(new Error('微信响应非 JSON')) }
      })
    })
    req.on('error', reject)
    req.end(data)
  })
}

function loadQrSecret () {
  const file = path.join(ROOT, 'miniprogram/scripts/.env.qr')
  const map = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m) map[m[1]] = m[2]
  }
  const appid = map.QR_APPID || map.APPID || 'wxf2550373b010b447'
  const secret = map.QR_APPSECRET || map.APPSECRET || ''
  if (!secret) throw new Error('miniprogram/scripts/.env.qr 缺少 QR_APPSECRET')
  return { appid, secret }
}

async function generateViaWechat ({ pagePath, query, envVersion, expireTime }) {
  const { appid, secret } = loadQrSecret()
  const tok = await postJson('https://api.weixin.qq.com/cgi-bin/stable_token', {
    grant_type: 'client_credential', appid, secret, force_refresh: false
  })
  if (!tok.access_token) throw new Error(`换 stable_token 失败：errcode=${tok.errcode} ${tok.errmsg || ''}`)
  const exp = expireTime || Math.floor(Date.now() / 1000) + 30 * 24 * 3600 - 3600
  const r = await postJson(`https://api.weixin.qq.com/wxa/generate_urllink?access_token=${encodeURIComponent(tok.access_token)}`, {
    path: pagePath, query, env_version: envVersion, is_expire: true, expire_type: 0, expire_time: exp
  })
  if (r.errcode || !r.url_link) throw new Error(`generate_urllink 失败：errcode=${r.errcode} ${r.errmsg || ''}`)
  return { success: true, urlLink: r.url_link, path: pagePath, query, envVersion, expireTime: exp }
}

async function main () {
  const via = arg('via', 'cloud')
  const pagePath = arg('path', '').replace(/^\/+/, '')
  const query = arg('query', '')
  const expireArg = arg('expire', '')
  const envVersion = arg('env-version', 'release')
  if (!pagePath) throw new Error('缺少 --path（如 subpackages/feature/detail/index）')
  if (via !== 'cloud' && via !== 'wechat') throw new Error('--via 只能是 cloud 或 wechat')
  let expireTime = 0
  if (expireArg) {
    const t = new Date(expireArg).getTime()
    if (!Number.isFinite(t)) throw new Error('--expire 无法解析：' + expireArg)
    expireTime = Math.floor(t / 1000)
  }

  let r
  if (via === 'wechat') {
    r = await generateViaWechat({ pagePath, query, envVersion, expireTime })
  } else {
    const env = loadAdminEnv()
    const CB = require(path.join(ROOT, 'node_modules/@cloudbase/manager-node'))
    const { functions } = CB.init({ secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY, envId: ENV_ID })
    const opsKey = await ensureOpsKey(functions)
    r = invoke({ path: pagePath, query, envVersion, expireTime, opsKey })
  }
  if (!r || !r.success) throw new Error('生成失败：' + JSON.stringify(r))
  console.log(JSON.stringify({
    urlLink: r.urlLink,
    path: r.path,
    query: r.query,
    envVersion: r.envVersion,
    expireAt: new Date(r.expireTime * 1000).toISOString()
  }, null, 2))
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
