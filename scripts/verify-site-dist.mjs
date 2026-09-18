#!/usr/bin/env node
/**
 * 官网产物校验（构建后 / 部署前）
 *
 * 为什么（2026-09-17 全面审计 E5/E6/E9）：
 *   `Layout.astro` 的默认分享图 `/images/hero/home-hero.jpg` **根本不存在**（占位目录里只有 README），
 *   而它是全站默认值 → 14 个构建页面的 `og:image` / `twitter:image` 全部指向 404。
 *   这类问题「构建通过、页面能开」，只有拿产物去核 URL 才能发现，故放在构建链尾部。
 *
 * 检查项（都作用在 `dist/`）：
 *   S1 每页的 `og:image` / `twitter:image` 必须指向 dist 里真实存在的文件
 *   S2 每页的 `<link rel="preload" as="image">` 同理
 *   S3 `dist/_headers` 必须显式声明安全响应头（E9）
 *   S4 凡出现 `class="fade-in"` 的页面，必须有 `<noscript>` 兜底（否则 JS 失败时整块不可见）
 *
 * 退出码契约（错题本 E16「无法验证 ≠ 通过」）：
 *   0 = 产物存在且校验通过
 *   1 = 产物存在但校验失败（真红）
 *   2 = 产物缺失 → **无法判定**：既不报「通过」，也不打印「跳过」给 0
 *
 * 为什么缺产物必须是 2（2026-09-18 交接 §2 假绿清单第 2 条）：
 *   本守卫的输入是**构建产物**，但它当时**也被登记在 `check:admin` 的守卫链里**，
 *   而那条链先于构建运行 → `dist` 必然不存在 → 打印「跳过」并 `exit 0`，
 *   在汇总表里就是一行 ✓ —— **链内从未校验过产物**。这正是 E16 的典型形态。
 *
 * 正确接法（本守卫只放在构建之后）：
 *   `npm run build` 链尾**已包含** `node scripts/verify-site-dist.mjs`（构建后、部署前）；
 *   因此它**不得**再留在 `guards/*.txt`（那条链先于构建，永远没有 dist）。
 *   域文件归集成官，本脚本只能在缺产物时给出可执行的诊断（见下方 exit 2 分支）。
 *
 * 用法：
 *   node scripts/verify-site-dist.mjs            # 校验 <repo>/dist（缺失 → exit 2）
 *   node scripts/verify-site-dist.mjs --selftest # 纯函数样例 + 退出码契约端到端
 * 环境变量：
 *   SITE_DIST_DIR  覆盖产物目录（**自检/工具**用；默认 `<repo>/dist`，不改判据）
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');
/** 产物根：默认 `<repo>/dist`。`SITE_DIST_DIR` 只换输入位置，不换判据 */
const DIST = process.env.SITE_DIST_DIR ? resolve(process.env.SITE_DIST_DIR) : join(ROOT, 'dist');

const REQUIRED_HEADERS = ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options'];

/** 递归收集 .html */
export function collectHtml(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'admin' || e.name === '_astro') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectHtml(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** 从一段 HTML 里抽出所有本地图片 URL（og/twitter/preload） */
export function extractImageRefs(html) {
  const refs = [];
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/gi,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi,
    /<link[^>]+rel=["']preload["'][^>]+as=["']image["'][^>]+href=["']([^"']+)["']/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html))) refs.push(m[1]);
  }
  return [...new Set(refs)];
}

/** 绝对 URL / 协议相对 → 取 pathname；返回本地路径或 null（外链不检查） */
export function localPathOf(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (raw.startsWith('//')) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return { host: u.host, path: u.pathname };
    } catch {
      return null;
    }
  }
  if (raw.startsWith('/')) return { host: '', path: raw };
  return null;
}

/**
 * 纯函数：对一组页面做 S1/S2 检查。
 * @param {Array<{name:string, html:string}>} pages
 * @param {(p:string)=>boolean} fileExists 传入 dist 内绝对路径
 * @param {string} siteHost 允许的绝对 URL 主机名（空=不校验主机）
 * @param {string} baseDir 产物根（本地 URL 相对它解析；默认模块级 DIST）
 */
export function checkPageImages(pages, fileExists, siteHost = '', baseDir = DIST) {
  const problems = [];
  let checked = 0;
  for (const { name, html } of pages) {
    for (const ref of extractImageRefs(html)) {
      const loc = localPathOf(ref);
      if (!loc) continue;
      if (loc.host && siteHost && loc.host !== siteHost) continue; // 外链图片不检查
      checked += 1;
      if (!fileExists(join(baseDir, loc.path))) {
        problems.push(`${name} 引用了不存在的图片：${ref}`);
      }
    }
  }
  return { problems, checked };
}

/** S3：_headers 必须显式声明安全头 */
export function checkSecurityHeaders(headersText) {
  const problems = [];
  for (const h of REQUIRED_HEADERS) {
    if (!new RegExp(`^\\s*${h}\\s*:`, 'im').test(headersText)) {
      problems.push(`public/_headers 未声明 ${h}（审计 E9）`);
    }
  }
  return problems;
}

/** S4：用了 .fade-in 的页面必须有 noscript 兜底 */
export function checkFadeInFallback(pages) {
  const problems = [];
  for (const { name, html } of pages) {
    if (!/class=["'][^"']*\bfade-in\b/.test(html)) continue;
    if (!/<noscript>[\s\S]*?fade-in[\s\S]*?<\/noscript>/i.test(html)) {
      problems.push(`${name} 用了 .fade-in 但没有 <noscript> 兜底（JS 失败时内容永久不可见，审计 E6）`);
    }
  }
  return problems;
}

/**
 * 校验产物目录。返回本脚本的退出码：0 通过 / 1 校验失败 / 2 产物缺失（无法判定）。
 * **2 绝不退化成 0**：产物是唯一输入，输入不在就没有「通过」可言（E16）。
 */
export function verifyDist(distDir) {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    console.error('✗ 无法判定（exit 2）：产物目录不存在 —— 本守卫没有输入可校验');
    console.error(`  期望目录：${distDir}`);
    console.error('  这不是「通过」：产物缺失时判据一条都没跑（错题本 E16：无法验证 ≠ 通过）。');
    console.error('  正确接法：本守卫只放在**构建之后** —— `npm run build` 链尾已包含它；');
    console.error('  它不得留在 check:admin 的守卫链里（守卫链先于构建运行，必然没有 dist）。');
    console.error('  处置：请集成官从 guards/80-cross.txt 移除 `npm run verify:site-dist` 一行（见交接报告变更请求）。');
    return 2;
  }
  const files = collectHtml(distDir);
  const pages = files.map((f) => ({ name: relative(distDir, f), html: readFileSync(f, 'utf8') }));
  const headersPath = join(distDir, '_headers');
  const headersText = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';

  const img = checkPageImages(pages, (p) => existsSync(p) && statSync(p).isFile(), 'shanhaizaowu.com', distDir);
  const problems = [...img.problems, ...checkSecurityHeaders(headersText), ...checkFadeInFallback(pages)];

  if (problems.length) {
    console.error(`✗ 官网产物校验失败 ${problems.length} 处：`);
    problems.slice(0, 20).forEach((p) => console.error(`  - ${p}`));
    if (problems.length > 20) console.error(`  …另有 ${problems.length - 20} 处`);
    return 1;
  }
  console.log(`✓ 官网产物校验通过（${pages.length} 个页面 · 校验 ${img.checked} 个分享/预载图 URL + 安全头 + no-JS 兜底）`);
  return 0;
}

function selftest() {
  let bad = 0;
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`); };
  const never = () => false;
  const always = () => true;

  const og404 = [{ name: 'a.html', html: '<meta property="og:image" content="https://shanhaizaowu.com/images/hero/home-hero.jpg">' }];
  const ogOk = [{ name: 'b.html', html: '<meta property="og:image" content="/specimens/hero-specimen.jpg">' }];
  const ext = [{ name: 'c.html', html: '<meta name="twitter:image" content="https://cdn.example.com/x.jpg">' }];

  t('★ E5 形态：og:image 指向不存在的文件 → 检出',
    checkPageImages(og404, never, 'shanhaizaowu.com').problems.length === 1);
  t('  对照：文件存在 → 通过', checkPageImages(ogOk, always, 'shanhaizaowu.com').problems.length === 0);
  t('  外链图片不误报', checkPageImages(ext, never, 'shanhaizaowu.com').problems.length === 0);
  t('★ preload 图缺失也能检出',
    checkPageImages([{ name: 'd.html', html: '<link rel="preload" as="image" href="/specimens/nope.jpg">' }], never).problems.length === 1);

  t('★ E9：_headers 缺安全头 → 检出', checkSecurityHeaders('/*\n  Cache-Control: no-store\n').length === REQUIRED_HEADERS.length);
  t('  _headers 齐全 → 通过',
    checkSecurityHeaders('/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n').length === 0);

  t('★ E6：有 .fade-in 无 noscript → 检出',
    checkFadeInFallback([{ name: 'e.html', html: '<div class="fade-in">x</div>' }]).length === 1);
  t('  有 noscript 兜底 → 通过',
    checkFadeInFallback([{ name: 'f.html', html: '<div class="fade-in">x</div><noscript><style>.fade-in{opacity:1}</style></noscript>' }]).length === 0);
  t('  没用 .fade-in 的页面不误报',
    checkFadeInFallback([{ name: 'g.html', html: '<div class="x">y</div>' }]).length === 0);

  // ── 退出码契约（端到端：真起子进程，判据就是 `dist` 在不在）────────────────
  // 这是交接 §2 假绿清单第 2 条的回归判据：**缺 dist 必须失败**，
  // 且不许再出现「跳过 + exit 0」那种在汇总表里变成 ✓ 的形态（E16）。
  const tmpRoot = mkdtempSync(join(tmpdir(), 'sczw-site-dist-'));
  const runWith = (dir) => {
    const r = spawnSync(process.execPath, [SELF], { env: { ...process.env, SITE_DIST_DIR: dir }, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
  };
  const HEADERS_OK = '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n';
  try {
    // ★ 缺产物 → 2（核心判据）
    const rMissing = runWith(join(tmpRoot, 'not-built'));
    t('★ 缺 dist → exit 2（无法判定；不打印「跳过」、不出现 ✓）',
      rMissing.code === 2 && !rMissing.out.includes('跳过') && !rMissing.out.includes('✓'));
    t('  缺 dist 的诊断可执行（点名 E16 + 请集成官改 guards/80-cross.txt）',
      /无法判定/.test(rMissing.out) && /guards\/80-cross\.txt/.test(rMissing.out));

    // 反例：产物存在且干净 → 0（防「一刀切恒红」）
    const good = join(tmpRoot, 'good-dist');
    mkdirSync(join(good, 'images'), { recursive: true });
    writeFileSync(join(good, '_headers'), HEADERS_OK);
    writeFileSync(join(good, 'images', 'ok.jpg'), 'x');
    writeFileSync(join(good, 'index.html'), '<meta property="og:image" content="https://shanhaizaowu.com/images/ok.jpg">');
    const rGood = runWith(good);
    t('  对照：产物存在且干净 → exit 0（真校验，不是恒红）',
      rGood.code === 0 && /✓ 官网产物校验通过/.test(rGood.out));

    // 产物存在但坏 → 1（判据未被削弱）
    const badDist = join(tmpRoot, 'bad-dist');
    mkdirSync(badDist, { recursive: true });
    writeFileSync(join(badDist, '_headers'), '/*\n  Cache-Control: no-store\n');
    writeFileSync(join(badDist, 'index.html'),
      '<meta property="og:image" content="/images/gone.jpg"><div class="fade-in">x</div>');
    t('★ 产物存在但分享图缺失 / 安全头缺失 / 无 noscript 兜底 → exit 1', runWith(badDist).code === 1);

    // 空产物目录（构建产出为空）→ 1，fail-closed，不得因"没有页面"而通过
    const empty = join(tmpRoot, 'empty-dist');
    mkdirSync(empty, { recursive: true });
    t('★ 产物目录为空 → exit 1（fail-closed，不是「没有页面就算通过」）', runWith(empty).code === 1);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 校验器不可信，请先修它`);
    process.exit(1);
  }
  console.log('\n自检通过：分享图 404 / 缺安全头 / 缺 no-JS 兜底都会被抓，对照样例不误报；'
    + '退出码契约 缺 dist=2 / 坏产物=1 / 干净产物=0 / 空产物=1');
}

if (process.argv.includes('--selftest')) selftest();
else process.exit(verifyDist(DIST));
