#!/usr/bin/env node
/**
 * 构建 admin → public/admin/，保留 README、cloud-check、governance-assets 等非 Vite 产物。
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const adminOut = join(root, 'public', 'admin');
const assetsDir = join(adminOut, 'assets');

if (existsSync(assetsDir)) {
  for (const name of readdirSync(assetsDir)) {
    if (name.startsWith('.')) continue;
    rmSync(join(assetsDir, name), { recursive: true, force: true });
  }
}

execSync('npm run build -w admin', { stdio: 'inherit', cwd: root });

const indexHtml = join(adminOut, 'index.html');
if (!existsSync(indexHtml)) {
  console.error('✗ public/admin/index.html 缺失');
  process.exit(1);
}

console.log('✓ admin 已构建到 public/admin/');
