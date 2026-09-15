#!/usr/bin/env node
/**
 * 轻量冒烟：鉴权门禁 + 下单/支付相关云函数「可调用性」自检
 * 对应审计 P1-7。不替代真机支付联调。
 *
 * 用法：
 *   node scripts/smoke-auth-pay.js           # 仅静态检查
 *   node scripts/smoke-auth-pay.js --live    # 需 CLOUDBASE_* 或已登录 tcb CLI（可选）
 *
 * 环境：cloud1-8gnkty5bfff9f0bf
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_ID = 'cloud1-8gnkty5bfff9f0bf';

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg) {
  console.error(`  ✗ ${msg}`);
}
function warn(msg) {
  console.warn(`  ! ${msg}`);
}

function assertFileContains(rel, needles, label) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    fail(`${label}: 缺少 ${rel}`);
    return false;
  }
  const text = fs.readFileSync(full, 'utf8');
  for (const n of needles) {
    if (!text.includes(n)) {
      fail(`${label}: ${rel} 未包含「${n}」`);
      return false;
    }
  }
  ok(label);
  return true;
}

function assertNoClientAdmin888() {
  const p = path.join(ROOT, 'utils/managerAuth.js');
  const text = fs.readFileSync(p, 'utf8');
  if (/===\s*['"]admin888['"]/.test(text) || /return String\(input.*admin888/.test(text)) {
    fail('managerAuth 仍含客户端明文口令比对 admin888');
    return false;
  }
  if (!text.includes('verifyPasswordRemote')) {
    fail('managerAuth 缺少 verifyPasswordRemote');
    return false;
  }
  if (!text.includes('manager_auth_trust_v3')) {
    fail('managerAuth 信任态应为 manager_auth_trust_v3');
    return false;
  }
  ok('店长口令已下沉（trust v3，无明文比对）');
  return true;
}

function assertNoIdentifyClientWrites() {
  const p = path.join(ROOT, 'subpackages/feature/identify/result/index.js');
  const text = fs.readFileSync(p, 'utf8');
  if (/collection\(\s*['"]user_collection['"]\s*\)\s*\.add/.test(text)) {
    fail('鉴定结果页仍直写 user_collection');
    return false;
  }
  if (/collection\(\s*['"]identification_feedback['"]\s*\)\s*\.add/.test(text)) {
    fail('鉴定结果页仍直写 identification_feedback');
    return false;
  }
  if (!text.includes("action: 'save_atlas'") || !text.includes("action: 'submit_feedback'")) {
    fail('鉴定结果页未走 identifySpecimen save_atlas/submit_feedback');
    return false;
  }
  ok('鉴定写入已收口云函数');
  return true;
}

function assertIdentifyActions() {
  return assertFileContains(
    'cloudfunctions/identifySpecimen/index.js',
    ["action === 'save_atlas'", "action === 'submit_feedback'"],
    'identifySpecimen save_atlas/submit_feedback'
  );
}

/**
 * 支付回调鉴权回归（2026-09-15 事故防复发）
 * 事故根因：用「回调是否带 OPENID」判定客户端伪造 → 真实回调全被判为伪造并返回 SUCCESS，
 * 微信不再重试 ⇒ 订单不履约、充值不到账。门禁只能依据平台上下文 SOURCE。
 */
function assertPayCallbackGate() {
  const rel = 'cloudfunctions/payCallback/index.js';
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    fail(`${rel}: 文件缺失`);
    return false;
  }
  const text = fs.readFileSync(full, 'utf8');
  const gate = text.match(/function rejectClientForgery[\s\S]{0,1200}?\n}/);
  const body = gate ? gate[0] : '';
  if (!body) {
    fail('payCallback 缺少 rejectClientForgery（回调门禁）');
    return false;
  }
  if (/wxContext\.OPENID\s*\)/.test(body)) {
    fail('payCallback 门禁用 OPENID 判定（会误伤平台回调，见 2026-09-15 事故）');
    return false;
  }
  if (!body.includes('isClientSource')) {
    fail('payCallback 门禁缺少 SOURCE 客户端来源判定');
    return false;
  }
  if (!text.includes('payCallback context')) {
    fail('payCallback 缺少回调上下文日志（排障用）');
    return false;
  }
  ok('支付回调门禁正确（仅按 SOURCE 拒绝客户端直调）');
  return true;
}

/** 补单通道存在性：回调缺失时的人工恢复能力（履约 / 充值入账） */
function assertReconcileChannels() {
  const checks = [
    ['cloudfunctions/confirmPayment/index.js', ['isAdminOpsCall', 'adminFulfill']],
    ['cloudfunctions/manageStoredValue/index.js', ['reconcileRecharge']],
    ['cloudfunctions/managerShipOrder/index.js', ['fulfillPaidOrder']],
  ];
  let allOk = true;
  for (const [rel, needles] of checks) {
    if (!assertFileContains(rel, needles, `补单通道 ${rel}`)) allOk = false;
  }
  return allOk;
}

function assertRuleWriteFalse(name) {
  const p = path.join(ROOT, 'database-rules', `${name}.json`);
  if (!fs.existsSync(p)) {
    fail(`缺少规则 ${name}.json`);
    return false;
  }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (j.write !== false && j.write !== 'false') {
    fail(`${name} write 应为 false，实际 ${JSON.stringify(j.write)}`);
    return false;
  }
  ok(`规则 ${name}: write false`);
  return true;
}

function assertCloudFunctionExists(name) {
  const dir = path.join(ROOT, 'cloudfunctions', name);
  const has = fs.existsSync(path.join(dir, 'index.js'));
  if (!has) {
    fail(`云函数目录缺失: ${name}`);
    return false;
  }
  ok(`云函数存在: ${name}`);
  return true;
}

function assertStaffGuard(name) {
  const guard = path.join(ROOT, 'cloudfunctions', name, 'staffGuard.js');
  const index = path.join(ROOT, 'cloudfunctions', name, 'index.js');
  if (!fs.existsSync(guard) && !fs.readFileSync(index, 'utf8').includes('staffGuard')) {
    warn(`${name}: 未见 staffGuard（公开读或回调类可忽略）`);
    return true;
  }
  ok(`${name}: 含 staffGuard / 引用`);
  return true;
}

function main() {
  console.log(`\n[smoke-auth-pay] env=${ENV_ID} root=${ROOT}\n`);
  console.log('== 静态：鉴权 / 写闸门 ==');
  let failed = 0;
  const checks = [
    () => assertNoClientAdmin888(),
    () => assertFileContains('cloudfunctions/manageStaff/index.js', ['verifyUiGate', 'MANAGER_UI_PASSWORD'], 'manageStaff.verifyUiGate'),
    () => assertCloudFunctionExists('manageStoreContent'),
    () => assertStaffGuard('manageStoreContent'),
    () => assertStaffGuard('managerShipOrder'),
    () => assertStaffGuard('moderateComment'),
    () => assertStaffGuard('pushMessage'),
    () => assertStaffGuard('syncFinanceData'),
    () => assertCloudFunctionExists('makeOrder'),
    () => assertCloudFunctionExists('payOrder'),
    () => assertCloudFunctionExists('confirmPayment'),
    () => assertCloudFunctionExists('payCallback'),
    () => assertCloudFunctionExists('refundOrder'),
    () => assertIdentifyActions(),
    () => assertNoIdentifyClientWrites(),
    () => assertRuleWriteFalse('products'),
    () => assertRuleWriteFalse('orders'),
    () => assertRuleWriteFalse('identification_records'),
    () => assertRuleWriteFalse('identification_feedback'),
    () => assertRuleWriteFalse('user_collection'),
    () => assertPayCallbackGate(),
    () => assertReconcileChannels(),
  ];
  for (const fn of checks) {
    if (!fn()) failed += 1;
  }

  console.log('\n== 手工联调清单（真机） ==');
  console.log('  1. 工作台：输入 admin888（trust v3）；错误口令拒绝');
  console.log('  2. 商品详情 → 下单 → 支付（或沙箱）→ 订单列表可见');
  console.log('  3. 未登录/普通用户 callFunction managerShipOrder 应失败');
  console.log('  4. 客户端直写 products/orders/鉴定三表应被规则拒绝');
  console.log('  5. 鉴定结果：写入图鉴 / 纠错反馈经 identifySpecimen 成功');

  if (process.argv.includes('--live')) {
    console.log('\n== --live：尝试无登录 invoke（预期鉴权失败或需 OPENID）==');
    try {
      const { execSync } = require('child_process');
      const out = execSync(
        `tcb fn invoke identifySpecimen -e ${ENV_ID} --params '{"action":"save_atlas","record_id":"__smoke__"}'`,
        { encoding: 'utf8', timeout: 60000 }
      );
      console.log(out.slice(0, 500));
      warn('已 invoke；请人工看返回是否拒绝无主记录/无登录');
    } catch (e) {
      warn(`live invoke 未成功（可忽略）: ${(e && e.message) || e}`);
    }
  }

  console.log(failed ? `\n结果: FAIL (${failed})\n` : '\n结果: PASS（静态）\n');
  process.exit(failed ? 1 : 0);
}

main();
