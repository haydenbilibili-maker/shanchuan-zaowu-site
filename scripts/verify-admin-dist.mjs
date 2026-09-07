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

console.log(`✓ dist/admin 已就绪（index.html + ${assetNames.length} 个 assets，校验 ${refs.length} 个引用）`);
