/**
 * 共享模块再导出 —— 唯一实现在主包 utils/taxonomyZh.js（2026-09-17 全面审计 E2：去重复）
 *
 * 为什么保留这个同名文件：分包里已有大量 require 调用点（'./taxonomyZh' 或 '../utils/taxonomyZh'），
 * 保留同名 re-export 可以**零调用点改动**地完成下沉，同时把实现从分包移走（分包体积约 -3729 B）。
 * 改实现请只改 utils/taxonomyZh.js；不要在这里加逻辑。
 */
module.exports = require('../../../utils/taxonomyZh')
