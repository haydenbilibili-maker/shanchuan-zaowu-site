#!/usr/bin/env node
/**
 * 守卫批量执行器（不短路）
 *
 * 为什么（2026-09-17 全面审计 D2）：
 *   `check:admin` 原本是一条 `npm run A && npm run B && …` 的长链 —— **第一条失败就短路**，
 *   后面几十条静默不跑，人只看到第一条的红，误以为「只有一处坏了」。链子越长这个问题越严重
 *   （当前 51 条）。
 *
 * 本执行器逐条独立运行、**全部跑完**再汇总：
 *   · 每条失败都带退出码出现在汇总表里；
 *   · 任一条失败 → 总退出码 1；
 *   · `--selftest` 逐条跑对应的 `:selftest`（自检会改源文件再还原，故**必须串行**），
 *     并顺带核查「每条守卫都配了 `:selftest`」（AGENTS.md 硬性要求）；
 *   · `--selftest-runner` 证明执行器自身不短路（注入「失败在中间」的三条清单）。
 *
 * 守卫清单来源：`package.json` 的 `scripts["check:admin:guards"]`（`&&` 分隔）。
 * **新增守卫请追加到该键**，不要写在别处 —— 这样并行开发各自加守卫时不会互相覆盖。
 *
 * 用法：
 *   node scripts/run-guards.mjs                    # 跑全部守卫
 *   node scripts/run-guards.mjs --selftest         # 跑全部守卫的自检
 *   node scripts/run-guards.mjs --list             # 只打印清单
 *   node scripts/run-guards.mjs --only color       # 只跑名字含 color 的（调试用）
 *   node scripts/run-guards.mjs --selftest-runner  # 执行器自检
 *   node scripts/run-guards.mjs --guards <file>    # 用外部清单（供自检注入）
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

const LIST_KEY = 'check:admin:guards';

const argv = process.argv.slice(2);
const argVal = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const wantSelftest = argv.includes('--selftest');
const only = argVal('--only');
const guardsFile = argVal('--guards');

function loadGuards() {
  if (guardsFile) {
    const list = JSON.parse(readFileSync(guardsFile, 'utf8'));
    return list.map((cmd) => ({ cmd, name: scriptNameOf(cmd) }));
  }
  const raw = scripts[LIST_KEY];
  if (!raw) {
    console.error(`✗ package.json 缺少 scripts["${LIST_KEY}"] —— 守卫清单没有事实源。`);
    process.exit(1);
  }
  return raw
    .split('&&')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((cmd) => ({ cmd, name: scriptNameOf(cmd) }));
}

/** `npm run X` → `X`；非 npm run 形式返回 null */
function scriptNameOf(cmd) {
  const m = /^npm run ([^\s]+)$/.exec(String(cmd).trim());
  return m ? m[1] : null;
}

/** 守卫名 → 自检名：`:strict` / `:json` / `:update` 变体没有自己的 selftest，映射回基名 */
function selftestNameOf(name) {
  return `${name.replace(/:(?:strict|json|update)$/, '')}:selftest`;
}

function buildPlan(guards) {
  const plan = [];
  const problems = [];
  for (const g of guards) {
    if (only && !g.cmd.includes(only)) continue;
    if (!wantSelftest) {
      plan.push({ label: g.name || g.cmd, cmd: g.cmd });
      continue;
    }
    if (!g.name) {
      problems.push(`${g.cmd} —— 不是 \`npm run <script>\` 形式，无法推导 :selftest`);
      continue;
    }
    const st = selftestNameOf(g.name);
    if (!scripts[st]) {
      problems.push(`${g.name} —— 缺少 \`${st}\`（AGENTS.md：每条守卫都必须能证明自己会失败）`);
      continue;
    }
    plan.push({ label: st, cmd: `npm run ${st}` });
  }
  return { plan, problems };
}

/** 逐条运行，全部跑完再汇总。返回 { failed, problems, total } */
function runAll(plan, problems) {
  const mode = wantSelftest ? '自检' : '守卫';
  console.log(`\n════ ${mode}批量执行：共 ${plan.length} 条（逐条独立，不短路）════\n`);

  const results = [];
  for (const [i, item] of plan.entries()) {
    const tag = `[${i + 1}/${plan.length}] ${item.label}`;
    console.log(`\n──── ${tag} ${'─'.repeat(Math.max(0, 60 - tag.length))}`);
    const t0 = Date.now();
    const r = spawnSync(item.cmd, { cwd: ROOT, shell: true, stdio: 'inherit' });
    const ms = Date.now() - t0;
    const code = r.status === null ? 1 : r.status;
    results.push({ label: item.label, code, ms });
    console.log(`${code === 0 ? '✓' : '✗'} ${item.label}（exit ${code}，${(ms / 1000).toFixed(1)}s）`);
  }

  console.log(`\n════ ${mode}汇总 ════`);
  const pad = Math.max(...results.map((r) => r.label.length), 8);
  for (const r of results) {
    console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.label.padEnd(pad)}  exit ${r.code}  ${(r.ms / 1000).toFixed(1)}s`);
  }
  for (const p of problems) console.log(`  ⚠ ${p}`);

  const failed = results.filter((r) => r.code !== 0);
  const total = results.length + problems.length;
  if (failed.length || problems.length) {
    console.error(`\n✗ ${mode}未全绿：${failed.length} 条失败 / ${problems.length} 条缺自检 / 共 ${total} 条`);
  } else {
    console.log(`\n✓ 全部通过（${results.length} 条）`);
  }
  return { failed, problems, total };
}

/** 执行器自检：注入「失败夹在中间」的清单，证明后面不会被静默跳过 */
function selftestRunner() {
  console.log('— 守卫执行器自检：证明「失败不短路」 —');
  const tmp = join(ROOT, '.run-guards-selftest.json');
  const tmpSelftest = join(ROOT, '.run-guards-selftest-selftest.json');
  let bad = 0;
  try {
    // 场景 1：失败在中间 → 三条都必须跑到，退出码 1
    writeFileSync(tmp, JSON.stringify([
      'node -e "process.exit(0)"',
      'node -e "process.exit(7)"',
      'node -e "process.exit(0)"',
    ]));
    const r1 = spawnSync(process.execPath, [SELF, '--guards', tmp], { cwd: ROOT, encoding: 'utf8' });
    const out1 = `${r1.stdout || ''}${r1.stderr || ''}`;
    const ranAll = (out1.match(/\[[123]\/3\]/g) || []).length === 3;
    const oneFail = (out1.match(/✗ /g) || []).length >= 1;
    const twoPass = (out1.match(/✓ /g) || []).length >= 2;
    if (r1.status === 1 && ranAll && oneFail && twoPass) {
      console.log('  ✓ 失败夹在中间：3 条全部执行，退出码 1（旧 `&&` 链只会跑 2 条）');
    } else {
      console.error(`  ✗ 失败夹在中间未被正确汇总（status=${r1.status} ranAll=${ranAll} fail=${oneFail} pass=${twoPass}）`);
      bad += 1;
    }

    // 场景 2：自检模式下，缺 :selftest 的守卫必须被点名
    writeFileSync(tmpSelftest, JSON.stringify([
      'npm run test:coupon-floor',
      'npm run check:fn-sync',
    ]));
    const r2 = spawnSync(process.execPath, [SELF, '--guards', tmpSelftest, '--selftest'], { cwd: ROOT, encoding: 'utf8' });
    const out2 = `${r2.stdout || ''}${r2.stderr || ''}`;
    if (r2.status === 1 && /缺少 `check:fn-sync:selftest`/.test(out2)) {
      console.log('  ✓ 缺 :selftest 的守卫被点名（check:fn-sync）');
    } else {
      console.error(`  ✗ 缺 :selftest 未被点名（status=${r2.status}）`);
      bad += 1;
    }
  } finally {
    for (const f of [tmp, tmpSelftest]) if (existsSync(f)) rmSync(f, { force: true });
  }

  if (bad) {
    console.error(`\n✗ 执行器自检失败（${bad} 项）`);
    return 1;
  }
  console.log('\n✓ 执行器自检通过：逐条执行、全部汇总、缺自检会被点名');
  return 0;
}

if (argv.includes('--selftest-runner')) {
  process.exit(selftestRunner());
}

const guards = loadGuards();
const { plan, problems } = buildPlan(guards);

if (argv.includes('--list')) {
  console.log(`${LIST_KEY} 共 ${guards.length} 条${wantSelftest ? '（自检模式）' : ''}：`);
  plan.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${p.label}`));
  if (problems.length) {
    console.log(`\n⚠ ${problems.length} 条无法推导自检：`);
    problems.forEach((p) => console.log(`  - ${p}`));
  }
  process.exit(problems.length ? 1 : 0);
}

if (!plan.length && !problems.length) {
  console.error(`✗ 没有匹配 "${only}" 的守卫`);
  process.exit(1);
}

const { failed, problems: probs } = runAll(plan, problems);
process.exit(failed.length || probs.length ? 1 : 0);
