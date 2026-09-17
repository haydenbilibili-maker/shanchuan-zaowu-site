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
 * 用法：
 *   node scripts/verify-site-dist.mjs            # dist 不存在则跳过（CI 的守卫阶段还没构建）
 *   node scripts/verify-site-dist.mjs --selftest # 用合成样例证明四条都能失败
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

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
 */
export function checkPageImages(pages, fileExists, siteHost = '') {
  const problems = [];
  let checked = 0;
  for (const { name, html } of pages) {
    for (const ref of extractImageRefs(html)) {
      const loc = localPathOf(ref);
      if (!loc) continue;
      if (loc.host && siteHost && loc.host !== siteHost) continue; // 外链图片不检查
      checked += 1;
      if (!fileExists(join(DIST, loc.path))) {
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

function scanDist() {
  if (!existsSync(DIST)) {
    console.log('（dist 不存在，跳过产物校验 —— 守卫阶段会先于构建运行，属正常）');
    return 0;
  }
  const files = collectHtml(DIST);
  const pages = files.map((f) => ({ name: relative(DIST, f), html: readFileSync(f, 'utf8') }));
  const headersPath = join(DIST, '_headers');
  const headersText = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';

  const img = checkPageImages(pages, (p) => existsSync(p) && statSync(p).isFile(), 'shanhaizaowu.com');
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

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 校验器不可信，请先修它`);
    process.exit(1);
  }
  console.log('\n自检通过：分享图 404 / 缺安全头 / 缺 no-JS 兜底都会被抓，对照样例不误报');
}

if (process.argv.includes('--selftest')) selftest();
else process.exit(scanDist());
