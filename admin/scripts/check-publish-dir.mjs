#!/usr/bin/env node
/**
 * 发布目录守卫 · 内部资料不得上线
 *
 * 为什么必须有它（2026-09-17 全面审计 A1）：
 *   `admin/public/` 是 Vite 的 publicDir，构建时被**原样复制**进 `public/admin/`；
 *   `public/` 又是 Astro 的静态目录，被复制进 `dist/` → Cloudflare Pages。
 *   于是 `governance-assets/`（劳动合同、保密与竞业协议、投资人 BP、股权架构方案…）
 *   曾被公开部署，任何人直链可下载（已线上实测 HTTP 200）。
 *   `public/admin/README.md` 写着「勿部署」，但此前**没有任何机制执行**这条禁令。
 *
 * 本守卫把禁令变成可失败的检查：
 *   R1 `public/admin/governance-assets/` 不得存在（发布副本必须已移除）
 *   R2 `admin/public/governance-assets/` 必须存在且非空（单一事实源，防「删过头」把功能删没）
 *   R3 `dist/admin/governance-assets/` 不得存在（若 dist/ 已构建）
 *   R4 `public/**` 下不得出现 Office 二进制（.doc/.docx/.ppt/.pptx/.xls/.xlsx）
 *
 * 用法：
 *   node admin/scripts/check-publish-dir.mjs
 *   node admin/scripts/check-publish-dir.mjs --selftest   # 注入回归 → 必须检出 → 清理
 */
'use strict';

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/** 不得出现在发布产物里的内部资料目录（相对 public/admin/） */
export const PRIVATE_PUBLISH_DIRS = ['governance-assets'];
/** 允许留在 public/ 的 Office 文件（当前为空：内部文档一律不进站点） */
export const ALLOWED_PUBLIC_OFFICE_FILES = [];
const OFFICE_EXT = /\.(doc|docx|ppt|pptx|xls|xlsx)$/i;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** 纯检查：返回 { failures: string[], info: string[] } */
export function runChecks(root = ROOT) {
  const failures = [];
  const info = [];

  // R1：发布目录里不得有内部资料
  for (const name of PRIVATE_PUBLISH_DIRS) {
    const published = join(root, 'public', 'admin', name);
    if (existsSync(published)) {
      failures.push(`R1 内部资料出现在发布目录：public/admin/${name}/（构建会把 public/ 复制进 dist/ 上线）`);
    }
  }

  // R2：单一事实源必须还在（防「一刀切删除」把功能删没）
  for (const name of PRIVATE_PUBLISH_DIRS) {
    const source = join(root, 'admin', 'public', name);
    if (!existsSync(source)) {
      failures.push(`R2 单一事实源缺失：admin/public/${name}/ 不存在 —— 内部资料库（ERP 公司治理页）将失去文件来源`);
    } else if (walk(source).length === 0) {
      failures.push(`R2 单一事实源为空：admin/public/${name}/ 下没有任何文件`);
    } else {
      info.push(`admin/public/${name}/ 保留 ${walk(source).length} 个文件（本地/私有环境可用）`);
    }
  }

  // R3：已构建的 dist 里不得有内部资料
  const dist = join(root, 'dist');
  if (existsSync(dist)) {
    for (const name of PRIVATE_PUBLISH_DIRS) {
      const inDist = join(dist, 'admin', name);
      if (existsSync(inDist)) {
        failures.push(`R3 已构建产物含内部资料：dist/admin/${name}/ —— 部署即泄露（重跑 npm run build）`);
      }
    }
  }

  // R4：public/ 下不得出现 Office 二进制
  const publicDir = join(root, 'public');
  for (const file of walk(publicDir)) {
    const rel = file.slice(publicDir.length + 1);
    if (!OFFICE_EXT.test(rel)) continue;
    if (ALLOWED_PUBLIC_OFFICE_FILES.includes(rel)) continue;
    failures.push(`R4 Office 文档不得进站点静态目录：public/${rel}`);
  }

  return { failures, info };
}

function report(result) {
  for (const line of result.info) console.log(`  · ${line}`);
  if (result.failures.length) {
    console.error(`✗ 发布目录守卫失败（${result.failures.length} 项）：`);
    for (const f of result.failures) console.error(`  - ${f}`);
    console.error('  背景见 docs/全面审计_2026-09-17/README.md A1。内部资料只存仓库内非发布目录。');
    return 1;
  }
  console.log('✓ 发布目录守卫通过（内部资料不在发布路径，单一事实源完好）');
  return 0;
}

function selftest() {
  console.log('— 发布目录守卫 · 自检 —');
  const baseline = runChecks();
  if (baseline.failures.length) {
    console.error('✗ 自检前提不成立：基线本身就没过，先修好再自检');
    for (const f of baseline.failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log('  基线：通过');

  const probeDir = join(ROOT, 'public', 'admin', 'governance-assets');
  const probeFile = join(ROOT, 'public', '__selftest_probe.docx');
  const created = [];
  let failed = 0;
  try {
    // 注入 1：把内部资料目录放回发布路径 → R1 必须命中
    mkdirSync(probeDir, { recursive: true });
    created.push(probeDir);
    writeFileSync(join(probeDir, '__probe.txt'), 'probe');
    const r1 = runChecks();
    if (r1.failures.some((f) => f.startsWith('R1'))) {
      console.log('  ✓ 注入「内部资料回到发布目录」→ R1 命中');
    } else {
      console.error('  ✗ 注入「内部资料回到发布目录」未被检出');
      failed++;
    }

    // 注入 2：往 public/ 放一个 Office 文档 → R4 必须命中
    writeFileSync(probeFile, 'probe');
    created.push(probeFile);
    const r4 = runChecks();
    if (r4.failures.some((f) => f.startsWith('R4'))) {
      console.log('  ✓ 注入「Office 文档进入 public/」→ R4 命中');
    } else {
      console.error('  ✗ 注入「Office 文档进入 public/」未被检出');
      failed++;
    }
  } finally {
    for (const p of created.reverse()) rmSync(p, { recursive: true, force: true });
  }

  const after = runChecks();
  if (after.failures.length) {
    console.error('✗ 自检清理后仍有失败项（探针未清理干净）：');
    for (const f of after.failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log('  ✓ 探针已清理，基线恢复');

  if (failed) {
    console.error(`✗ 自检失败（${failed} 项注入未被检出）`);
    return 1;
  }
  console.log('✓ 自检通过：2 项注入全部检出，且未残留');
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const code = process.argv.includes('--selftest') ? selftest() : report(runChecks());
  process.exit(code);
}
