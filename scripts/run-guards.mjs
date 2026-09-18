#!/usr/bin/env node
/**
 * 守卫批量执行器（不短路）
 *
 * 为什么（2026-09-17 全面审计 D2）：
 *   `check:admin` 原本是一条 `npm run A && npm run B && …` 的长链 —— **第一条失败就短路**，
 *   后面几十条静默不跑，人只看到第一条的红，误以为「只有一处坏了」。链子越长这个问题越严重。
 *
 * 本执行器逐条独立运行、**全部跑完**再汇总：
 *   · 每条失败都带退出码出现在汇总表里；
 *   · 任一条失败 → 总退出码 1；
 *   · `--selftest` 逐条跑对应的 `:selftest`（自检会改源文件再还原，故**必须串行**），
 *     并顺带核查「每条守卫都配了 `:selftest`」（AGENTS.md 硬性要求）；
 *   · `--selftest-runner` 证明执行器自身不短路（注入「失败在中间」的三条清单）。
 *
 * **守卫清单来源（2026-09-18 P1-1 改）**：`guards/_meta.json` + `guards/<NN>-<域>.txt`。
 *   旧形态是 `package.json` 的 `scripts["check:admin:guards"]` —— **一行 2690 字符 / 87 条 `&&`**，
 *   而 `package.json` 在近 200 次提交里被改过 **49 次（全仓第一）**：两条流同时加守卫 = 100% 文本冲突。
 *   现在**按域拆成一文件一域**，每条流只改自己的域文件 → **跨流零冲突**，且域文件可直接作为
 *   各流的单写者面登记进 `docs/并发工作流注册表.json`。
 *   新增守卫：**只改你那个域的文件**（一行一条）。清单完整性由 `npm run check:guards-coverage` 守。
 *
 * 用法：
 *   node scripts/run-guards.mjs                      # 跑全部域（= CI 的 verify job）
 *   node scripts/run-guards.mjs --domain pay         # 只跑 pay 域 + cross（开发内循环）
 *   node scripts/run-guards.mjs --domain pay --no-cross
 *   node scripts/run-guards.mjs --domains            # 打印域一览
 *   node scripts/run-guards.mjs --list               # 打印清单（带域归属）
 *   node scripts/run-guards.mjs --selftest           # 跑全部守卫的自检
 *   node scripts/run-guards.mjs --only color         # 只跑名字含 color 的（调试用）
 *   node scripts/run-guards.mjs --selftest-runner    # 执行器自检
 *   node scripts/run-guards.mjs --guards <file>      # 用外部清单（JSON 数组，供自检注入）
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

const GUARDS_DIR = join(ROOT, 'guards');
const META_FILE = join(GUARDS_DIR, '_meta.json');

const argv = process.argv.slice(2);
const argVal = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const wantSelftest = argv.includes('--selftest');
const only = argVal('--only');
const guardsFile = argVal('--guards');
const domain = argVal('--domain');

function loadMeta() {
  if (!existsSync(META_FILE)) {
    console.error(`✗ 缺 guards/_meta.json —— 守卫清单没有事实源（见 guards/_meta.json 的 _why）。`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(META_FILE, 'utf8'));
}

/** 读某域的文件：`guards/<NN>-<域>.txt`，一行一条，`#` 为注释 */
function readDomain(name) {
  let files;
  try { files = readdirSync(GUARDS_DIR); } catch { return null; }
  const base = files.find((f) => /^\d+-.+\.txt$/.test(f) && f.replace(/^\d+-/, '').replace(/\.txt$/, '') === name);
  if (!base) return null;
  return readFileSync(join(GUARDS_DIR, base), 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

function loadGuards() {
  if (guardsFile) {
    const list = JSON.parse(readFileSync(guardsFile, 'utf8'));
    return list.map((cmd) => ({ cmd, name: scriptNameOf(cmd), domain: '(外部清单)' }));
  }
  const meta = loadMeta();
  let names = meta.domainOrder || [];
  if (domain) {
    if (!names.includes(domain)) {
      console.error(`✗ 未知域 "${domain}"；可用域：${names.join(' / ')}`);
      process.exit(1);
    }
    names = [domain];
    if (!argv.includes('--no-cross') && (meta.crossWith || []).includes(domain)) names.push('cross');
  }
  const out = [];
  for (const n of names) {
    const list = readDomain(n);
    if (list === null) {
      console.error(`✗ 缺域文件 guards/<NN>-${n}.txt —— 清单不完整。跑 npm run check:guards-coverage 看详情。`);
      process.exit(1);
    }
    for (const cmd of list) out.push({ cmd, name: scriptNameOf(cmd), domain: n });
  }
  return out;
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
  // 只有**清单驱动**的路径才强校验「是不是真的 npm 脚本」。
  // `--guards <file>`（外部清单）是调试/自检设施，本来就允许塞任意命令
  // —— 本执行器自己的 selftest 场景 1 就是用 `node -e "process.exit(7)"` 来证明「失败不短路」的。
  const fromManifest = !guardsFile;
  for (const g of guards) {
    if (!g.name) {
      // 非 `npm run <script>` 形式：**清单里不许**（写错的行会被静默跳过），
      // 但**外部清单允许** —— `--guards` 是调试/自检设施，本执行器的 selftest
      // 场景 1 就是用 `node -e "process.exit(7)"` 来证明「失败不短路」的。
      if (fromManifest) {
        problems.push(`${g.cmd} —— 不是 \`npm run <script>\` 形式（域 ${g.domain}）`);
        continue;
      }
    } else if (!scripts[g.name]) {
      // `npm run X` 里的 X 不存在 → 两种路径都是错的，必须点名
      problems.push(`${g.name} —— package.json 里没有这个脚本（域 ${g.domain}）`);
      continue;
    }
    if (only && !g.cmd.includes(only)) continue;
    if (!wantSelftest) {
      plan.push({ label: g.name || g.cmd, cmd: g.cmd, domain: g.domain });
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
    plan.push({ label: st, cmd: `npm run ${st}`, domain: g.domain });
  }
  return { plan, problems };
}

/** 逐条运行，全部跑完再汇总。返回 { failed, problems, total } */
function runAll(plan, problems) {
  const mode = wantSelftest ? '自检' : '守卫';
  const scope = domain ? `域 ${domain}${argv.includes('--no-cross') ? '' : ' + cross'}` : '全部域';
  console.log(`\n════ ${mode}批量执行：共 ${plan.length} 条（${scope}，逐条独立、不短路）════\n`);

  const results = [];
  for (const [i, item] of plan.entries()) {
    const tag = `[${i + 1}/${plan.length}] ${item.label}  ‹${item.domain}›`;
    console.log(`\n──── ${tag} ${'─'.repeat(Math.max(0, 60 - tag.length))}`);
    const t0 = Date.now();
    const r = spawnSync(item.cmd, { cwd: ROOT, shell: true, stdio: 'inherit' });
    const ms = Date.now() - t0;
    const code = r.status === null ? 1 : r.status;
    results.push({ label: item.label, code, ms });
    console.log(`${code === 0 ? '✓' : '✗'} ${item.label}（exit ${code}，${(ms / 1000).toFixed(1)}s）`);
  }

  console.log(`\n════ ${mode}汇总（${scope}）════`);
  const pad = Math.max(...results.map((r) => r.label.length), 8);
  for (const r of results) {
    console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.label.padEnd(pad)}  exit ${r.code}  ${(r.ms / 1000).toFixed(1)}s`);
  }
  for (const p of problems) console.log(`  ⚠ ${p}`);

  const failed = results.filter((r) => r.code !== 0);
  const total = results.length + problems.length;
  if (failed.length || problems.length) {
    console.error(`\n✗ ${mode}未全绿：${failed.length} 条失败 / ${problems.length} 条清单问题 / 共 ${total} 条`);
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

    // 场景 3：清单里写一个 package.json 不存在的脚本名 → 必须被点名（不只是在自检模式）
    writeFileSync(tmp, JSON.stringify(['npm run check:no-such-guard-at-all']));
    const r3 = spawnSync(process.execPath, [SELF, '--guards', tmp], { cwd: ROOT, encoding: 'utf8' });
    const out3 = `${r3.stdout || ''}${r3.stderr || ''}`;
    if (r3.status === 1 && /package\.json 里没有这个脚本/.test(out3)) {
      console.log('  ✓ 清单里的死脚本名被点名（不必进自检模式）');
    } else {
      console.error(`  ✗ 死脚本名未被点名（status=${r3.status}）`);
      bad += 1;
    }
  } finally {
    for (const f of [tmp, tmpSelftest]) if (existsSync(f)) rmSync(f, { force: true });
  }

  if (bad) {
    console.error(`\n✗ 执行器自检失败（${bad} 项）`);
    return 1;
  }
  console.log('\n✓ 执行器自检通过：逐条执行、全部汇总、缺自检/死脚本名都会被点名');
  return 0;
}

if (argv.includes('--selftest-runner')) {
  process.exit(selftestRunner());
}

if (argv.includes('--domains')) {
  const meta = loadMeta();
  console.log(`guards/_meta.json：${meta.domainOrder.length} 个域 / minGuards=${meta.minGuards}\n`);
  for (const n of meta.domainOrder) {
    const list = readDomain(n) || [];
    console.log(`  ${n.padEnd(14)} ${String(list.length).padStart(3)} 条${(meta.crossWith || []).includes(n) ? '   （+cross）' : ''}`);
  }
  process.exit(0);
}

const guards = loadGuards();
const { plan, problems } = buildPlan(guards);

if (argv.includes('--list')) {
  const src = guardsFile ? `外部清单 ${guardsFile}` : `guards/ 下 ${domain ? `域 ${domain}` : '全部域'}`;
  console.log(`${src} 共 ${guards.length} 条${wantSelftest ? '（自检模式）' : ''}：`);
  plan.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. [${p.domain}] ${p.label}`));
  if (problems.length) {
    console.log(`\n⚠ ${problems.length} 条清单问题：`);
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
