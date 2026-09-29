// 馆藏 tab 首屏 SWR 缓存（「全部」无筛选第一页 + 分类树），只存渲染字段；价格/库存以后台刷新为准。
// wx storage 单 key 上限 1MB：按 JSON 长度 ×3（全 CJK 估字节）超过 MAX_BYTES 就不写。
const { peekCache, setCache } = require('./cache');

const FEED_KEY = 'CATEGORY_FEED_FIRST';
const TREE_KEY = 'CATEGORY_TREE_PICKER';
const VERSION = 1;
const MAX_BYTES = 256 * 1024;
const EXPIRY = 5 * 60 * 1000;
const STALE_MS = 7 * 24 * 3600 * 1000;
const PRODUCT_KEYS = ['_id', 'cardType', 'title', 'themeName', 'latinName', 'price', 'displayImage', 'category',
  'channel', 'craftType', 'craftProcess', 'stock', 'soldOut', 'isUnique', 'isOneOfAKind', 'isTreasure',
  'protectionType', 'sensitiveBlur'];
const CONTENT_KEYS = ['_id', 'cardType', 'title', 'latinName', 'brief', 'coverImage', 'type', 'typeLabel',
  'relatedProductIds', 'hasCommerce', 'productId', 'commerceLabel', 'isAlternative'];
const CATEGORY_KEYS = ['_id', 'name', 'enName', 'sort', 'sortOrder', 'alias', 'subtitle', 'commonName'];

const pick = (o, keys) => keys.reduce((out, k) => {
  if (o && o[k] !== undefined) out[k] = o[k];
  return out;
}, {});

function save(key, entry) {
  let len = Infinity;
  try { len = JSON.stringify(entry).length; } catch (e) { /* 不可序列化 → 不写 */ }
  return len * 3 <= MAX_BYTES && setCache(key, entry, EXPIRY);
}

function read(key) {
  const hit = peekCache(key, { staleMs: STALE_MS });
  return hit && hit.data && hit.data.v === VERSION ? { data: hit.data, fresh: hit.fresh } : null;
}

function firstScreenParams(archiveOn) {
  return {
    categoryId: null, rootCategoryId: null, subCategoryId: null, parentCategory: '', subCategoryName: '',
    keyword: '', channel: '', craftType: '', craftProcess: '', priceMin: null, priceMax: null,
    contentSkip: 0, contentLimit: archiveOn ? 3 : 0, productSkip: 0, productLimit: 12
  };
}

function isFirstScreenRequest(data) {
  const base = firstScreenParams(!!(data && data.contentLimit));
  return !!data && Object.keys(base).every((k) => data[k] === base[k] || (base[k] === null && data[k] == null));
}

function writeFeed(archiveOn, r) {
  if (!r || !r.success) return false;
  return save(FEED_KEY, {
    v: VERSION,
    archiveOn: !!archiveOn,
    contentItems: (r.contentItems || []).map((c) => pick(c, CONTENT_KEYS)),
    orphanProducts: (r.orphanProducts || []).map((p) => pick(p, PRODUCT_KEYS)),
    contentTotal: r.contentTotal || 0,
    orphanTotal: r.orphanTotal || 0,
    hasMoreContent: !!r.hasMoreContent,
    hasMoreProducts: !!r.hasMoreProducts
  });
}

function readFeed(archiveOn) {
  const hit = read(FEED_KEY);
  return hit && hit.data.archiveOn === !!archiveOn && Array.isArray(hit.data.orphanProducts) ? hit : null;
}

function writeTree(tree) {
  if (!tree || !Array.isArray(tree.categoryRoots) || !tree.categoryRoots.length) return false;
  const subMap = {};
  Object.keys(tree.categorySubMap || {}).forEach((rid) => {
    subMap[rid] = (tree.categorySubMap[rid] || []).map((s) => pick(s, CATEGORY_KEYS));
  });
  return save(TREE_KEY, { v: VERSION, categoryRoots: tree.categoryRoots.map((c) => pick(c, CATEGORY_KEYS)), categorySubMap: subMap });
}

function readTree() {
  const hit = read(TREE_KEY);
  return hit && Array.isArray(hit.data.categoryRoots) && hit.data.categoryRoots.length ? hit : null;
}

/** 分类树：云函数优先，失败走客户端分页直读（与馆藏页原逻辑一致），成功即落缓存 */
async function fetchTree(db) {
  let tree = null;
  try {
    const res = await wx.cloud.callFunction({ name: 'listCategories', data: { canonicalOnly: true } });
    if (res && res.result && res.result.success) tree = res.result;
  } catch (e) { /* 走兜底 */ }
  if (!tree) tree = await require('./categoryTree').loadCategoryPickerTree(db || wx.cloud.database());
  writeTree(tree);
  return tree;
}

let prefetching = false;
/** 首页空闲预取：缓存新鲜就跳过；最多 1 次馆藏请求 + 1 次分类树 */
function prefetchFirstScreen() {
  if (prefetching) return Promise.resolve(false);
  let archiveOn = false;
  try {
    const c = require('./contentDisplayFlags').getCachedContentDisplayFlags();
    archiveOn = !!(c && c.flags && c.flags.showSpecimenArchive === true);
  } catch (e) { /* 默认关 */ }
  const feedHit = readFeed(archiveOn);
  const treeHit = readTree();
  const jobs = [];
  if (!(feedHit && feedHit.fresh)) {
    jobs.push(wx.cloud.callFunction({ name: 'getEncyclopediaFeed', data: firstScreenParams(archiveOn) })
      .then((res) => writeFeed(archiveOn, res && res.result)));
  }
  if (!(treeHit && treeHit.fresh)) jobs.push(fetchTree());
  if (!jobs.length) return Promise.resolve(false);
  prefetching = true;
  return Promise.all(jobs.map((j) => j.catch(() => false))).then(() => { prefetching = false; return true; });
}

module.exports = {
  FEED_KEY, TREE_KEY, VERSION, MAX_BYTES, PRODUCT_KEYS, CATEGORY_KEYS,
  firstScreenParams, isFirstScreenRequest, writeFeed, readFeed, writeTree, readTree, fetchTree, prefetchFirstScreen
};
