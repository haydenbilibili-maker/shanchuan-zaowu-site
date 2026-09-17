#!/usr/bin/env node
/**
 * 构建 admin → public/admin/，保留 README、cloud-check 等非 Vite 产物。
 *
 * ⚠️ 内部治理文档不上线：`admin/public/` 是 Vite 的 publicDir，构建会把其中**全部内容**
 * 复制进 `public/admin/`（再由 Astro 复制进 `dist/` → Cloudflare Pages）。
 * `governance-assets/`（劳动合同、保密与竞业协议、投资人 BP、股权架构方案…）属内部资料，
 * 因此这里在构建后**强制剔除**，让「勿部署」从注释变成机制。
 * 单一事实源保留在 `admin/public/governance-assets/`（本地/私有环境可用）。
 * 对应守卫：`npm run check:publish-dir`（发布目录不得含内部资料）。
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** 不允许出现在发布产物里的目录（相对 public/admin/） */
const PRIVATE_PUBLISH_DIRS = ['governance-assets'];

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

// 剔除内部资料：Vite 已把它们复制进 public/admin/，这里再删掉并断言删除成功
for (const name of PRIVATE_PUBLISH_DIRS) {
  const target = join(adminOut, name);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
  if (existsSync(target)) {
    console.error(`✗ 内部资料未能从发布目录剔除：public/admin/${name}/（禁止上线）`);
    process.exit(1);
  }
}

console.log(`✓ admin 已构建到 public/admin/（已剔除内部资料：${PRIVATE_PUBLISH_DIRS.join(', ')}）`);
