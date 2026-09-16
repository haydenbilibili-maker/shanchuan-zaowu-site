/**
 * 门店积分 — 前端展示文案兜底
 *
 * 只放展示用文案与选项，不参与任何金额/积分计算。
 * 计算与规则一律由云函数 getStorePointRules / grantStorePoints 负责，
 * 避免出现 config/shipping.js 那种前后端双份口径漂移。
 */
const RULE_TEXT_FALLBACK = '门店消费每满 ¥1，赠送 1 积分与 1 成长值';

/**
 * 规则结构化兜底（与云函数 getPointRecords/defaults 默认口径一致）
 * C 端据此把「线上订单」与「门店消费」两条规则分别讲清楚——二者同源同规则。
 */
const STORE_RULE_FALLBACK = {
  mode: 'perThreshold',
  threshold: 1,
  thresholdText: '1',
  pointsPerThreshold: 1,
  ratio: 1,
  ratioPercent: 10,
  minAmount: 1,
  minAmountText: '1',
  roundMode: 'floor',
  revokeWindowDays: 30
};

/**
 * 生成通用赠分句式（线上与门店共用同一句式，仅前置场景词不同）
 * @param {object} [rule] 云端 storeRule，缺省用兜底
 * @returns {string} 如「每满 ¥1 赠 1 积分与 1 成长值」
 */
function buildEarnRuleText(rule) {
  const r = rule && typeof rule === 'object' ? rule : STORE_RULE_FALLBACK;
  const threshold = r.thresholdText != null ? r.thresholdText : STORE_RULE_FALLBACK.thresholdText;
  const points = r.pointsPerThreshold != null ? r.pointsPerThreshold : STORE_RULE_FALLBACK.pointsPerThreshold;
  if (r.mode === 'ratio') {
    const min = r.minAmountText != null ? r.minAmountText : STORE_RULE_FALLBACK.minAmountText;
    const pct = r.ratioPercent != null ? r.ratioPercent : STORE_RULE_FALLBACK.ratioPercent;
    return `单笔满 ¥${min} 后，按消费额 ${pct}% 赠积分与成长值`;
  }
  if (r.mode === 'fixed') {
    return `单笔满 ¥${threshold} 赠 ${points} 积分与 ${points} 成长值`;
  }
  return `每满 ¥${threshold} 赠 ${points} 积分与 ${points} 成长值`;
}

/** 兑换说明兜底（具体档位以 rewards 云库为准，需运营配置） */
const EXCHANGE_RULE_TEXT = '100 积分可兑换价值 ¥10 的线上礼券';

const MODE_OPTIONS = [
  { value: 'perThreshold', label: '每满即送', desc: '每满 X 元送 Y 分，可累计多次' },
  { value: 'fixed', label: '满额一次', desc: '单笔满 X 元送 Y 分，只送一次' },
  { value: 'ratio', label: '按比例', desc: '过门槛后按消费额比例赠送' }
];

const MODULE_OPTIONS = [
  { key: 'storePurchase', label: '门店消费赠分' },
  { key: 'review', label: '评价奖励' },
  { key: 'checkIn', label: '每日签到' },
  { key: 'browse', label: '鉴赏藏品' },
  { key: 'orderBind', label: '外部订单绑定' },
  { key: 'receiptClaim', label: '门店小票兑积分' }
];

const REVOKE_REASONS = [
  { value: 'refund', label: '门店退货' },
  { value: 'wrong_amount', label: '金额录错' },
  { value: 'wrong_user', label: '顾客录错' },
  { value: 'abuse', label: '异常发放' },
  { value: 'other', label: '其他调整' }
];

const IDENTIFY_METHOD_TEXT = {
  scan_member_code: '扫会员码',
  phone_search: '手机号查找',
  receipt_upload: '小票上传',
  pos_import: 'POS 导入',
  platform_order: '外部订单绑定',
  coupon_redeem: '礼券核销联动'
};

const PURCHASE_STATUS_TEXT = {
  granted: '已赠分',
  partial_revoked: '部分撤销',
  revoked: '已撤销',
  // 受众差异（有意保留）：员工端称审批人为「店长」，C 端统一称「专员」（2026-09-16 口径）
  pending_approval: '待店长审核',
  pending_claim: '待认领',
  rejected: '已驳回'
};

const ORDER_BIND_STATUS_TEXT = {
  pending: '待审核',
  approved: '已入账',
  rejected: '已驳回'
};

const RECEIPT_CLAIM_STATUS_TEXT = {
  pending: '待审核',
  approved: '已入账',
  rejected: '已驳回',
  ignored: '已忽略'
};

const POINT_TYPE_TEXT = {
  earn: '获得',
  spend: '消耗',
  revoke: '扣回',
  adjust: '调整'
};

// 门店消费同步赠积分与成长值；金额向下取整到整数元（roundMode=floor）
const STORE_POINTS_NOTICE = '门店消费每满 ¥1 赠 1 积分与 1 成长值（不足 1 元向下取整）；100 积分可兑换价值 ¥10 的线上礼券。';

const EXCHANGE_CONFIRM_HINT = '兑换后积分立即扣除，礼券将放入我的礼券夹。';

module.exports = {
  RULE_TEXT_FALLBACK,
  STORE_RULE_FALLBACK,
  buildEarnRuleText,
  EXCHANGE_RULE_TEXT,
  MODE_OPTIONS,
  MODULE_OPTIONS,
  REVOKE_REASONS,
  IDENTIFY_METHOD_TEXT,
  PURCHASE_STATUS_TEXT,
  ORDER_BIND_STATUS_TEXT,
  RECEIPT_CLAIM_STATUS_TEXT,
  POINT_TYPE_TEXT,
  STORE_POINTS_NOTICE,
  EXCHANGE_CONFIRM_HINT
};
