#!/usr/bin/env node
/**
 * 门店 / 运营物料小程序码生成脚本（默认：AI 识别主页，scene=from=store_qr）
 *
 * 模式 A（--via wechat）：直连微信开放平台（需 APPID + APPSECRET，一次性密钥）
 *   密钥来源：环境变量 QR_APPID / QR_APPSECRET，或 gitignored 文件 scripts/.env.qr（KEY=VALUE 每行）
 *   node scripts/generate-store-qr.js --via wechat --scene "from=store_qr" \
 *        --out scripts/qr-assets/identify-store-qr.png
 *
 * 模式 B（--via cloud）：调用已部署的 getStoreQRCode 云函数（无 AppSecret 泄露，可重复生成）
 *   前置：tcb login（微信扫码）→ 部署 getStoreQRCode；环境变量 STORE_QR_OPS_KEY = 云函数 ADMIN_OPS_KEY
 *   STORE_QR_OPS_KEY=xxx node scripts/generate-store-qr.js --via cloud --scene "from=store_qr" \
 *        --out scripts/qr-assets/identify-store-qr.png
 *
 * 默认参数：page=subpackages/feature/identify/index  scene=from=store_qr
 *           envVersion=release  width=430  hyaline=true  品牌黄铜色 #C4A76C
 */
const https = require('https')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const ENV_ID = process.env.CLOUD_ENV || 'cloud1-8gnkty5bfff9f0bf'
const DEFAULT_APPID = 'wxf2550373b010b447'
const BRASS = { r: 196, g: 167, b: 108 } // #C4A76C

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args[key] = next
        i++
      } else {
        args[key] = true
      }
    }
  }
  return args
}

function loadDotEnv(file) {
  const map = {}
  try {
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
      if (m) map[m[1]] = m[2]
    }
  } catch (e) { /* ignore */ }
  return map
}

function getSecret(appId, appSecret) {
  const envFile = loadDotEnv(path.join(ROOT, 'scripts/.env.qr'))
  const id = appId || process.env.QR_APPID || envFile.QR_APPID || envFile.APPID || DEFAULT_APPID
  const secret = appSecret || process.env.QR_APPSECRET || envFile.QR_APPSECRET || envFile.APPSECRET || ''
  return { id, secret }
}

function httpsJson(url, options, body) {
  return new Promise((resolve, reject) => {
    const opts = Object.assign({}, options)
    opts.headers = Object.assign({ 'User-Agent': 'shanchuanspecimens-store-qr/1.0' }, opts.headers)
    const req = https.request(url, opts, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function viaWechat(opts) {
  const { id, secret } = getSecret(opts.appid, opts.appsecret)
  if (!secret) {
    console.error('缺少 AppSecret：请通过环境变量 QR_APPSECRET 或 scripts/.env.qr 提供（该文件已 gitignore）')
    process.exit(1)
  }
  // 注：微信 API 网关会拒绝 Node 默认 TLS 指纹（412 空体），这里统一走系统 curl
  const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(id)}&secret=${encodeURIComponent(secret)}`
  let tokenRaw = ''
  try {
    tokenRaw = execFileSync('curl', ['-sS', tokenUrl], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  } catch (e) {
    console.error('curl 获取 access_token 失败：', e.message)
    process.exit(1)
  }
  let tokenJson = {}
  try {
    tokenJson = JSON.parse(tokenRaw)
  } catch (e) {
    console.error('access_token 响应解析失败：', tokenRaw.slice(0, 200))
    process.exit(1)
  }
  if (!tokenJson.access_token) {
    console.error('获取 access_token 失败：', JSON.stringify(tokenJson))
    process.exit(1)
  }
  const codeUrl = `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(tokenJson.access_token)}`
  const payload = JSON.stringify({
    scene: opts.scene,
    page: opts.page,
    check_path: false,
    env_version: opts.envVersion,
    width: opts.width,
    auto_color: false,
    line_color: { r: BRASS.r, g: BRASS.g, b: BRASS.b },
    is_hyaline: opts.hyaline
  })
  const tmp = path.join(os.tmpdir(), `wx-store-qr-${Date.now()}.png`)
  try {
    execFileSync('curl', ['-sS', '-X', 'POST', codeUrl, '-H', 'Content-Type: application/json', '-d', payload, '-o', tmp], {
      stdio: ['ignore', 'ignore', 'inherit'],
      maxBuffer: 20 * 1024 * 1024
    })
  } catch (e) {
    console.error('curl 获取小程序码失败：', e.message)
    process.exit(1)
  }
  const buf = fs.readFileSync(tmp)
  try { fs.unlinkSync(tmp) } catch (e) { /* ignore */ }
  // 出错时微信返回 JSON；成功返回图片二进制
  if (buf[0] === 0x7b /* { */) {
    console.error('小程序码接口返回错误：', buf.toString('utf8'))
    process.exit(1)
  }
  if (buf.length < 1024) {
    console.error('返回体过小，疑似异常：', buf.toString('utf8'))
    process.exit(1)
  }
  return buf
}

function viaCloud(opts) {
  // 运维密钥：优先 STORE_QR_OPS_KEY；否则回退读取 monorepo 的 admin/.env.local（本地文件，不打印）
  let opsKey = process.env.STORE_QR_OPS_KEY || ''
  if (!opsKey) {
    const localAdminEnv = loadDotEnv(path.join(ROOT, '..', 'admin', '.env.local'))
    opsKey = localAdminEnv.ADMIN_OPS_KEY || ''
  }
  if (!opsKey) {
    console.error('缺少 STORE_QR_OPS_KEY（或 admin/.env.local 中的 ADMIN_OPS_KEY）')
    process.exit(1)
  }
  const params = JSON.stringify({
    page: opts.page,
    scene: opts.scene,
    envVersion: opts.envVersion,
    width: opts.width,
    hyaline: opts.hyaline,
    opsKey
  })
  let stdout = ''
  try {
    stdout = execFileSync('tcb', ['fn', 'invoke', 'getStoreQRCode', '-e', ENV_ID, '--params', params], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    })
  } catch (e) {
    console.error('tcb 调用失败：', (e.stdout || '') + (e.stderr || ''))
    process.exit(1)
  }
  // tcb CLI 输出带 banner 与 "Return result：" 前缀，取最后一个完整 JSON 对象
  const i = stdout.lastIndexOf('{')
  const j = stdout.lastIndexOf('}')
  if (i === -1 || j === -1 || j < i) {
    console.error('无法从 tcb 输出解析 JSON：', stdout.slice(0, 500))
    process.exit(1)
  }
  const res = JSON.parse(stdout.slice(i, j + 1))
  if (!res || !res.success || !res.base64) {
    console.error('云函数返回异常：', JSON.stringify(res))
    process.exit(1)
  }
  return Buffer.from(res.base64, 'base64')
}

async function main() {
  const args = parseArgs(process.argv)
  const via = args.via === 'wechat' ? 'wechat' : 'cloud'
  const opts = {
    page: args.page || 'subpackages/feature/identify/index',
    scene: args.scene || 'from=store_qr',
    envVersion: args.envVersion || 'release',
    width: Number(args.width) || 430,
    hyaline: args.hyaline !== 'false',
    out: args.out || 'scripts/qr-assets/identify-store-qr.png',
    manifest: args.manifest || '',
    appid: args.appid,
    appsecret: args.appsecret
  }
  if (opts.scene.length > 32) {
    console.error('scene 超过 32 字符上限：', opts.scene.length)
    process.exit(1)
  }
  console.log(`生成门店码 via=${via} page=${opts.page} scene=${opts.scene} env=${opts.envVersion}`)
  const buf = via === 'wechat' ? await viaWechat(opts) : viaCloud(opts)
  const outPath = path.resolve(ROOT, opts.out)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, buf)
  // 清单：这张码印出去就改不了，得留下"它指向哪、scene 是什么"的可核对记录。
  // 守卫 scripts/check-wall-qr.mjs 会把 manifest.scene 直接喂给页面的解析器做端到端断言。
  if (opts.manifest) {
    // ⚠️ 与 --out 同一基准（都相对 miniprogram/）：第一版这里相对仓库根，结果 --out 写成
    // `miniprogram/scripts/...` 时两个文件落到不同层级（生成物跑到 miniprogram/miniprogram/ 下）
    const manifestPath = path.isAbsolute(opts.manifest) ? opts.manifest : path.resolve(ROOT, opts.manifest)
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
    fs.writeFileSync(manifestPath, JSON.stringify({
      page: opts.page,
      scene: opts.scene,
      envVersion: opts.envVersion,
      width: opts.width,
      hyaline: opts.hyaline,
      out: path.relative(ROOT, outPath).replace(/\\/g, '/'),
      generatedAt: new Date().toISOString()
    }, null, 2) + '\n')
  }
  console.log(`已保存：${outPath}（${(buf.length / 1024).toFixed(1)} KB）`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
