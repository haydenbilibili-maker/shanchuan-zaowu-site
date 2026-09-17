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
 * 用法：
 *   node scripts/check-astro.mjs
 *   node scripts/check-astro.mjs --selftest
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = join(ROOT, 'src', '__typecheck_probe__.ts');

function runAstroCheck() {
  return spawnSync('npx', ['astro', 'check'], {
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
  try {
    writeFileSync(PROBE, "// 自检探针：故意制造类型错误\nexport const probe: number = 'not-a-number';\n");
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

const r = runAstroCheck();
if (r.status !== 0) {
  console.error('\n✗ 官网类型检查未通过。修完再提交（历史遗留 27 处已在 2026-09-17 审计 E8 清零）。');
  process.exit(1);
}
console.log('✓ 官网类型检查通过（astro check）');
