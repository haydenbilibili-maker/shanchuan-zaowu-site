import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const adminDir = join(process.cwd(), 'dist', 'admin');
const indexHtml = join(adminDir, 'index.html');
const assetsDir = join(adminDir, 'assets');

if (!existsSync(indexHtml)) {
  console.error('✗ dist/admin/index.html 缺失 — 生产环境 /admin 将 404');
  process.exit(1);
}

const assetNames = existsSync(assetsDir)
  ? readdirSync(assetsDir).filter((f) => !f.startsWith('.'))
  : [];

if (assetNames.length === 0) {
  console.error('✗ dist/admin/assets 为空 — 管理端 JS/CSS 未随构建输出');
  process.exit(1);
}

const assetSet = new Set(assetNames);
const indexJs = assetNames.find((f) => /^index-.*\.js$/.test(f));
const probeText = [
  readFileSync(indexHtml, 'utf8'),
  indexJs ? readFileSync(join(assetsDir, indexJs), 'utf8') : '',
].join('\n');

const refs = [...new Set(
  [...probeText.matchAll(/assets\/([A-Za-z0-9_.@-]+\.(?:js|css|mjs))/g)].map((m) => m[1]),
)];

const missing = refs.filter((name) => !assetSet.has(name));
if (missing.length) {
  console.error('✗ dist/admin 引用了不存在的 chunk（线上会返回 HTML → MIME 报错）:');
  for (const name of missing.slice(0, 20)) {
    const ci = assetNames.find((f) => f.toLowerCase() === name.toLowerCase());
    console.error(`  - ${name}${ci ? `（磁盘上仅有大小写不同: ${ci}）` : ''}`);
  }
  process.exit(1);
}

const fulfillment = refs.filter((n) => /fulfillmentcenter/i.test(n));
if (!fulfillment.length || !fulfillment.every((n) => assetSet.has(n))) {
  console.error('✗ 订货履约 FulfillmentCenter chunk 缺失或不一致');
  process.exit(1);
}

// ── 密钥泄露闸门 ─────────────────────────────────────────────
// 任何 VITE_ 前缀变量都会被打进前端包；历史上 ADMIN_OPS_KEY 就是这样泄露到
// public/admin 产物与线上 JS 的。这里在部署前扫一遍：只要构建环境里的密钥值
// 出现在产物里就直接 fail，避免同类事故复发。
if (!process.env.SKIP_SECRET_SCAN) {
  const secretEnvRe = /(SECRET|_KEY$|_KEYS$|API_KEY|APIKEYS|PASSWORD|TOKEN|PASSWD)/i;
  const ignore = /^(true|false|null|undefined|0)$/i;
  // 例外：多维表 app_token / app_id 是**文档标识**而非凭据（读取仍需 app_secret，
  // 且服务端 functions/_lib/feishuBitable.mjs 亦以内置默认值兜底），故不阻断构建。
  const IDENTIFIER_OK = /^(FEISHU_APP_TOKEN|FEISHU_APP_ID|VITE_DEEPSEEK_BASE_URL|VITE_DEEPSEEK_MODEL)$/i;
  const isSecretName = (k) => secretEnvRe.test(k) && !IDENTIFIER_OK.test(k);

  // 1) 构建进程环境（CI Secrets 走这条）
  const collected = Object.entries(process.env).map(([k, v]) => [k, String(v || '').trim(), 'env']);

  // 2) admin/.env*（本地构建走这条：Vite 从这里读变量）
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    const file = join(process.cwd(), 'admin', name);
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      collected.push([`admin/${name}:${key}`, value, 'dotenv']);
    }
  }

  const envSecrets = collected.filter(([k, v]) => isSecretName(k.replace(/^.*:/, '')) && v.length >= 8 && !ignore.test(v));

  const scanFiles = ['index.html', ...assetNames.filter((f) => /\.(js|css|mjs)$/i.test(f))];
  const scanText = scanFiles
    .map((name) => {
      const full = name === 'index.html' ? indexHtml : join(assetsDir, name);
      try {
        return { name, text: readFileSync(full, 'utf8') };
      } catch {
        return { name, text: '' };
      }
    });

  const leaks = [];
  for (const [key, value] of envSecrets) {
    for (const { name, text } of scanText) {
      if (text.includes(String(value).trim())) leaks.push(`${key} 的值出现在 ${name}`);
    }
  }

  const patterns = [
    [/sk-[A-Za-z0-9]{20,}/, '疑似大模型厂商密钥（sk- 前缀）'],
    [/adminOpsKey\s*[:=]\s*['"][^'"\s]{8,}['"]/, '前端硬编码 adminOpsKey'],
    [/VITE_ADMIN_OPS_KEY/, '前端仍引用 VITE_ADMIN_OPS_KEY'],
  ];
  for (const [re, label] of patterns) {
    for (const { name, text } of scanText) {
      const m = text.match(re);
      if (m) leaks.push(`${label} → ${name}`);
    }
  }

  if (leaks.length) {
    console.error('✗ 构建产物疑似包含密钥/敏感串，已阻断部署：');
    for (const l of [...new Set(leaks)].slice(0, 20)) console.error(`  - ${l}`);
    console.error('  修复：密钥只放 Cloudflare Pages 环境变量（服务端），勿用 VITE_ 前缀；运维密钥一律经 /api/cloud-fn 代理注入。');
    console.error('  如确认是误报，可临时设置 SKIP_SECRET_SCAN=1 跳过（不建议）。');
    process.exit(1);
  }
  console.log(`✓ 密钥扫描通过（比对 ${envSecrets.length} 个构建环境密钥，扫描 ${scanText.length} 个产物文件）`);
}

console.log(`✓ dist/admin 已就绪（index.html + ${assetNames.length} 个 assets，校验 ${refs.length} 个引用）`);
