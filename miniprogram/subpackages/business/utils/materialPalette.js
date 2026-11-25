/**
 * 材质色板（画布用）—— miniprogram/docs/材质规范_纸与金属_2026-11-25.md
 *
 * canvas 读不到 WXSS 的 --mat-* 令牌，所以这里抄一份**同值**常量给画布绘制（证书等）用。
 * 取值必须与 app.wxss 的同名令牌逐字相同：check:materials M7 会逐枚比对，改令牌时两处一起改。
 */
module.exports = {
  PAPER_TONE: '#F3ECDD', // --mat-paper-tone
  PAPER_TONE_DEEP: '#E8DFCB', // --mat-paper-tone-deep
  INK: '#2E2618', // --mat-ink
  INK_BODY: '#4A3E28', // --mat-ink-body
  INK_SOFT: '#6B5A3E', // --mat-ink-soft
  INK_LABEL: '#8A6F45', // --mat-ink-label
  PAPER_FRAME: 'rgba(138, 111, 69, 0.3)', // --mat-paper-frame
  BRASS_PIN: '#B08D57', // --mat-brass-pin
  SEAL: '#8E3B2E' // --mat-seal
}
