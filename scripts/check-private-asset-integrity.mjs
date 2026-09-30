#!/usr/bin/env node
/**
 * 内部资料（/api/private-asset 白名单 HTML）内容完整性守卫
 *
 * 起因（2026-09-30，产品负责人：ERP「独菽」命理全书缺失绝大部分内容）：
 *   partner-destiny-center.html 自 2026-05-29 入库起就有一对相互抵消的 </div> 错误 ——
 *   第 2 章「用神体系深度解读」后多一个 </div>、第 20 章末尾少一个 </div>。粗数 <div> 与 </div> 是配平的，
 *   但浏览器解析时 #tab-a 在第 2 章就被关掉，第 3–40 章（39,255 字里的 36,357 字）落到 tab 外。
 *   独立整页打开时漏出的内容恰好排在 tab-a 后面，看起来完整；2026-08-22 起 ERP 改为「解析后只渲染
 *   #tab-<id> 的 innerHTML」，漏出部分就整段不显示了。源文件字节从未丢失，搬迁也是逐字节一致。
 *
 * 断言（按浏览器同款 HTML 解析规则 parse5 判定，不数标签）：
 *   D1 命理中心：人员导航 .pnav .pn 的每个 sw('<id>') 都有 #tab-<id>
 *   D2 命理中心：.container 的直接子元素只能是 .tc 人员 tab，且 tab 外无可见文字（= 无内容漏出 tab）
 *   D3 命理中心：.section 不得嵌套在另一个 .section 里（少闭合一个 </div> 的形态）
 *   D4 命理中心：每个 tab 的章节数、文字量不低于已知完整版基线（只许增不许减）
 *   A1 每份白名单资料：字节数不低于基线、<title> 锚点在、<h2> 数不低于基线
 *   A2 每份白名单资料：不得引用站内相对路径的子资源（src/href/action/url()/fetch/import）——
 *      端点只放行白名单里的 HTML 本身，任何相对引用线上都会 404/401
 *   A3 白名单（functions/_lib/privateAsset.mjs）里每个文件都在本守卫登记了基线（新增资料必须补基线）
 *   （打包内容与源文件逐字节一致由 test:private-asset P4 守；不进公开 dist 由 check:publish-dir / verify-admin-dist 守）
 *
 * 用法：node scripts/check-private-asset-integrity.mjs [--selftest]
 *   --selftest：对内存副本注入 9 种回归（含「两处 </div> 错误同时出现、计数配平」的原始形态），逐个必须检出；不写盘。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let parse;
try {
  ({ parse } = await import('parse5'));
} catch {
  console.error('✗ check:private-asset-integrity 需要 parse5（astro 依赖链自带）—— 先 npm ci --include=dev');
  process.exit(1);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EMBED_DIR = join(ROOT, 'admin/public/governance-assets/erp-embeds');
const LIB = join(ROOT, 'functions/_lib/privateAsset.mjs');
const DESTINY = 'partner-destiny-center.html';

/** 已知完整版基线（2026-09-30 修复后实测；内容增加可上调，禁止下调） */
const ASSET_BASELINE = {
  'partner-destiny-center.html': { minBytes: 529000, title: '命理全书', minH2: 200 },
  'shanhai-capital-architecture-sandbox.html': { minBytes: 123000, title: '资本架构沙盘', minH2: 20 },
  'shanhai-studio-startup-cost-model.html': { minBytes: 41000, title: '启动成本', minH2: 10 },
};

/** 命理中心每个人员 tab：章节（.section）数 / 解析后可见文字（去空白）下限 */
const DESTINY_TAB_BASELINE = {
  a: { sections: 40, text: 39000 }, // 独菽 · 40 章
  b: { sections: 12, text: 4400 },
  c: { sections: 14, text: 3700 },
  d: { sections: 13, text: 4600 },
  e: { sections: 12, text: 3800 },
  f: { sections: 13, text: 4400 },
  g: { sections: 13, text: 4500 },
  h: { sections: 12, text: 5000 },
  hcx: { sections: 13, text: 5700 },
  wh: { sections: 12, text: 5400 },
  lel: { sections: 12, text: 4300 },
  xt: { sections: 0, text: 24700 }, // 谢天全书为 Markdown 渲染，无 .section
  fam: { sections: 4, text: 2400 },
  z: { sections: 6, text: 2000 },
};

const attr = (n, k) => n.attrs?.find((a) => a.name === k)?.value;
const hasClass = (n, c) => (attr(n, 'class') || '').split(/\s+/).includes(c);
const isEl = (n) => Boolean(n.tagName);
function walk(n, f) {
  f(n);
  for (const c of n.childNodes || []) walk(c, f);
}
function find(n, pred) {
  let hit = null;
  walk(n, (m) => {
    if (!hit && isEl(m) && pred(m)) hit = m;
  });
  return hit;
}
const textOf = (n) => (n.nodeName === '#text' ? n.value : (n.childNodes || []).map(textOf).join(''));
const squash = (s) => s.replace(/\s+/g, '');

export function checkDestiny(html) {
  const errs = [];
  const doc = parse(html);
  const nav = find(doc, (n) => hasClass(n, 'pnav'));
  const ids = [];
  if (nav) walk(nav, (n) => {
    const m = isEl(n) && hasClass(n, 'pn') && /sw\(\s*['"]([^'"]+)['"]\s*\)/.exec(attr(n, 'onclick') || '');
    if (m) ids.push(m[1]);
  });
  if (!ids.length) errs.push('D1 未找到人员导航 .pnav .pn');

  const tabs = {};
  walk(doc, (n) => {
    const id = isEl(n) && attr(n, 'id');
    if (id && id.startsWith('tab-')) tabs[id.slice(4)] = n;
  });
  for (const id of ids) if (!tabs[id]) errs.push(`D1 导航 sw('${id}') 没有对应的 #tab-${id}`);
  for (const id of Object.keys(DESTINY_TAB_BASELINE)) {
    if (!ids.includes(id)) errs.push(`D1 基线人员 ${id} 不在导航里（人员被删？）`);
  }

  const container = find(doc, (n) => hasClass(n, 'container'));
  if (!container) errs.push('D2 未找到 .container');
  else {
    for (const c of container.childNodes) {
      const isTab = hasClass(c, 'tc') && (attr(c, 'id') || '').startsWith('tab-');
      const isTrailer = hasClass(c, 'footer') || c.tagName === 'script';
      if (isEl(c) && !isTab && !isTrailer) {
        const loc = squash(textOf(c)).slice(0, 24);
        errs.push(`D2 .container 下出现 tab 外元素 <${c.tagName} class="${attr(c, 'class') || ''}">「${loc}…」—— 某个 tab 被提前闭合，内容漏出（ERP 只渲染 tab 内部）`);
        break;
      }
      if (c.nodeName === '#text' && squash(c.value)) {
        errs.push(`D2 .container 下有 tab 外文字「${squash(c.value).slice(0, 24)}…」`);
        break;
      }
    }
    for (const [id, tab] of Object.entries(tabs)) {
      if (tab.parentNode !== container) errs.push(`D2 #tab-${id} 不是 .container 的直接子元素（上一个 tab 未闭合，被嵌进去了）`);
    }
  }

  const nested = [];
  walk(doc, (n) => {
    if (!isEl(n) || !hasClass(n, 'section')) return;
    for (let p = n.parentNode; p; p = p.parentNode) {
      if (isEl(p) && hasClass(p, 'section')) {
        nested.push(squash(textOf(find(n, (m) => hasClass(m, 'sn')) || n)).slice(0, 20));
        return;
      }
      if (isEl(p) && hasClass(p, 'tc')) return;
    }
  });
  if (nested.length) {
    errs.push(`D3 ${nested.length} 个章节嵌套在另一个 .section 里（前一章少一个 </div>）：${nested.slice(0, 5).join('、')}${nested.length > 5 ? '…' : ''}`);
  }

  for (const [id, base] of Object.entries(DESTINY_TAB_BASELINE)) {
    const tab = tabs[id];
    if (!tab) continue;
    let sections = 0;
    walk(tab, (n) => {
      if (isEl(n) && hasClass(n, 'section')) sections++;
    });
    const text = squash(textOf(tab)).length;
    if (sections < base.sections) errs.push(`D4 #tab-${id} 章节 ${sections} < 基线 ${base.sections}`);
    if (text < base.text) errs.push(`D4 #tab-${id} tab 内可见文字 ${text} 字 < 基线 ${base.text}（ERP 只渲染 tab 内部，少的就看不到）`);
  }
  return errs;
}

const ABSOLUTE_OK = /^(https?:|data:|blob:|#|mailto:|tel:|javascript:|about:)/i;
export function checkAsset(name, html) {
  const errs = [];
  const base = ASSET_BASELINE[name];
  if (!base) return [`A3 白名单资料 ${name} 未在本守卫登记基线（ASSET_BASELINE）`];
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes < base.minBytes) errs.push(`A1 ${name} ${bytes} 字节 < 完整版基线 ${base.minBytes}`);
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] || '';
  if (!title.includes(base.title)) errs.push(`A1 ${name} <title> 缺锚点「${base.title}」（实际「${title}」）`);
  const h2 = (html.match(/<h2\b/gi) || []).length;
  if (h2 < base.minH2) errs.push(`A1 ${name} <h2> ${h2} 个 < 基线 ${base.minH2}`);

  const refs = [];
  for (const m of html.matchAll(/\s(?:src|href|action|poster|data)\s*=\s*["']([^"']*)["']/gi)) refs.push(m[1]);
  for (const m of html.matchAll(/(?<![\w.$])url\(\s*["']?([^"')]+)["']?\s*\)/g)) refs.push(m[1]);
  for (const m of html.matchAll(/\b(?:fetch|import)\(\s*["'`]([^"'`]+)["'`]/g)) refs.push(m[1]);
  const bad = [...new Set(refs.map((r) => r.trim()).filter((r) => r && !ABSOLUTE_OK.test(r)))];
  if (bad.length) errs.push(`A2 ${name} 引用站内相对子资源（端点只放行 HTML 本身，线上必 404）：${bad.slice(0, 5).join('、')}`);
  return errs;
}

function whitelist() {
  const src = readFileSync(LIB, 'utf8');
  const body = /PRIVATE_ASSET_NAMES\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(src)?.[1] || '';
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function runAll(files) {
  const errs = [];
  const names = whitelist();
  if (!names.length) errs.push('A3 未能从 functions/_lib/privateAsset.mjs 读到 PRIVATE_ASSET_NAMES');
  for (const name of names) {
    if (!name.endsWith('.html')) continue;
    if (files[name] == null) {
      errs.push(`A3 白名单资料 ${name} 源文件缺失`);
      continue;
    }
    errs.push(...checkAsset(name, files[name]));
    if (name === DESTINY) errs.push(...checkDestiny(files[name]));
  }
  return errs;
}

function loadFiles() {
  const files = {};
  for (const name of Object.keys(ASSET_BASELINE)) {
    try {
      files[name] = readFileSync(join(EMBED_DIR, name), 'utf8');
    } catch {
      /* 缺失由 A3 报告 */
    }
  }
  return files;
}

function selftest() {
  const clean = loadFiles();
  const baseErrs = runAll(clean);
  if (baseErrs.length) {
    console.error('✗ 自检前提失败：当前源文件本身不通过\n  ' + baseErrs.join('\n  '));
    process.exit(1);
  }
  const d = clean[DESTINY];
  const TIP_END = '你终于"发光"了。</strong></p></div>\n';
  const CH20_END = '但永远到不了终点。</div>\n</div>\n';
  const must = (s, needle) => {
    if (!s.includes(needle)) throw new Error(`自检锚点不存在：${needle.slice(0, 30)}`);
    return s;
  };
  const strayClose = (s) => must(s, TIP_END).replace(TIP_END, TIP_END + '</div>\n');
  const dropCh20Close = (s) => must(s, CH20_END).replace(CH20_END, '但永远到不了终点。</div>\n');
  const cases = [
    ['第 2 章多一个 </div>（tab 提前闭合）', DESTINY, strayClose(d), /D2|D4/],
    ['第 20 章少一个 </div>（后续章节嵌套）', DESTINY, dropCh20Close(d), /D2|D3/],
    ['原始形态：两处同时出现、标签计数配平', DESTINY, dropCh20Close(strayClose(d)), /D2/],
    ['独菽只剩前 20 章', DESTINY, must(d, 'CHAPTER 21').replace(/<div class="section"><div class="sn">CHAPTER (2[1-9]|3\d|40)<\/div>[\s\S]*?(?=<div class="divider">|<\/div>\s*<!-- ══ 廉澍)/g, ''), /D4/],
    ['删掉一个人员 tab（家庭合盘）', DESTINY, must(d, 'id="tab-fam"').replace('id="tab-fam"', 'id="tab-fam-removed"'), /D1/],
    ['引用相对路径脚本', DESTINY, d.replace('</body>', '<script src="assets/chart.js"></script></body>'), /A2/],
    ['页面内 fetch 站内章节', DESTINY, d.replace('</body>', "<script>fetch('chapters/a.json')</script></body>"), /A2/],
    ['资本架构沙盘被截断一半', 'shanhai-capital-architecture-sandbox.html', clean['shanhai-capital-architecture-sandbox.html'].slice(0, 60000), /A1/],
    ['启动成本模型被换成别的页', 'shanhai-studio-startup-cost-model.html', clean['shanhai-studio-startup-cost-model.html'].replace(/<title>[^<]*<\/title>/, '<title>占位页</title>'), /A1/],
  ];
  let failed = 0;
  for (const [label, name, content, expect] of cases) {
    const errs = runAll({ ...clean, [name]: content });
    const ok = errs.some((e) => expect.test(e));
    console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? ` → ${errs[0].slice(0, 70)}` : ' —— 未检出'}`);
    if (!ok) failed++;
  }
  const benign = runAll({ ...clean, [DESTINY]: must(d, '<div class="hero">').replace('<div class="hero">', '<div class="hero"><a href="https://example.com/x">x</a><a href="#top">t</a>') });
  console.log(`${benign.length ? '  ✗' : '  ✓'} 不误报对照：绝对地址与页内锚点${benign.length ? ` —— 误报 ${benign[0]}` : ''}`);
  if (benign.length) failed++;
  if (failed) {
    console.error(`✗ check:private-asset-integrity 自检：${failed} 项未通过`);
    process.exit(1);
  }
  console.log(`✓ check:private-asset-integrity 自检：${cases.length} 个注入全部检出 + 1 个不误报对照`);
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  const errs = runAll(loadFiles());
  if (errs.length) {
    console.error('✗ check:private-asset-integrity：内部资料内容不完整\n  ' + errs.join('\n  '));
    process.exit(1);
  }
  console.log(`✓ check:private-asset-integrity：${Object.keys(ASSET_BASELINE).length} 份内部资料完整（命理中心 ${Object.keys(DESTINY_TAB_BASELINE).length} 个人员 tab 无内容漏出、章节与文字量不低于基线、无站内相对子资源）`);
}
