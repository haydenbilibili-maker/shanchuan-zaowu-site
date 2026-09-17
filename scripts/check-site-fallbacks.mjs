#!/usr/bin/env node
/**
 * 官网转化链路「不得谎报送达」守卫
 *
 * 背景（2026-09-17 全面审计 B3，P0）：
 *   报价页提交采购意向时，若 CloudBase 写入失败，原实现回退到**访客自己浏览器**的
 *   localStorage，却仍返回 `ok: true` → 页面显示「已提交，我们会尽快联系」。
 *   结果：线索从未送达公司（ERP 读的是管理员自己的 localStorage，跨浏览器不可见），
 *   而访客以为已经提交，不会再联系 —— 这是**静默丢单**。
 *
 * 现约定：回退分支返回 `ok:false` + `delivered:false`，并由页面如实告知「未送达」。
 * 本守卫把这条不变式钉住：
 *   S1 `src/lib/purchaseIntent.ts` 不得出现「ok:true 与 mode:'local' 同处一个返回值」
 *   S2 回退分支必须显式声明 `delivered: false`（让「是否送达」成为显式事实，而不是靠 mode 猜）
 *   S3 官网文案不得承诺「本机暂存会同步到云端」（历史上那句是假的）
 *
 * 用法：
 *   node scripts/check-site-fallbacks.mjs
 *   node scripts/check-site-fallbacks.mjs --selftest
 * 退出码：违例为 1。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INTENT = join(ROOT, 'src', 'lib', 'purchaseIntent.ts');
const PRICE_PAGE = join(ROOT, 'src', 'pages', 'price-list.astro');

/** 历史上那句假承诺的形态 */
const FALSE_PROMISE = /本机暂存；云端就绪后|云端就绪后可同步/;

/**
 * 纯函数：检查采购意向库源码。
 * @param {string} src
 * @returns {string[]} 问题
 */
export function checkIntentSource(src) {
  const problems = [];
  // S1：同一个返回值里同时出现 ok:true 与 mode:'local' = 谎报送达
  const liar = /ok\s*:\s*true[^}]*mode\s*:\s*['"]local['"]/s;
  if (liar.test(src)) {
    problems.push(
      'src/lib/purchaseIntent.ts 的回退分支返回了 `ok: true` + `mode: \'local\'` —— '
      + '本机草稿不是送达，必须返回 ok:false + delivered:false（审计 B3）'
    );
  }
  // S2：送达与否必须是显式事实
  if (!/delivered\s*:\s*false/.test(src)) {
    problems.push('src/lib/purchaseIntent.ts 未在回退分支显式声明 `delivered: false` —— 「是否送达」不能靠 mode 猜');
  }
  if (!/delivered\s*:\s*true/.test(src)) {
    problems.push('src/lib/purchaseIntent.ts 未在成功分支显式声明 `delivered: true`');
  }
  return problems;
}

function scanRepo() {
  const problems = [];
  if (!existsSync(INTENT)) {
    problems.push(`找不到 ${INTENT}`);
  } else {
    problems.push(...checkIntentSource(readFileSync(INTENT, 'utf8')));
  }
  if (existsSync(PRICE_PAGE)) {
    const page = readFileSync(PRICE_PAGE, 'utf8');
    if (FALSE_PROMISE.test(page)) {
      problems.push('src/pages/price-list.astro 仍写着「本机暂存会同步到云端」—— 没有任何同步代码，这是假承诺');
    }
  }
  return problems;
}

function selftest() {
  let bad = 0;
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`); };

  const BAD = "try { add() } catch { return { ok: true, id, mode: 'local', error: '已暂存' } }";
  const HYBRID = "return { ok: false, delivered: false, mode: 'local' }\nreturn { ok: true, delivered: true, mode: 'cloudbase' }";

  t('★ 「ok:true + mode:local」必须被检出（审计 B3 的历史形态）',
    checkIntentSource(BAD).some((p) => /ok: true/.test(p)));
  t('★ 缺 delivered:false 必须被检出',
    checkIntentSource("return { ok: false, mode: 'local' }").some((p) => /delivered: false/.test(p)));
  t('★ 缺 delivered:true 必须被检出',
    checkIntentSource("return { ok: true, mode: 'cloudbase' }").some((p) => /delivered: true/.test(p)));
  t('  合规写法（显式 delivered 且回退不报成功）通过', checkIntentSource(HYBRID).length === 0);
  t('★ 假承诺文案必须被检出',
    FALSE_PROMISE.test('successNote.textContent = "已本机暂存；云端就绪后可同步"'));
  t('  真实文案不误报',
    !FALSE_PROMISE.test('successNote.textContent = "采购意向已进入后台清单"'));

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`);
    process.exit(1);
  }
  console.log('\n自检通过：谎报送达、缺 delivered、假承诺文案都会被抓，合规写法不误报');
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  const problems = scanRepo();
  if (problems.length) {
    console.error(`✗ 转化链路诚实性守卫失败 ${problems.length} 处：`);
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }
  console.log('✓ 转化链路诚实：回退分支不谎报送达（ok:false + delivered:false），官网无「会同步到云端」的假承诺');
}
