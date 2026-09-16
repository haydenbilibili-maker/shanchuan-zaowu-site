/**
 * 模块级深链的格式契约（审计 §0 P0-16）
 *
 * 约定：`#/m/<moduleId>` —— moduleId 既可能是数字 id（'42'）、
 * 也可能是 `nav-*` 域大屏 id（'nav-business'），因此字符集放宽到 [A-Za-z0-9_-] 但**不做贪婪匹配**。
 *
 * 为什么单独抽成模块：App.vue 里的这段逻辑只能在浏览器里验证，
 * 而「格式解析」是最容易写错、也最容易留下回归的部分 —— 抽出来就能单测。
 * 见 admin/scripts/test-module-hash.mjs。
 */
export const MODULE_HASH_PREFIX = '#/m/'

const MODULE_HASH_RE = /^#\/m\/([A-Za-z0-9_-]+)$/

/** 从 hash 解析模块 id；不是模块深链时返回 ''（#admin / #brand / 空 都返回 ''） */
export function parseModuleHash(hash) {
  const m = String(hash || '').match(MODULE_HASH_RE)
  return m ? m[1] : ''
}

/** 生成模块深链；id 为空返回 ''（调用方据此跳过写入） */
export function buildModuleHash(moduleId) {
  const id = String(moduleId ?? '').trim()
  return id ? `${MODULE_HASH_PREFIX}${id}` : ''
}
