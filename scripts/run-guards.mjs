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
 *   node scripts/run-guards.mjs --jobs auto          # 并行跑全套（= npm run check:fast，2026-09-28 开发提速）
 *   node scripts/run-guards.mjs --quick --domain pay --jobs auto
 *
 * `--jobs N|auto`（2026-09-28）：同一份清单、同样逐条独立不短路，只是 N 路并发 + 绕过每条 `npm run`
 *   的 ~0.15s 启动开销（直接执行 package.json 里该脚本的命令，PATH 前置 node_modules/.bin）+ 按上次耗时
 *   最长优先排程。`_meta.json` 的 `serialGuards` 里的守卫（起 Chrome / vite / 写固定临时文件）走一条
 *   **互斥通道**依次执行，彼此不并发。输出按条缓冲、完成一条打印一条，汇总与串行模式同格式。
 *   不带 `--jobs` 时行为与旧版完全一致（CI 仍用它）。`--selftest` 不支持并行（自检会改源文件再还原）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
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
const jobsArg = argVal('--jobs');
const jobs = !jobsArg ? 1
  : jobsArg === 'auto' ? Math.max(2, Math.floor(cpus().length * 0.75))
  : Math.max(1, parseInt(jobsArg, 10) || 1);
const TIMINGS_FILE = join(ROOT, 'node_modules', '.cache', 'run-guards-timings.json');

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
  // --quick：内循环用 —— 本域 + `quickWith` 里**点名**的跨域守卫（不是整个 cross 域）。
  // 实测成本：全套 124.5s / --domain 1.1s / --quick 约 0.3s。内循环要用最后那个量级。
  const quickOnly = argv.includes('--quick');
  let extra = [];
  if (domain && quickOnly) {
    extra = (meta.quickWith && meta.quickWith[domain]) || [];
  }
  if (domain) {
    if (!names.includes(domain)) {
      console.error(`✗ 未知域 "${domain}"；可用域：${names.join(' / ')}`);
      process.exit(1);
    }
    // --quick 时**不**拉整个 cross 域（那是 62 条），只补 quickWith 点名的几条
    names = quickOnly ? [] : [domain];
    if (!quickOnly && !argv.includes('--no-cross') && (meta.crossWith || []).includes(domain)) names.push('cross');
  }
  const out = [];
  if (quickOnly && domain) {
    // 本域自己的清单 + 点名的跨域条目（保持清单里的原始顺序）
    const mine = readDomain(domain) || [];
    const wanted = new Set(extra);
    for (const n of (meta.domainOrder || [])) {
      for (const cmd of (readDomain(n) || [])) {
        if (n === domain || wanted.has(scriptNameOf(cmd))) out.push({ cmd, name: scriptNameOf(cmd), domain: n });
      }
    }
    if (!mine.length) console.error(`✗ 域 ${domain} 的清单为空或缺失`);
    return out;
  }
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
      plan.push({ label: g.name || g.cmd, cmd: g.cmd, domain: g.domain, name: g.name });
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

function readTimings() {
  try { return JSON.parse(readFileSync(TIMINGS_FILE, 'utf8')); } catch { return {}; }
}

/** 记录每条耗时，供 `--jobs` 最长优先排程；写临时文件再 rename，多条流同时写也不会读到半截 JSON */
function saveTimings(results) {
  if (guardsFile) return;
  try {
    const t = readTimings();
    for (const r of results) t[r.label] = r.ms;
    mkdirSync(dirname(TIMINGS_FILE), { recursive: true });
    const tmp = `${TIMINGS_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(t, null, 1));
    renameSync(tmp, TIMINGS_FILE);
  } catch { /* 缓存写不进去只影响排程顺序 */ }
}

/** `npm run X` → 直接执行 X 的命令（省掉 npm 启动）；非 npm 形式原样返回 */
function directCmd(item) {
  const name = item.name || scriptNameOf(item.cmd);
  return name && scripts[name] ? scripts[name] : item.cmd;
}

function runOneAsync(item) {
  return new Promise((resolveRun) => {
    const t0 = Date.now();
    const name = item.name || scriptNameOf(item.cmd) || '';
    const env = {
      ...process.env,
      PATH: `${join(ROOT, 'node_modules', '.bin')}:${process.env.PATH || ''}`,
      npm_lifecycle_event: name,
    };
    const child = spawn(directCmd(item), { cwd: ROOT, shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('error', (e) => { out += `\n${e.stack || e}`; });
    child.on('close', (status) => resolveRun({ code: status === null ? 1 : status, ms: Date.now() - t0, out }));
  });
}

/** N 路并发 + 互斥通道；完成一条打印一条（输出不交错） */
async function runParallel(plan) {
  const meta = guardsFile ? {} : loadMeta();
  const serialSet = new Set(meta.serialGuards || []);
  const timings = readTimings();
  const indexed = plan.map((item, i) => ({ item, i }));
  const byCost = (a, b) => (timings[b.item.label] || 0) - (timings[a.item.label] || 0);
  const serialQ = indexed.filter((x) => serialSet.has(x.item.label.replace(/:selftest$/, ''))).sort(byCost);
  const poolQ = indexed.filter((x) => !serialQ.includes(x)).sort(byCost);
  const results = new Array(plan.length);
  let done = 0;
  const report = (x, r) => {
    done += 1;
    const tag = `[${x.i + 1}/${plan.length}] ${x.item.label}  ‹${x.item.domain}›`;
    process.stdout.write(`\n──── ${tag} ${'─'.repeat(Math.max(0, 60 - tag.length))}\n${r.out}`);
    console.log(`${r.code === 0 ? '✓' : '✗'} ${x.item.label}（exit ${r.code}，${(r.ms / 1000).toFixed(1)}s）  〔完成 ${done}/${plan.length}〕`);
    results[x.i] = { label: x.item.label, code: r.code, ms: r.ms };
  };
  const worker = async (queue) => {
    for (let x = queue.shift(); x; x = queue.shift()) report(x, await runOneAsync(x.item));
  };
  const lanes = [];
  if (serialQ.length) lanes.push(worker(serialQ));
  const poolLanes = Math.max(1, jobs - (serialQ.length ? 1 : 0));
  for (let k = 0; k < poolLanes; k++) lanes.push(worker(poolQ));
  await Promise.all(lanes);
  return results;
}

function printRanking(results, wallMs) {
  const top = results.slice().sort((a, b) => b.ms - a.ms).slice(0, 10);
  const sum = results.reduce((s, r) => s + r.ms, 0);
  console.log(`\n──── 耗时排行 Top ${top.length}（逐条合计 ${(sum / 1000).toFixed(1)}s / 墙钟 ${(wallMs / 1000).toFixed(1)}s${jobs > 1 ? ` / ${jobs} 路并发` : ''}）`);
  for (const r of top) console.log(`  ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.label}`);
}

/** 逐条运行，全部跑完再汇总。返回 { failed, problems, total } */
async function runAll(plan, problems) {
  const mode = wantSelftest ? '自检' : '守卫';
  const scope = domain
    ? (argv.includes('--quick') ? `域 ${domain} + 点名跨域（内循环）` : `域 ${domain}${argv.includes('--no-cross') ? '' : ' + cross'}`)
    : '全部域';
  const parallel = jobs > 1 && !wantSelftest;
  console.log(`\n════ ${mode}批量执行：共 ${plan.length} 条（${scope}，逐条独立、不短路${parallel ? `，${jobs} 路并发` : ''}）════\n`);

  const wall0 = Date.now();
  let results = [];
  if (parallel) {
    results = await runParallel(plan);
  } else {
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
  }
  if (!wantSelftest) saveTimings(results);

  // --retry-serial：并行失败的逐条**串行**复跑。串行仍失败 = 真失败；串行通过 = 并行冲突嫌疑
  // （守卫共享了临时文件/端口却没登记 serialGuards）—— 串行语义就是 check:admin 的判定，故不判红，但必须显式报告。
  const suspects = [];
  if (parallel && argv.includes('--retry-serial')) {
    const firstFails = plan.map((item, i) => ({ item, i })).filter(({ i }) => results[i].code !== 0);
    if (firstFails.length) console.log(`\n════ 串行复跑并行失败的 ${firstFails.length} 条 ════`);
    for (const { item, i } of firstFails) {
      const r = await runOneAsync(item);
      process.stdout.write(`\n──── [复跑] ${item.label}\n${r.out}`);
      console.log(`${r.code === 0 ? '⚠' : '✗'} [复跑] ${item.label}（exit ${r.code}）`);
      if (r.code === 0) {
        suspects.push(item.label);
        results[i] = { ...results[i], code: 0, parallelOnly: results[i].code };
      }
    }
  }

  console.log(`\n════ ${mode}汇总（${scope}）════`);
  const pad = Math.max(...results.map((r) => r.label.length), 8);
  for (const r of results) {
    const note = r.parallelOnly ? `  ⚠ 并行 exit ${r.parallelOnly} / 串行通过` : '';
    console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.label.padEnd(pad)}  exit ${r.code}  ${(r.ms / 1000).toFixed(1)}s${note}`);
  }
  for (const p of problems) console.log(`  ⚠ ${p}`);
  if (results.length > 1) printRanking(results, Date.now() - wall0);
  if (suspects.length) {
    console.log(`\n⚠ 并行冲突嫌疑 ${suspects.length} 条（并行失败、串行通过）：${suspects.join(' / ')}`);
    console.log('  → 它们与别的守卫共享了临时文件/端口/浏览器：登记进 guards/_meta.json 的 serialGuards，或改用 mkdtemp/带 pid 的路径。');
    if (process.env.GITHUB_ACTIONS) {
      for (const s of suspects) console.log(`::warning title=并行冲突嫌疑::${s} 并行失败、串行通过 —— 请登记 guards/_meta.json 的 serialGuards 或消除共享临时文件`);
    }
  }

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

    // 场景 4：并行模式（--jobs）同样不短路 —— 失败夹在中间、最慢的最后完成，4 条都必须跑到并汇总
    writeFileSync(tmp, JSON.stringify([
      'node -e "process.exit(0)"',
      'node -e "process.exit(7)"',
      'node -e "setTimeout(()=>process.exit(0),300)"',
      'node -e "process.exit(3)"',
    ]));
    const r4 = spawnSync(process.execPath, [SELF, '--guards', tmp, '--jobs', '3'], { cwd: ROOT, encoding: 'utf8' });
    const out4 = `${r4.stdout || ''}${r4.stderr || ''}`;
    const ranAll4 = (out4.match(/\[[1234]\/4\]/g) || []).length === 4;
    const summary4 = out4.split('守卫汇总')[1] || '';
    const fails4 = (summary4.match(/✗ node/g) || []).length;
    if (r4.status === 1 && ranAll4 && fails4 === 2 && /3 路并发/.test(out4)) {
      console.log('  ✓ 并行模式（--jobs 3）：4 条全部执行、2 条失败都进汇总、退出码 1');
    } else {
      console.error(`  ✗ 并行模式未正确汇总（status=${r4.status} ranAll=${ranAll4} fails=${fails4}）`);
      bad += 1;
    }

    // 场景 5：--retry-serial 必须区分「并行冲突」与「真失败」
    //   A 持有锁文件 500ms；B 在 150ms 时看到锁就失败（只在与 A 并发时失败）；C 恒失败。
    const lock = join(ROOT, `.run-guards-selftest-lock-${process.pid}`);
    const A = 'node -e "const f=process.env.RG_LOCK,fs=require(\'fs\');fs.writeFileSync(f,\'1\');setTimeout(()=>fs.rmSync(f,{force:true}),500)"';
    const B = 'node -e "setTimeout(()=>process.exit(require(\'fs\').existsSync(process.env.RG_LOCK)?5:0),150)"';
    const C = 'node -e "process.exit(7)"';
    const env5 = { ...process.env, RG_LOCK: lock, GITHUB_ACTIONS: '' };
    writeFileSync(tmp, JSON.stringify([A, B, C]));
    const r5 = spawnSync(process.execPath, [SELF, '--guards', tmp, '--jobs', '3', '--retry-serial'], { cwd: ROOT, encoding: 'utf8', env: env5 });
    const out5 = `${r5.stdout || ''}${r5.stderr || ''}`;
    const sum5 = out5.split('守卫汇总')[1] || '';
    const ok5 = r5.status === 1
      && /并行冲突嫌疑 1 条/.test(out5) && /exit\(5\)|并行 exit 5 \/ 串行通过/.test(sum5)
      && /✗ node -e "process\.exit\(7\)"/.test(sum5) && /1 条失败/.test(out5);
    writeFileSync(tmp, JSON.stringify([A, B]));
    const r5b = spawnSync(process.execPath, [SELF, '--guards', tmp, '--jobs', '2', '--retry-serial'], { cwd: ROOT, encoding: 'utf8', env: env5 });
    const out5b = `${r5b.stdout || ''}${r5b.stderr || ''}`;
    const ok5b = r5b.status === 0 && /并行冲突嫌疑 1 条/.test(out5b);
    if (existsSync(lock)) rmSync(lock, { force: true });
    if (ok5 && ok5b) {
      console.log('  ✓ --retry-serial：并行才失败的被标「并行冲突嫌疑」且不判红；真失败串行复跑仍失败、退出码 1');
    } else {
      console.error(`  ✗ --retry-serial 未正确区分（真失败场景 status=${r5.status} ok=${ok5}；仅冲突场景 status=${r5b.status} ok=${ok5b}）`);
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

if (jobs > 1 && wantSelftest) {
  console.error('⚠ --selftest 会改源文件再还原，必须串行 —— 已忽略 --jobs');
}
const { failed, problems: probs } = await runAll(plan, problems);
process.exit(failed.length || probs.length ? 1 : 0);
