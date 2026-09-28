#!/usr/bin/env node
/**
 * 内部资料「超管登录后可看」端点 /api/private-asset 的行为测试（真跑路由文件 onRequest）
 *
 * 背景（2026-09-29）：资本架构沙盘 / 启动成本模型 / 合伙人命理中心（含 11 位具名人员及家属生辰八字）
 * 曾在 ERP 公开目录被直链访问，已迁入 governance-assets（构建剔除）；产品负责人要求「线上可以看」，
 * 口径为「线上 ERP 超管登录后可看」—— 由该端点校验 /api/admin-session 的签名 Cookie 后返回内容。
 * 文件本身**仍不得进公开 dist**，那条由 check:publish-dir / verify-admin-dist 守。
 *
 * 为什么能在 Node 里跑：路由文件 `import x from '...html'`（wrangler 按文本模块打包），
 * 这里注册一个 loader 钩子把 .html 转成 `export default "<文本>"`，其余与线上同一份代码。
 *
 * 断言：
 *   P1 无 Cookie → 401，且带 no-store / noindex
 *   P2 无 Cookie + 白名单外文件名 → 仍 401（先鉴权后白名单，不泄露白名单）
 *   P3 过期 / 伪造 Cookie → 401；未配置 ADMIN_PROXY_PASSWORD → 503；非白名单 Origin → 403
 *   P4 合法 Cookie + 白名单内每个文件 → 200 text/html，内容与源文件逐字节一致，
 *      Cache-Control 含 private 与 no-store，X-Robots-Tag 含 noindex
 *   P5 合法 Cookie + 白名单外 / 穿越 / 原型链名 → 404
 *   P6 HEAD → 200 空体；POST → 405
 *   S1 路由文件的资料映射 ≡ 白名单，且每个源文件都在 admin/public/governance-assets/erp-embeds/（构建剔除目录）
 *
 * 用法：node scripts/test-private-asset.mjs [--selftest]
 *   --selftest：在临时目录的**副本**里注入 6 种回归，逐个必须被检出（不写共享工作区）。
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE_REL = 'functions/api/private-asset.js';
const LIB_REL = 'functions/_lib/privateAsset.mjs';
const SESSION_REL = 'functions/_lib/proxySession.mjs';
const EMBED_DIR_REL = 'admin/public/governance-assets/erp-embeds';

register(
  `data:text/javascript,${encodeURIComponent(`
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function load(url, context, next) {
  const bare = url.split('?')[0];
  if (bare.startsWith('file:') && bare.endsWith('.html')) {
    const text = await readFile(fileURLToPath(bare), 'utf8');
    return { format: 'module', source: 'export default ' + JSON.stringify(text), shortCircuit: true };
  }
  return next(url, context);
}`)}`,
);

const ORIGIN = 'https://shanhaizaowu.com';
const ENV = { ADMIN_PROXY_PASSWORD: 'unit-test-password', ADMIN_PROXY_SECRET: 'unit-test-signing-secret' };
const BAD_NAMES = [
  'sanyou-minglu.pdf',
  '../../admin/index.html',
  'erp-embeds/partner-destiny-center.html',
  'partner-destiny-center.html/',
  'Partner-Destiny-Center.html',
  '__proto__',
  'hasOwnProperty',
  'constructor',
  '',
];

async function hmacCookie(secret, exp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`admin-session:${exp}`));
  return `${exp}.${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** 静态：路由文件里 import 的资料文件名集合 + 路径 */
function routeImports(src) {
  return [...src.matchAll(/^import\s+\w+\s+from\s+['"]([^'"]+\.html)['"]/gm)].map((m) => m[1]);
}

/**
 * @param {string} root 仓库根（或 selftest 的副本根）
 */
export async function runChecks(root = ROOT) {
  const failures = [];
  let pass = 0;
  const t = (name, ok, detail = '') => {
    if (ok) pass += 1;
    else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  };

  let route;
  let lib;
  let session;
  try {
    route = await import(pathToFileURL(join(root, ROUTE_REL)).href);
    lib = await import(pathToFileURL(join(root, LIB_REL)).href);
    session = await import(pathToFileURL(join(root, SESSION_REL)).href);
  } catch (e) {
    failures.push(`路由文件无法加载（资料源文件缺失或路径错误？）— ${e.message.split('\n')[0]}`);
    return { pass, failures };
  }
  const names = [...lib.PRIVATE_ASSET_NAMES];
  const good = await session.issueSessionToken(ENV, 3600);
  const call = (name, { method = 'GET', cookie = '', origin = '', env = ENV } = {}) => {
    const headers = {};
    if (cookie) headers.Cookie = `${session.SESSION_COOKIE}=${encodeURIComponent(cookie)}`;
    if (origin) headers.Origin = origin;
    const qs = name === null ? '' : `?name=${encodeURIComponent(name)}`;
    return route.onRequest({ request: new Request(`${ORIGIN}/api/private-asset${qs}`, { method, headers }), env });
  };
  const privateHeaders = (res) => {
    const cc = res.headers.get('Cache-Control') || '';
    const robots = res.headers.get('X-Robots-Tag') || '';
    return /no-store/.test(cc) && /private/.test(cc) && /noindex/.test(robots);
  };

  // P1
  {
    const res = await call(names[0]);
    t('P1 无 Cookie → 401 且带 private,no-store / noindex', res.status === 401 && privateHeaders(res),
      `status=${res.status} cc=${res.headers.get('Cache-Control')} robots=${res.headers.get('X-Robots-Tag')}`);
  }
  // P2
  {
    const res = await call('sanyou-minglu.pdf');
    t('P2 无 Cookie + 白名单外文件名 → 仍 401（先鉴权后白名单）', res.status === 401, `status=${res.status}`);
  }
  // P3
  {
    const expired = await call(names[0], { cookie: await hmacCookie(ENV.ADMIN_PROXY_SECRET, Math.floor(Date.now() / 1000) - 10) });
    const forged = await call(names[0], { cookie: `${Math.floor(Date.now() / 1000) + 3600}.${'a'.repeat(64)}` });
    const otherSecret = await call(names[0], { cookie: good, env: { ...ENV, ADMIN_PROXY_SECRET: 'another-secret' } });
    const noPwd = await call(names[0], { cookie: good, env: { ...ENV, ADMIN_PROXY_PASSWORD: '' } });
    const evil = await call(names[0], { cookie: good, origin: 'https://evil.example' });
    t('P3 过期 Cookie → 401', expired.status === 401, `status=${expired.status}`);
    t('P3 伪造签名 → 401', forged.status === 401, `status=${forged.status}`);
    t('P3 换签名密钥后同一 Cookie 失效 → 401', otherSecret.status === 401, `status=${otherSecret.status}`);
    t('P3 未配置 ADMIN_PROXY_PASSWORD → 503 fail-closed', noPwd.status === 503, `status=${noPwd.status}`);
    t('P3 非白名单 Origin → 403', evil.status === 403, `status=${evil.status}`);
  }
  // P4
  t('P4 白名单非空', names.length >= 3, `names=${names.length}`);
  for (const name of names) {
    const res = await call(name, { cookie: good });
    const text = await res.text();
    let expected = '';
    try { expected = readFileSync(join(root, EMBED_DIR_REL, name), 'utf8'); } catch { /* 下方判红 */ }
    t(`P4 合法 Cookie → 200 ${name}`,
      res.status === 200 && /text\/html/.test(res.headers.get('Content-Type') || '') && privateHeaders(res)
        && expected.length > 0 && text === expected,
      `status=${res.status} ctype=${res.headers.get('Content-Type')} cc=${res.headers.get('Cache-Control')} robots=${res.headers.get('X-Robots-Tag')} bytes=${text.length}/${expected.length}`);
  }
  // P5
  for (const bad of BAD_NAMES) {
    const res = await call(bad, { cookie: good });
    t(`P5 白名单外文件名 → 404「${bad}」`, res.status === 404 && privateHeaders(res), `status=${res.status}`);
  }
  {
    const res = await call(null, { cookie: good });
    t('P5 缺 name 参数 → 404', res.status === 404, `status=${res.status}`);
  }
  // P6
  {
    const head = await call(names[0], { method: 'HEAD', cookie: good });
    const headBody = await head.text();
    const post = await call(names[0], { method: 'POST', cookie: good });
    t('P6 HEAD → 200 空体', head.status === 200 && headBody === '' && privateHeaders(head), `status=${head.status} bytes=${headBody.length}`);
    t('P6 POST → 405', post.status === 405, `status=${post.status}`);
  }
  // S1
  {
    const src = readFileSync(join(root, ROUTE_REL), 'utf8');
    const imports = routeImports(src);
    const files = imports.map((p) => p.split('/').pop());
    const keys = [...src.matchAll(/^\s*'([^']+)'\s*:\s*\w+,?\s*$/gm)].map((m) => m[1]);
    const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
    t('S1 路由资料映射键 ≡ 白名单', sameSet(keys, names), `keys=${keys.join(',')} names=${names.join(',')}`);
    t('S1 路由 import 的文件 ≡ 白名单', sameSet(files, names), `files=${files.join(',')}`);
    const outside = imports.filter((p) => !p.startsWith(`../../${EMBED_DIR_REL}/`));
    t('S1 资料源文件全部位于 governance-assets/erp-embeds（构建剔除目录）', outside.length === 0, `越界：${outside.join(',')}`);
  }
  return { pass, failures };
}

/** 在临时目录建一份最小副本（路由 + 两个 lib + 资料文件），返回副本根 */
function makeCopy(mutate = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'private-asset-selftest-'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  for (const rel of [ROUTE_REL, LIB_REL, SESSION_REL]) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    const src = readFileSync(join(ROOT, rel), 'utf8');
    writeFileSync(join(dir, rel), mutate[rel] ? mutate[rel](src) : src);
  }
  mkdirSync(join(dir, EMBED_DIR_REL), { recursive: true });
  const lib = readFileSync(join(ROOT, LIB_REL), 'utf8');
  for (const [, name] of lib.matchAll(/^\s*'([^']+\.html)',$/gm)) {
    copyFileSync(join(ROOT, EMBED_DIR_REL, name), join(dir, EMBED_DIR_REL, name));
  }
  mkdirSync(join(dir, 'admin/public'), { recursive: true });
  copyFileSync(join(ROOT, EMBED_DIR_REL, 'partner-destiny-center.html'), join(dir, 'admin/public/partner-destiny-center.html'));
  return dir;
}

function must(src, needle, replacement) {
  if (!src.includes(needle)) throw new Error(`自检锚点不存在：${needle}`);
  return src.replace(needle, replacement);
}

async function selftest() {
  const cases = [
    ['摘掉路由里的鉴权闸', /P1 /, {
      [ROUTE_REL]: (s) => must(s, '  if (!gate.ok) return privateJson(gate.body, gate.status)\n', '  void gate\n'),
    }],
    ['先查白名单后鉴权（未登录可探测白名单）', /P2 /, {
      [ROUTE_REL]: (s) => must(s, '  const gate = await guardAdminRequest(request, env)\n',
        '  const early = servePrivateAsset(request, ASSETS)\n  if (early.status === 404) return early\n  const gate = await guardAdminRequest(request, env)\n'),
    }],
    ['响应改为可缓存（public, max-age）', /P4 /, {
      [LIB_REL]: (s) => must(s, "'Cache-Control': 'private, no-store, max-age=0'", "'Cache-Control': 'public, max-age=3600'"),
    }],
    ['去掉 X-Robots-Tag noindex', /P1 /, {
      [LIB_REL]: (s) => must(s, "  'X-Robots-Tag': 'noindex, nofollow, noarchive',\n", ''),
    }],
    ['白名单被绕过（路由多挂一个文件 + 去掉白名单判定）', /P5 白名单外文件名 → 404「sanyou-minglu\.pdf」/, {
      [LIB_REL]: (s) => must(s, '!PRIVATE_ASSET_NAMES.includes(name) || ', ''),
      [ROUTE_REL]: (s) => must(s, "const ASSETS = {\n", "const ASSETS = {\n  'sanyou-minglu.pdf': capitalSandbox,\n"),
    }],
    ['资料源文件改从公开目录 admin/public/ 根取', /S1 资料源文件全部位于/, {
      [ROUTE_REL]: (s) => must(s, "'../../admin/public/governance-assets/erp-embeds/partner-destiny-center.html'",
        "'../../admin/public/partner-destiny-center.html'"),
    }],
  ];
  let bad = 0;
  const base = await runChecks(makeCopy());
  const baseOk = base.failures.length === 0;
  console.log(`${baseOk ? '✓' : '✗'} 未注入的副本全绿（${base.pass} 项）`);
  if (!baseOk) { bad += 1; base.failures.forEach((f) => console.log(`    ${f}`)); }
  for (const [label, expect, mutate] of cases) {
    const dir = makeCopy(mutate);
    try {
      const r = await runChecks(dir);
      const hit = r.failures.some((f) => expect.test(f));
      console.log(`${hit ? '✓' : '✗'} ${label} → 检出`);
      if (!hit) { bad += 1; console.log(`    实际失败项：${r.failures.join(' | ') || '（无）'}`); }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (bad) {
    console.error(`\n自检失败 ${bad} 项：本测试无法证明私有资料端点的门真的在拦。`);
    process.exit(1);
  }
  console.log(`\n自检通过：${cases.length} 种回归全部检出（均在临时副本中注入，未写工作区）。`);
  process.exit(0);
}

if (process.argv.includes('--selftest')) {
  await selftest();
} else {
  const { pass, failures } = await runChecks();
  console.log(`私有资料端点 /api/private-asset 行为测试：${pass} 项通过，${failures.length} 项失败`);
  if (failures.length) {
    console.error('\n失败明细：');
    failures.forEach((f) => console.error(`  ✗ ${f}`));
    process.exit(1);
  }
  console.log('全部通过：未登录/过期/伪造/未配置口令/非白名单来源一律拒绝，白名单外文件名 404，合法会话 200 且 no-store/noindex，资料源只在构建剔除目录。');
  process.exit(0);
}
