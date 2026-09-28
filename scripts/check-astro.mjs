#!/usr/bin/env node
/**
 * 官网类型检查（astro check）包装器
 *
 * 为什么需要包装（2026-09-17 全面审计 E8）：
 *   `@astrojs/check` 一直是根 `package.json` 的依赖，但**没有任何脚本或 CI 调用它** ——
 *   官网 27 个真实类型错误（全在 `src/pages/price-list.astro`：TS 不把外层函数的收窄带进闭包，
 *   报 27 处 ts(18047)）因此长期无人发现。
 *
 * 包装器做两件编译器之外的事：
 *   1. 设 `ASTRO_TELEMETRY_DISABLED=1` —— 沙箱/容器里 `$HOME` 往往不可写，否则 astro 会在
 *      「写 telemetry 配置」这一步直接 EACCES 崩掉（与构建链同一个坑）。用 Node 设环境变量
 *      而不是 `VAR=x astro check`，避免依赖 POSIX shell。
 *   2. `--selftest`：临时放一个必然类型错的探针文件 → 检查必须变红 → 删除探针。
 *      AGENTS.md 要求每条守卫都能证明自己会失败。
 *
 *   3. **通过缓存**（2026-09-28 开发提速）：astro check 是全套守卫里最慢的一条（~12s），而官网极少改。
 *      输入（tsconfig 的 include 范围：`src/**`、根目录 `*.mjs`/`*.ts`、`tsconfig.json`、
 *      `.astro/types.d.ts`，外加 `package-lock.json`、本脚本、Node 版本）的内容哈希与上次**通过**时
 *      相同 → 直接判过；任何一个字节变了就真跑。缓存在 `node_modules/.cache/`（CI 全新安装必然真跑）；
 *      `CI` 或 `CHECK_ASTRO_NO_CACHE=1` 时一律真跑；`--selftest` 从不走缓存。
 *
 * 用法：
 *   node scripts/check-astro.mjs
 *   node scripts/check-astro.mjs --selftest
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = join(ROOT, 'src', '__typecheck_probe__.ts');
const CACHE_FILE = join(ROOT, 'node_modules', '.cache', 'check-astro-pass.json');
const ASTRO_BIN = join(ROOT, 'node_modules', '.bin', 'astro');

/** tsconfig include 范围 + 会改变判定结果的环境文件，按路径排序后逐个哈希内容 */
export function inputsHash() {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(join(ROOT, 'src'));
  for (const f of readdirSync(ROOT)) if (/\.(mjs|ts)$/.test(f)) files.push(join(ROOT, f));
  for (const f of ['tsconfig.json', '.astro/types.d.ts', 'package-lock.json', 'scripts/check-astro.mjs']) {
    if (existsSync(join(ROOT, f))) files.push(join(ROOT, f));
  }
  const h = createHash('sha256').update(process.version);
  for (const f of files.sort()) h.update(`\0${f.slice(ROOT.length)}\0`).update(readFileSync(f));
  return h.digest('hex');
}

function cacheEnabled() {
  return !process.env.CI && process.env.CHECK_ASTRO_NO_CACHE !== '1';
}

function readCachedHash() {
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')).hash || null; } catch { return null; }
}

function writeCachedHash(hash) {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ hash, at: new Date().toISOString() }));
    renameSync(tmp, CACHE_FILE);
  } catch { /* 写不进缓存只是下次再真跑 */ }
}

function runAstroCheck() {
  const [cmd, args] = existsSync(ASTRO_BIN) ? [ASTRO_BIN, ['check']] : ['npx', ['astro', 'check']];
  return spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
  });
}

if (process.argv.includes('--selftest')) {
  console.log('自检：放一个必然类型错的探针 → astro check 必须变红 → 删除探针\n');
  const existed = existsSync(PROBE);
  let bad = 0;
  const cleanHash = inputsHash();
  try {
    writeFileSync(PROBE, "// 自检探针：故意制造类型错误\nexport const probe: number = 'not-a-number';\n");
    const probeChangesHash = inputsHash() !== cleanHash;
    console.log(`${probeChangesHash ? '✓' : '✗'} 注入探针后输入哈希改变（通过缓存不会掩盖新错误）`);
    if (!probeChangesHash) bad += 1;
    const r = runAstroCheck();
    const detected = r.status !== 0;
    console.log(`\n${detected ? '✓' : '✗'} 注入类型错误后 astro check 变红（exit ${r.status}）`);
    if (!detected) bad += 1;
  } finally {
    if (!existed && existsSync(PROBE)) rmSync(PROBE, { force: true });
  }
  const cleaned = !existsSync(PROBE);
  console.log(`${cleaned ? '✓' : '✗'} 探针已清理`);
  if (!cleaned) bad += 1;

  // 清理后必须回到绿
  const after = runAstroCheck();
  console.log(`${after.status === 0 ? '✓' : '✗'} 清理后 astro check 恢复通过（exit ${after.status}）`);
  if (after.status !== 0) bad += 1;

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 类型检查不可信`);
    process.exit(1);
  }
  console.log('\n自检通过：类型错误会被检出，探针无残留');
  process.exit(0);
}

const hash = inputsHash();
if (cacheEnabled() && readCachedHash() === hash) {
  console.log('✓ 官网类型检查通过（缓存命中：输入与上次通过时逐字节相同；强制真跑设 CHECK_ASTRO_NO_CACHE=1）');
  process.exit(0);
}
const r = runAstroCheck();
if (r.status !== 0) {
  console.error('\n✗ 官网类型检查未通过。修完再提交（历史遗留 27 处已在 2026-09-17 审计 E8 清零）。');
  process.exit(1);
}
if (inputsHash() === hash) writeCachedHash(hash);
console.log('✓ 官网类型检查通过（astro check）');
