import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const adminDir = join(process.cwd(), 'dist', 'admin');
const indexHtml = join(adminDir, 'index.html');
const assetsDir = join(adminDir, 'assets');

if (!existsSync(indexHtml)) {
  console.error('✗ dist/admin/index.html 缺失 — 生产环境 /admin 将 404');
  process.exit(1);
}

const assetCount = existsSync(assetsDir)
  ? readdirSync(assetsDir).filter((f) => !f.startsWith('.')).length
  : 0;

if (assetCount === 0) {
  console.error('✗ dist/admin/assets 为空 — 管理端 JS/CSS 未随构建输出');
  process.exit(1);
}

console.log(`✓ dist/admin 已就绪（index.html + ${assetCount} 个 assets 文件）`);
