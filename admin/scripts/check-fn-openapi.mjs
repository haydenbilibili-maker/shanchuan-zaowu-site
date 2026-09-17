#!/usr/bin/env node
/**
 * 云函数 openapi 声明守卫
 *
 * 背景（2026-09-17 全面审计 C5）：
 *   微信云调用的 openapi 必须在函数目录 `config.json` 的 `permissions.openapi` 里声明，
 *   否则运行期报「权限未配置」。实测 4 个函数声明不齐：
 *     · `grantStorePoints` / `submitComment` / `upsertUserProfile` 调了
 *       `security.mediaCheckAsync`（音视频异步检测）却没声明 —— 内容安全形同虚设；
 *     · `identifySpecimen` 连 `security.msgSecCheck` 也没声明。
 *   `contentSecurity.js` 自己的头注释就写着「openapi 权限需在函数 config.json 的
 *   permissions.openapi 中声明」，但**没有任何东西在检查它**。
 *
 * 本守卫：**凡代码里真的调了 `cloud.openapi.<ns>.<method>`，就必须在 config.json 声明**。
 *
 * 两个刻意的假阳性防护（本项目被正则吃注释坑过多次）：
 *   1) 先剥注释再匹配 —— 否则注释里写的示例（如 `cloud.openapi.auth.getAccessToken`）会被当成调用；
 *   2) 只认**两段**形式 `ns.method` —— 裸 `cloud.openapi.auth`（存在性判断）不是调用。
 *
 * 用法：
 *   node admin/scripts/check-fn-openapi.mjs
 *   node admin/scripts/check-fn-openapi.mjs --selftest
 *   node admin/scripts/check-fn-openapi.mjs --list   # 顺带列出「声明了但没用到」的项（信息，不判失败）
 * 退出码：有未声明的调用为 1。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CF = join(ROOT, 'miniprogram', 'cloudfunctions');

/** 去掉块注释与行注释（够用即可：本仓云函数没有把 openapi 调用写进字符串的形态） */
export function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * 纯函数：给定函数的多份 JS 源码与它的 config.json，算出声明缺口。
 * @param {string[]} jsSources
 * @param {object} config
 * @returns {{ used: string[], declared: string[], missing: string[], unused: string[] }}
 */
export function scanFunction(jsSources, config = {}) {
  const used = new Set();
  for (const src of jsSources) {
    for (const m of stripComments(src).matchAll(/cloud\.openapi\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)) {
      used.add(`${m[1]}.${m[2]}`);
    }
  }
  const declared = new Set((config.permissions && config.permissions.openapi) || []);
  const usedArr = [...used].sort();
  const declaredArr = [...declared].sort();
  return {
    used: usedArr,
    declared: declaredArr,
    missing: usedArr.filter((u) => !declared.has(u)),
    unused: declaredArr.filter((d) => !used.has(d)),
  };
}

function walkJs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function scanRepo() {
  const problems = [];
  const unusedInfo = [];
  let funcsWithOpenapi = 0;
  let declaredTotal = 0;
  for (const entry of readdirSync(CF).sort()) {
    const dir = join(CF, entry);
    if (!statSync(dir).isDirectory()) continue;
    const js = walkJs(dir);
    if (!js.length) continue;
    let config = {};
    const cfgPath = join(dir, 'config.json');
    if (existsSync(cfgPath)) {
      try { config = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { /* 下面会报 */ }
    }
    const sources = js.map((f) => readFileSync(f, 'utf8'));
    const res = scanFunction(sources, config);
    if (!res.used.length && !res.declared.length) continue;
    funcsWithOpenapi += 1;
    declaredTotal += res.declared.length;
    for (const m of res.missing) {
      problems.push(`cloudfunctions/${entry}/config.json 未声明 \`${m}\`（代码里调用了 cloud.openapi.${m}）`);
    }
    if (res.unused.length) unusedInfo.push(`${entry}: ${res.unused.join(', ')}`);
  }
  return { problems, unusedInfo, funcsWithOpenapi, declaredTotal };
}

function selftest() {
  let bad = 0;
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`); };

  const CALL = "const r = await cloud.openapi.security.mediaCheckAsync({ mediaUrl })";
  const COMMENT_ONLY = " * 示例：cloud.openapi.auth.getAccessToken（需登记权限）";
  const LINE_COMMENT = "// await cloud.openapi.security.imgSecCheck({})";
  // 只有命名空间、没有方法段 → 不是调用（真实形态见 managerShipOrder/wxExpress.js:190）
  const BARE = "if (cloud && cloud.openapi && cloud.openapi.auth) { /* 仅存在性判断 */ }";

  t('★ 调了但没声明 → 检出',
    scanFunction([CALL], { permissions: { openapi: [] } }).missing.includes('security.mediaCheckAsync'));
  t('  调了且已声明 → 不报',
    scanFunction([CALL], { permissions: { openapi: ['security.mediaCheckAsync'] } }).missing.length === 0);
  t('★ 注释里的示例不算调用（块注释续行）',
    scanFunction([COMMENT_ONLY], { permissions: { openapi: [] } }).used.length === 0);
  t('★ 注释里的示例不算调用（行注释）',
    scanFunction([LINE_COMMENT], { permissions: { openapi: [] } }).used.length === 0);
  t('★ 裸 cloud.openapi.auth（无方法段）不算调用',
    scanFunction([BARE], { permissions: { openapi: [] } }).used.length === 0);
  t('★ 特征检测行里出现的两段形式仍算引用（并被要求声明）',
    scanFunction([BARE.replace(')', ' && typeof cloud.openapi.auth.getAccessToken === \'function\')')], { permissions: { openapi: [] } })
      .missing.includes('auth.getAccessToken'));
  t('  两段形式会被规范化成 `ns.method`',
    scanFunction([CALL], {}).used.join() === 'security.mediaCheckAsync');
  t('  声明了但没用到只进 unused（信息项，不判失败）',
    scanFunction([CALL], { permissions: { openapi: ['security.msgSecCheck'] } }).unused.includes('security.msgSecCheck'));

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`);
    process.exit(1);
  }
  console.log('\n自检通过：漏声明会检出，注释里的示例与裸字段不误报');
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  const { problems, unusedInfo, funcsWithOpenapi, declaredTotal } = scanRepo();
  if (problems.length) {
    console.error(`✗ 云函数 openapi 声明缺口 ${problems.length} 处：`);
    problems.forEach((p) => console.error(`  - ${p}`));
    console.error('\n修法：把缺的项加进该函数 config.json 的 permissions.openapi，并在微信开发者工具重新上传该函数。');
    process.exit(1);
  }
  console.log(`✓ 云函数 openapi 声明齐全（${funcsWithOpenapi} 个函数用到 openapi，共声明 ${declaredTotal} 项）`);
  if (process.argv.includes('--list') && unusedInfo.length) {
    console.log('  （信息）声明了但代码里未见调用：');
    unusedInfo.forEach((u) => console.log(`    · ${u}`));
  }
}
