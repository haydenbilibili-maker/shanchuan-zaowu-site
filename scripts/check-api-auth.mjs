#!/usr/bin/env node
/**
 * Pages Functions「管理端点必须过鉴权闸」守卫
 *
 * 背景（2026-09-17 全面审计 A2/A3，线上实测）：
 *   `/api/cloud-fn` 早已校验 /api/admin-session 下发的签名 Cookie，但同目录的
 *   `/api/ai` 与 `/api/feishu-sync` **完全无鉴权、CORS `*`** ——
 *   · `GET /api/feishu-sync` 直接回显 `appToken`，任何人可读写飞书多维表（含人事 Base）；
 *   · `GET /api/ai` 回显已配置的厂商，POST 可当免费 LLM 代理盗刷付费额度。
 *   两个端点现已接入 `guardAdminRequest`（来源 → 口令已配置 fail-closed → 会话）。
 *
 * 本守卫把这条不变式钉死，防止**新增端点时又忘了加门**：
 *   A1 `functions/api/*.js`（除 `admin-session.js`，它就是发门的）必须走统一闸
 *      —— 调用 `guardAdminRequest`，或等价地同时做 `originAllowed` + `passwordConfigured` + `verifySessionToken`
 *   A2 任何 `functions/api/*.js` 都不得使用 `Access-Control-Allow-Origin: '*'`
 *   A3 `_lib/proxySession.mjs` 必须导出 `guardAdminRequest`（契约）
 *   A4 `functions/api/feishu-sync.js` 不得回显 `appToken`
 *   A5 本地 dev 代理 `admin/scripts/viteCloudFnPlugin.mjs` 必须做来源校验
 *      —— 它会**无条件注入 ADMIN_OPS_KEY**（= 超管），原先跨源 POST 即可打穿（审计 B5）
 *   A6 `admin/vite.config.js` 不得把 `server.host` 硬编码成 `0.0.0.0`
 *      —— 局域网任何人可拿超管身份；应默认 127.0.0.1，需显式 ADMIN_DEV_HOST 才开放
 *
 * 用法：
 *   node scripts/check-api-auth.mjs
 *   node scripts/check-api-auth.mjs --selftest
 * 退出码：有违例为 1。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = join(ROOT, 'functions', 'api');
const SESSION_LIB = join(ROOT, 'functions', '_lib', 'proxySession.mjs');
const DEV_PLUGIN = join(ROOT, 'admin', 'scripts', 'viteCloudFnPlugin.mjs');
const VITE_CONFIG = join(ROOT, 'admin', 'vite.config.js');
/** 发门的端点本身不需要过门 */
const EXEMPT = new Set(['admin-session.js']);

const GATE_CALL = /guardAdminRequest\s*\(/;
const MANUAL_GATE = [
  [/originAllowed\s*\(/, 'originAllowed()'],
  [/passwordConfigured\s*\(/, 'passwordConfigured()'],
  [/verifySessionToken\s*\(/, 'verifySessionToken()'],
];
const WILDCARD_CORS = /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/;

/**
 * 纯函数：检查单个端点源码。
 * @param {string} name 文件名（如 `ai.js`）
 * @param {string} src
 * @returns {string[]} 问题列表
 */
export function checkEndpoint(name, src) {
  const problems = [];
  if (EXEMPT.has(name)) return problems;

  if (WILDCARD_CORS.test(src)) {
    problems.push(`${name} 使用了 CORS 通配 \`Access-Control-Allow-Origin: *\`（应改用 corsHeaders()，只回显本站来源）`);
  }

  const gated = GATE_CALL.test(src);
  const manualMissing = MANUAL_GATE.filter(([re]) => !re.test(src)).map(([, label]) => label);
  if (!gated && manualMissing.length) {
    problems.push(
      manualMissing.length === MANUAL_GATE.length
        ? `${name} 没有任何鉴权闸 —— 管理端点必须调用 guardAdminRequest(request, env)`
        : `${name} 只做了部分校验，缺 ${manualMissing.join(' / ')}（建议直接改用 guardAdminRequest）`
    );
  }

  if (name === 'feishu-sync.js' && !/withoutAppToken\s*\(/.test(src)) {
    problems.push(`${name} 未剥离 appToken —— 该字段不该出现在公网响应里`);
  }
  return problems;
}

/** 本地 dev 代理的两条不变式（审计 B5） */
export function checkDevProxy(pluginSrc, configSrc) {
  const problems = [];
  if (!/devOriginAllowed\s*\(/.test(pluginSrc)) {
    problems.push('admin/scripts/viteCloudFnPlugin.mjs 未做来源校验 —— 该中间件会无条件注入 ADMIN_OPS_KEY（超管），必须拒绝跨源请求');
  }
  if (/host\s*:\s*['"]0\.0\.0\.0['"]/.test(configSrc)) {
    problems.push("admin/vite.config.js 的 server.host 硬编码 '0.0.0.0' —— 同局域网任何人可拿超管身份；应默认 127.0.0.1，需显式 ADMIN_DEV_HOST 才开放");
  }
  return problems;
}

function readEndpoints() {
  return readdirSync(API_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name)
    .sort();
}

function scanRepo() {
  const problems = [];
  if (!existsSync(SESSION_LIB) || !/export\s+async\s+function\s+guardAdminRequest/.test(readFileSync(SESSION_LIB, 'utf8'))) {
    problems.push('_lib/proxySession.mjs 未导出 guardAdminRequest —— 统一鉴权闸的契约被破坏');
  }
  const files = readEndpoints();
  for (const name of files) {
    problems.push(...checkEndpoint(name, readFileSync(join(API_DIR, name), 'utf8')));
  }
  if (existsSync(DEV_PLUGIN) && existsSync(VITE_CONFIG)) {
    problems.push(...checkDevProxy(readFileSync(DEV_PLUGIN, 'utf8'), readFileSync(VITE_CONFIG, 'utf8')));
  }
  return { problems, files };
}

function selftest() {
  let bad = 0;
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`); };

  const GATED = "import { corsHeaders, guardAdminRequest } from '../_lib/proxySession.mjs'\nconst g = await guardAdminRequest(request, env)\nif (!g.ok) return json(g.body, g.status)\n";
  const MANUAL = "if (!originAllowed(request, env)) {}\nif (!passwordConfigured(env)) {}\nawait verifySessionToken(env, 'x')\n";
  const NAKED = "const cors = { 'Access-Control-Allow-Origin': '*' }\nexport async function onRequest(c) { return new Response('hi') }\n";

  t('★ 无任何鉴权闸的端点必须被检出（审计前的 /api/ai 形态）',
    checkEndpoint('ai.js', NAKED).some((p) => /没有任何鉴权闸/.test(p)));
  t('★ 通配 CORS 必须被检出（审计前的两个端点形态）',
    checkEndpoint('x.js', NAKED).some((p) => /CORS 通配/.test(p)));
  t('★ 部分校验（只做 require 没做会话）也要点名',
    checkEndpoint('x.js', "const { originAllowed } = require\nif (!originAllowed(r, e)) {}\n").some((p) => /只做了部分校验/.test(p)));
  t('  走 guardAdminRequest 的端点通过',
    checkEndpoint('x.js', GATED).length === 0);
  t('  手写三件套（originAllowed+passwordConfigured+verifySessionToken）也算通过',
    checkEndpoint('x.js', MANUAL).length === 0);
  t('  admin-session.js 豁免（它就是发门的）',
    checkEndpoint('admin-session.js', NAKED).length === 0);
  t('★ feishu-sync 未剥离 appToken 必须被检出',
    checkEndpoint('feishu-sync.js', GATED + "return json(await handleFeishuAction(payload, env))\n")
      .some((p) => /未剥离 appToken/.test(p)));
  t('  feishu-sync 剥离 appToken 后通过',
    checkEndpoint('feishu-sync.js', `${GATED}return json(withoutAppToken(await handleFeishuAction(payload, env)))\n`).length === 0);

  t('★ 本地 dev 代理无来源校验必须被检出（审计 B5 形态）',
    checkDevProxy('export function viteCloudFnPlugin() {}', "host: '127.0.0.1'").some((p) => /未做来源校验/.test(p)));
  t('★ server.host 硬编码 0.0.0.0 必须被检出',
    checkDevProxy('devOriginAllowed(req)', "host: '0.0.0.0'").some((p) => /硬编码/.test(p)));
  t('  本地代理合规写法通过',
    checkDevProxy('if (!devOriginAllowed(req)) return 403', "host: env.ADMIN_DEV_HOST || '127.0.0.1'").length === 0);

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`);
    process.exit(1);
  }
  console.log('\n自检通过：无门/半门/通配 CORS/appToken 泄露都会被抓，合规写法不误报');
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  const { problems, files } = scanRepo();
  if (problems.length) {
    console.error(`✗ Pages Functions 鉴权闸缺失 ${problems.length} 处：`);
    problems.forEach((p) => console.error(`  - ${p}`));
    console.error('\n修法：`const gate = await guardAdminRequest(request, env); if (!gate.ok) return json(gate.body, gate.status, headers)`');
    process.exit(1);
  }
  console.log(`✓ 管理代理鉴权闸齐全（Pages Functions ${files.length} 个端点，${files.filter((f) => !EXEMPT.has(f)).length} 个需鉴权；本地 dev 代理已校验来源且默认只绑本机）`);
}
