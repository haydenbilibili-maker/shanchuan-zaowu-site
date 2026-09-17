#!/usr/bin/env node
/**
 * Pages Functions 鉴权闸的**行为测试**（真跑 onRequest，不打桩）
 *
 * 背景（2026-09-17 全面审计 A2/A3，线上实测）：
 *   `/api/ai` 与 `/api/feishu-sync` 此前完全无鉴权 —— `GET /api/feishu-sync` 直接回显 appToken，
 *   `/api/ai` 可当免费 LLM 代理盗刷付费额度。两者现已接入 `guardAdminRequest`。
 *   `check:api-auth` 只能**静态**证明「代码里有门」；本测试证明「门真的拦得住」。
 *
 * 为什么能在 Node 里跑：`guardAdminRequest` 只用 Web Crypto + Request/Response（Node 22 原生具备）；
 * 三个端点在「未配置厂商密钥」时会提前返回，不触网。
 *
 * 断言（P 系列 = 应通过；N 系列 = 负向对照，证明断言不是因为别的原因成立）：
 *   P1 无 Cookie → 401 UNAUTHORIZED
 *   P2 合法 Cookie → 过闸（/api/ai 走到 503 AI_KEY_NOT_CONFIGURED，说明不是被闸挡下）
 *   P3 过期 Cookie → 401 SESSION_EXPIRED
 *   P4 伪造签名 → 401 UNAUTHORIZED
 *   P5 未配置 ADMIN_PROXY_PASSWORD → 503（fail-closed，不是放行）
 *   P6 非白名单 Origin → 403
 *   P7 /api/feishu-sync 响应体不得出现 FEISHU_APP_TOKEN 的值
 *   P8 /api/cloud-fn：GET 探活免会话（200），POST 无会话 → 401
 *   P9 未授权响应不得带 `Access-Control-Allow-Origin: *`
 *   N1 换掉签名密钥后，同一 Cookie 必须失效（证明 HMAC 校验是真的，不是形状检查）
 *   N2 不带 Origin 且不带 Cookie → 仍是 401（证明 401 由会话导致，不是来源逻辑）
 *
 * 用法：node scripts/test-api-auth-behavior.mjs [--selftest]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const AI_FILE = join(ROOT, 'functions', 'api', 'ai.js');

const ORIGIN = 'https://shanhaizaowu.com';
const ENV = {
  ADMIN_PROXY_PASSWORD: 'unit-test-password',
  ADMIN_PROXY_SECRET: 'unit-test-signing-secret',
  FEISHU_APP_ID: '',
  FEISHU_APP_SECRET: '',
  FEISHU_APP_TOKEN: 'tok_SHOULD_NEVER_APPEAR_in_response',
};

const { guardAdminRequest, issueSessionToken, SESSION_COOKIE } = await import('../functions/_lib/proxySession.mjs');
const ai = await import('../functions/api/ai.js');
const feishu = await import('../functions/api/feishu-sync.js');
const cloudFn = await import('../functions/api/cloud-fn.js');

function req(path, { method = 'GET', cookie = '', origin = '', body: payload = '' } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = `${SESSION_COOKIE}=${encodeURIComponent(cookie)}`;
  if (origin) headers.Origin = origin;
  if (payload) headers['Content-Type'] = 'application/json';
  return new Request(`${ORIGIN}${path}`, { method, headers, body: payload || undefined });
}

async function body(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

/** 手工签一个「已过期」的 Cookie（issueSessionToken 有最小 60s 下限） */
async function expiredCookie(secret) {
  const exp = Math.floor(Date.now() / 1000) - 10;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`admin-session:${exp}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${exp}.${hex}`;
}

export async function runChecks() {
  const failures = [];
  let pass = 0;
  const t = (name, ok, detail = '') => {
    if (ok) { pass += 1; return; }
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  };

  const good = await issueSessionToken(ENV, 3600);

  // P1 无 Cookie → 401
  {
    const res = await ai.onRequest({ request: req('/api/ai'), env: ENV });
    const b = await body(res);
    t('P1 无 Cookie → 401 UNAUTHORIZED', res.status === 401 && b.code === 'UNAUTHORIZED', `status=${res.status} code=${b.code}`);
  }

  // P2 合法 Cookie → 过闸（503 AI_KEY_NOT_CONFIGURED 表示已进入业务逻辑）
  {
    const res = await ai.onRequest({
      request: req('/api/ai', { method: 'POST', cookie: good, body: JSON.stringify({ provider: 'deepseek', payload: {} }) }),
      env: ENV,
    });
    const b = await body(res);
    t('P2 合法 Cookie → 过闸（走到 503 AI_KEY_NOT_CONFIGURED）',
      res.status === 503 && b.code === 'AI_KEY_NOT_CONFIGURED', `status=${res.status} code=${b.code}`);
  }

  // P3 过期 Cookie → 401 SESSION_EXPIRED
  {
    const res = await ai.onRequest({ request: req('/api/ai', { cookie: await expiredCookie(ENV.ADMIN_PROXY_SECRET) }), env: ENV });
    const b = await body(res);
    t('P3 过期 Cookie → 401 SESSION_EXPIRED', res.status === 401 && b.code === 'SESSION_EXPIRED', `status=${res.status} code=${b.code}`);
  }

  // P4 伪造签名 → 401
  {
    const forged = `${Math.floor(Date.now() / 1000) + 3600}.${'a'.repeat(64)}`;
    const res = await ai.onRequest({ request: req('/api/ai', { cookie: forged }), env: ENV });
    const b = await body(res);
    t('P4 伪造签名 → 401', res.status === 401 && b.code === 'UNAUTHORIZED', `status=${res.status} code=${b.code}`);
  }

  // P5 未配置口令 → 503 fail-closed（此时连合法 Cookie 也拒绝）
  {
    const weakEnv = { ...ENV, ADMIN_PROXY_PASSWORD: '' };
    const res = await ai.onRequest({ request: req('/api/ai', { cookie: good }), env: weakEnv });
    const b = await body(res);
    t('P5 未配置 ADMIN_PROXY_PASSWORD → 503 fail-closed',
      res.status === 503 && b.code === 'PROXY_PASSWORD_NOT_CONFIGURED', `status=${res.status} code=${b.code}`);
  }

  // P6 非白名单 Origin → 403
  {
    const res = await ai.onRequest({ request: req('/api/ai', { cookie: good, origin: 'https://evil.example' }), env: ENV });
    const b = await body(res);
    t('P6 非白名单 Origin → 403', res.status === 403, `status=${res.status} msg=${b.msg}`);
  }

  // P7 feishu 响应不得回显 appToken
  {
    const res = await feishu.onRequest({ request: req('/api/feishu-sync', { cookie: good }), env: ENV });
    const text = await res.clone().text();
    const b = await body(res);
    t('P7 feishu 状态响应不含 appToken 值',
      res.status === 200 && !('appToken' in b) && !text.includes(ENV.FEISHU_APP_TOKEN), `status=${res.status} keys=${Object.keys(b).join(',')}`);
  }

  // P8 cloud-fn：GET 探活免会话，POST 无会话 → 401
  {
    const probe = await cloudFn.onRequest({ request: req('/api/cloud-fn'), env: ENV });
    const post = await cloudFn.onRequest({ request: req('/api/cloud-fn', { method: 'POST' }), env: ENV });
    const pb = await body(probe);
    const qb = await body(post);
    t('P8 cloud-fn GET 探活 200 / POST 无会话 401',
      probe.status === 200 && pb.success === true && post.status === 401 && qb.code === 'UNAUTHORIZED',
      `probe=${probe.status} post=${post.status}`);
  }

  // P9 未授权响应不得带通配 CORS
  {
    const res = await ai.onRequest({ request: req('/api/ai', { origin: 'https://evil.example' }), env: ENV });
    const acao = res.headers.get('Access-Control-Allow-Origin');
    t('P9 未授权/非白名单来源不返回 Access-Control-Allow-Origin: *', acao !== '*', `acao=${acao}`);
  }

  // N1 换签名密钥 → 同一 Cookie 失效（证明 HMAC 校验是真的）
  {
    const otherEnv = { ...ENV, ADMIN_PROXY_SECRET: 'another-secret' };
    const res = await ai.onRequest({ request: req('/api/ai', { cookie: good }), env: otherEnv });
    t('N1 换签名密钥后同一 Cookie 失效（负向对照）', res.status === 401, `status=${res.status}`);
  }

  // N2 不带 Origin 也不带 Cookie → 仍是 401（证明 401 由会话导致）
  {
    const res = await guardAdminRequest(req('/api/ai'), ENV);
    t('N2 无 Origin 无 Cookie → 仍 401（负向对照）', res.ok === false && res.status === 401, `status=${res.status}`);
  }

  return { pass, failures };
}

if (process.argv.includes('--selftest')) {
  console.log('自检：把 /api/ai 的鉴权闸摘掉 → 本测试必须变红 → 按字节还原\n');
  const original = readFileSync(AI_FILE, 'utf8');
  const NEEDLE = '  if (!gate.ok) return json(gate.body, gate.status, headers)';
  let bad = 0;
  if (!original.includes(NEEDLE)) {
    console.error(`✗ 自检无法注入：ai.js 里找不到锚点 \`${NEEDLE}\``);
    process.exit(1);
  }
  try {
    // 摘掉闸但不改变形状（保留调用，只让失败时也继续）——模拟「有人把门去掉」
    writeFileSync(AI_FILE, original.replace(NEEDLE, '  void gate'));
    const r = spawnSync(process.execPath, [SELF], { encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const detected = r.status === 1 && /✗ P1 /.test(out);
    console.log(`${detected ? '✓' : '✗'} 摘掉 /api/ai 的鉴权闸 → 本测试变红（子进程 exit ${r.status}）`);
    if (!detected) { bad += 1; console.log(out.slice(-800)); }
  } finally {
    writeFileSync(AI_FILE, original);
  }
  const restored = readFileSync(AI_FILE, 'utf8') === original;
  console.log(`${restored ? '✓' : '✗'} functions/api/ai.js 已按字节还原`);
  if (!restored) bad += 1;
  if (bad) { console.error('\n自检失败：本测试无法证明鉴权闸真的在拦。'); process.exit(1); }
  console.log('\n自检通过：摘掉闸后测试确实变红。');
  process.exit(0);
}

const { pass, failures } = await runChecks();
console.log(`Pages Functions 鉴权行为测试：${pass} 项通过，${failures.length} 项失败`);
if (failures.length) {
  console.error('\n失败明细：');
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  process.exit(1);
}
console.log('全部通过：无会话/过期/伪造签名/未配置口令/非白名单来源全部被拒，合法会话可过闸，且响应不回显 appToken。');
