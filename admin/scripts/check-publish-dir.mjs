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
 *   R5 发布路径里的**文件名**不得带内部资料关键词（capital / equity / cost-model / destiny / 股权 / 融资 / 劳动合同…）
 *   R6 发布路径里的**独立文档**（html/md/txt/csv/json）内容不得带内部资料关键词（股权架构 / 资本架构 / 八字 / 劳动合同…）
 *      R5/R6 扫：public/**（除 public/admin/assets/ 哈希 chunk）、admin/public/**（除 governance-assets/）、
 *      dist/admin/**（除 assets/，若已构建）。ERP 组件 chunk 名里本来就有 CapitalArchitectureSandbox 等字样，故不扫 assets。
 *      2026-09-29：资本架构沙盘 / 启动成本模型 / 合伙人命理全书（11 人生辰八字）/ 三有名录 PDF
 *      曾直接放在 admin/public/ 根目录，绕过了只认 governance-assets 目录名的 R1–R3，被公开部署数月。
 *
 * 用法：
 *   node admin/scripts/check-publish-dir.mjs
 *   node admin/scripts/check-publish-dir.mjs --selftest   # 注入回归 → 必须检出 → 清理
 */
'use strict';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/** 不得出现在发布产物里的内部资料目录（相对 public/admin/） */
export const PRIVATE_PUBLISH_DIRS = ['governance-assets'];
/** 允许留在 public/ 的 Office 文件（当前为空：内部文档一律不进站点） */
export const ALLOWED_PUBLIC_OFFICE_FILES = [];
const OFFICE_EXT = /\.(doc|docx|ppt|pptx|xls|xlsx)$/i;

/** R5：文件名关键词（只看文件名，不看目录：官网 /for-investors/ 这类公开页的路径不算） */
export const INTERNAL_NAME_RE = new RegExp(
  [
    'capital', 'equity', 'cap[-_ ]?table', 'cost[-_ ]?model', 'startup[-_ ]?cost', 'destiny', 'bazi', 'fortune',
    'payroll', 'salary', 'valuation', 'shareholder', 'pitch[-_ ]?deck', 'investor[-_ ]?deck',
    'labou?r[-_ ]?contract', 'employment[-_ ]?contract', '(?:^|[-_. ])(?:bp|nda)(?:[-_. ]|$)',
    '股权', '股东', '融资', '估值', '成本模型', '劳动合同', '保密', '竞业', '工资', '薪酬', '命理', '八字',
  ].join('|'),
  'i',
);
/** R6：独立文档内容关键词（刻意只收「内部资料才会出现」的短语，普通营销文案不会命中） */
export const INTERNAL_TEXT_RE =
  /股权架构|资本架构|股东协议|期权池|劳动合同|竞业限制|保密协议|生辰八字|命理全书|投资人\s*BP|融资计划|启动成本|估值模型|cap\s*table/i;
const TEXT_DOC_EXT = /\.(html?|md|txt|csv|json)$/i;
/**
 * R5/R6 例外（相对仓库根，写明理由）：
 *   public/admin/README.md —— 部署说明，正文就是在写「劳动合同/股权架构等内部资料不得部署」的禁令本身
 */
export const ALLOWED_KEYWORD_FILES = ['public/admin/README.md', 'dist/admin/README.md'];

/** R5/R6 扫描面：[根, 排除的子目录前缀（相对该根）] */
function publishedScanRoots(root) {
  const roots = [
    [join(root, 'public'), ['admin/assets/', 'admin/governance-assets/']],
    [join(root, 'admin', 'public'), ['governance-assets/']],
  ];
  if (existsSync(join(root, 'dist', 'admin'))) roots.push([join(root, 'dist', 'admin'), ['assets/', 'governance-assets/']]);
  return roots;
}

/** R5/R6：返回 failures；供 scripts/verify-admin-dist.mjs 对构建产物复用（传 scanRoots） */
export function scanInternalKeywords(root = ROOT, scanRoots = publishedScanRoots(root)) {
  const failures = [];
  for (const [dir, excludes] of scanRoots) {
    for (const file of walk(dir)) {
      const relInRoot = relative(dir, file).split(sep).join('/');
      if (excludes.some((p) => relInRoot.startsWith(p))) continue;
      const rel = relative(root, file).split(sep).join('/');
      if (ALLOWED_KEYWORD_FILES.includes(rel)) continue;
      const name = basename(file);
      if (INTERNAL_NAME_RE.test(name)) {
        failures.push(`R5 发布路径文件名疑似内部资料：${rel}（移入 admin/public/governance-assets/，见 docs/全面审计_2026-09-17/README.md A1）`);
        continue;
      }
      if (!TEXT_DOC_EXT.test(name)) continue;
      let text = '';
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const m = text.match(INTERNAL_TEXT_RE);
      if (m) failures.push(`R6 发布路径文档内容含内部资料关键词「${m[0]}」：${rel}`);
    }
  }
  return failures;
}

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

  failures.push(...scanInternalKeywords(root));

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

  // R5/R6 在临时夹具里注入（不写共享工作区）
  const fx = mkdtempSync(join(tmpdir(), 'publish-dir-selftest-'));
  const put = (rel, content = 'probe') => {
    mkdirSync(dirname(join(fx, rel)), { recursive: true });
    writeFileSync(join(fx, rel), content);
  };
  try {
    put('admin/public/governance-assets/erp-embeds/shanhai-capital-architecture-sandbox.html', '<title>资本架构沙盘</title>');
    put('public/admin/assets/CapitalArchitectureSandbox-abc123.js', 'const t="资本架构沙盘"');
    put('public/images/what/butterfly-specimen.jpg');
    put('public/admin/README.md', '劳动合同/股权架构等内部资料不得部署');
    const clean = scanInternalKeywords(fx);
    if (clean.length) {
      console.error('  ✗ 不误报对照失败（governance-assets 内 / 哈希 chunk / 普通图片 / 登记例外 被误判）：');
      for (const f of clean) console.error(`    - ${f}`);
      failed++;
    } else {
      console.log('  ✓ 不误报对照：governance-assets 内、哈希 chunk、普通图片、登记例外均不命中');
    }

    const cases = [
      ['内部页放回 admin/public 根目录（文件名）', 'admin/public/shanhai-studio-startup-cost-model.html', '<p>x</p>', 'R5'],
      ['改名后的内部文档（内容）', 'public/notes-2026.html', '<h1>山海造物 股权架构方案</h1>', 'R6'],
      ['构建产物里出现内部页（dist/admin）', 'dist/admin/partner-destiny-center.html', '<p>x</p>', 'R5'],
    ];
    for (const [label, rel, content, rule] of cases) {
      put(rel, content);
      const hit = scanInternalKeywords(fx).some((f) => f.startsWith(rule) && f.includes(rel));
      rmSync(join(fx, rel), { force: true });
      if (hit) console.log(`  ✓ 注入「${label}」→ ${rule} 命中`);
      else {
        console.error(`  ✗ 注入「${label}」未被检出`);
        failed++;
      }
    }
  } finally {
    rmSync(fx, { recursive: true, force: true });
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
  console.log('✓ 自检通过：5 项注入全部检出、1 组不误报对照通过，且未残留');
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const code = process.argv.includes('--selftest') ? selftest() : report(runChecks());
  process.exit(code);
}
