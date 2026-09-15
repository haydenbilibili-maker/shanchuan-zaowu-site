/**
 * SKU / 商品装裱尺寸：录入规范化与 C 端展示文案
 * sku 字段：sizeL / sizeW / sizeH / sizeText / size
 *
 * 装裱方式 craftType（相框/玻璃罩等陈列形态）→ 尺寸录入（单位 cm）：
 * - frame 相框：长 / 宽 / 厚度 → L / W / H(厚度)
 * - cloche_round 圆形玻璃罩：仅直径 → L=直径，W/H 空
 * - cloche_cylinder 圆柱形玻璃罩：直径 / 高度 → L=直径，H=高度，W 空
 * - cloche 方形玻璃罩：长 / 宽 / 高 → L / W / H
 * 其它 craftType 默认按方罩（长×宽×高）
 */

const NBSP = '\u00a0';

/** @typedef {'frame'|'diameter'|'diameter_height'|'box'} SizeFormMode */

const SIZE_FORM_META = {
  frame: {
    mode: 'frame',
    label: '长 × 宽 × 厚度',
    hint: '相框：长 / 宽 / 厚度（cm）'
  },
  diameter: {
    mode: 'diameter',
    label: '直径',
    hint: '圆形玻璃罩：仅填直径（cm）'
  },
  diameter_height: {
    mode: 'diameter_height',
    label: '直径 × 高度',
    hint: '圆柱形玻璃罩：直径 / 高度（cm）'
  },
  box: {
    mode: 'box',
    label: '长 × 宽 × 高',
    hint: '方形玻璃罩：长 / 宽 / 高（cm）'
  }
};

function isBlank(value) {
  return !String(value == null ? '' : value).trim();
}

/** 空尺寸或 0x0x0 / 0×0×0 cm 等视为未著录 */
function isEmptySizeValue(size) {
  if (isBlank(size)) return true;
  const normalized = String(size)
    .trim()
    .replace(/\s+/g, '')
    .replace(/[×✕✖*]/g, 'x')
    .replace(/厘米/gi, '')
    .replace(/cm$/i, '');
  return /^(0+(?:\.0+)?)(?:x(?:0+(?:\.0+)?))+$/i.test(normalized);
}

function parseSizeParts(sizeStr) {
  let sizeL = '';
  let sizeW = '';
  let sizeH = '';
  if (isBlank(sizeStr)) return { sizeL, sizeW, sizeH };
  const clean = String(sizeStr)
    .replace(/厘米/gi, '')
    .replace(/cm/gi, '')
    .replace(/直径/g, '')
    .replace(/高度/g, '')
    .replace(/厚度/g, '')
    .trim();
  const parts = clean.split(/[xX×✕✖*]/).map((p) => String(p || '').trim()).filter(Boolean);
  if (parts.length === 1) {
    sizeL = parts[0];
  } else if (parts.length >= 2) {
    sizeL = parts[0] || '';
    sizeW = parts[1] || '';
    if (parts.length >= 3) sizeH = parts[2] || '';
  }
  return { sizeL, sizeW, sizeH };
}

/**
 * 根据装裱方式 + 标题/规格等线索，决定尺寸录入形态。
 * craftType 与 config/productTaxonomy 装裱方式对齐。
 */
function resolveSizeFormMode(craftType, hintText) {
  const craft = String(craftType || '')
    .trim()
    .toLowerCase();
  const hint = String(hintText || '');

  if (craft === 'cloche_round') return 'diameter';
  if (craft === 'cloche_cylinder') return 'diameter_height';
  if (craft === 'frame') return 'frame';
  if (craft === 'cloche') return 'box';

  // 文案线索（规格名 / 标题）——优先于其它默认
  if (/圆柱形?\s*玻璃罩|圆柱罩|圆筒罩/.test(hint)) return 'diameter_height';
  if (/圆形\s*玻璃罩|圆罩|半球(?:形)?(?:玻璃)?罩|圆顶罩/.test(hint)) return 'diameter';
  if (/方形\s*玻璃罩|方罩/.test(hint)) return 'box';
  if (/相框|画框|标本框/.test(hint)) return 'frame';

  return 'box';
}

function getSizeFormMeta(mode) {
  return SIZE_FORM_META[mode] || SIZE_FORM_META.box;
}

/** 按形态清空不适用的分量 */
function applySizeFormConstraints(sizeL, sizeW, sizeH, mode) {
  let L = String(sizeL || '').trim();
  let W = String(sizeW || '').trim();
  let H = String(sizeH || '').trim();
  if (mode === 'diameter') {
    // 仅直径；若旧数据误把直径写在 W/H，尽量回收到 L
    if (!L && W && !H) {
      L = W;
    }
    W = '';
    H = '';
  } else if (mode === 'diameter_height') {
    // 直径×高度：若旧数据为 L×W 两段且无 H，把 W 视作高度
    if (L && W && !H) {
      H = W;
    }
    W = '';
  }
  return { sizeL: L, sizeW: W, sizeH: H };
}

function formatSizeFromParts(sizeL, sizeW, sizeH, mode) {
  const constrained = applySizeFormConstraints(sizeL, sizeW, sizeH, mode || 'box');
  const L = constrained.sizeL;
  const W = constrained.sizeW;
  const H = constrained.sizeH;
  const formMode = mode || 'box';

  if (formMode === 'diameter') {
    if (!L) return '';
    return `直径 ${L}${NBSP}厘米`;
  }
  if (formMode === 'diameter_height') {
    if (L && H) return `直径 ${L}×高度 ${H}${NBSP}厘米`;
    if (L) return `直径 ${L}${NBSP}厘米`;
    if (H) return `高度 ${H}${NBSP}厘米`;
    return '';
  }
  if (formMode === 'frame') {
    const parts = [];
    if (L) parts.push(L);
    if (W) parts.push(W);
    if (H) parts.push(H);
    if (!parts.length) return '';
    if (L && W && H) return `${L}×${W}×厚度 ${H}${NBSP}厘米`;
    if (L && W) return `${L}×${W}${NBSP}厘米`;
    return `${parts.join('×')}${NBSP}厘米`;
  }

  // box 方形玻璃罩 / 默认
  const parts = [];
  if (L) parts.push(L);
  if (W) parts.push(W);
  if (H) parts.push(H);
  if (!parts.length) return '';
  return `${parts.join('×')}${NBSP}厘米`;
}

function formatSizeCanonical(sizeL, sizeW, sizeH) {
  const L = String(sizeL || '').trim();
  const W = String(sizeW || '').trim();
  const H = String(sizeH || '').trim();
  if (!L && !W && !H) return '';
  const parts = [];
  if (L) parts.push(L);
  if (W) parts.push(W);
  if (H) parts.push(H);
  if (!parts.length) return '';
  return `${parts.join('x')} cm`;
}

function beautifySizeString(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s
    .replace(/[xX×✕✖*]/g, '×')
    .replace(/\s*×\s*/g, '×')
    .replace(/\s*cm\b/gi, `${NBSP}厘米`)
    .replace(/\s*厘米/g, `${NBSP}厘米`)
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function getSkuSizeFields(sku) {
  if (!sku || typeof sku !== 'object') {
    return { sizeL: '', sizeW: '', sizeH: '', sizeText: '', size: '' };
  }
  let sizeL = String(sku.sizeL != null ? sku.sizeL : '').trim();
  let sizeW = String(sku.sizeW != null ? sku.sizeW : '').trim();
  let sizeH = String(sku.sizeH != null ? sku.sizeH : '').trim();
  const sizeText = String(sku.sizeText || '').trim();
  let size = String(sku.size || '').trim();
  if (!sizeL && !sizeW && !sizeH && size) {
    const parsed = parseSizeParts(size);
    sizeL = parsed.sizeL;
    sizeW = parsed.sizeW;
    sizeH = parsed.sizeH;
  }
  return { sizeL, sizeW, sizeH, sizeText, size };
}

/**
 * 单规格展示文案：优先 sizeText，其次按包装形态格式化 L/W/H，再次 size
 * @param {object} sku
 * @param {{ craftType?: string, hintText?: string }} [ctx]
 */
function formatSkuSizeDisplay(sku, ctx) {
  const f = getSkuSizeFields(sku);
  if (f.sizeText) return beautifySizeString(f.sizeText);
  const hint = [
    (ctx && ctx.hintText) || '',
    (sku && sku.specLabel) || '',
    f.sizeText
  ].join(' ');
  const mode = resolveSizeFormMode((ctx && ctx.craftType) || '', hint);
  const fromParts = formatSizeFromParts(f.sizeL, f.sizeW, f.sizeH, mode);
  if (fromParts) return fromParts;
  if (f.size && !isEmptySizeValue(f.size)) return beautifySizeString(f.size);
  return '';
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 旧数据兼容：从商品描述中按规格名抽取尺寸片段
 * 例：描述「展翅玻璃罩尺寸20*20厘米 闭翅玻璃罩尺寸10*10厘米」+ 规格「展翅」
 */
function extractSkuSizeFromDescription(description, specLabel) {
  const desc = String(description || '');
  const label = String(specLabel || '').trim();
  if (!desc || !label) return '';
  const esc = escapeRegExp(label);
  const re = new RegExp(
    `${esc}[^\\n]*?尺寸\\s*[：:.]?\\s*[\\d.]+\\s*[x×*]\\s*[\\d.]+(?:\\s*[x×*]\\s*[\\d.]+)?\\s*(?:厘米|cm)?`,
    'i'
  );
  const m = desc.match(re);
  if (m) return beautifySizeString(m[0]);
  return '';
}

/**
 * 解析当前应展示的尺寸（选中 SKU → 描述抽取 → 商品级 size）
 */
function resolveDisplaySize(product, sku) {
  const craftType = (product && product.craftType) || '';
  const title = (product && product.title) || '';
  const fromSku = formatSkuSizeDisplay(sku, {
    craftType,
    hintText: `${title} ${(sku && sku.specLabel) || ''}`
  });
  if (fromSku) return fromSku;
  if (sku && sku.specLabel) {
    const fromDesc = extractSkuSizeFromDescription(
      product && product.description,
      sku.specLabel
    );
    if (fromDesc) return fromDesc;
  }
  if (product && (product.sizeL || product.sizeW || product.sizeH || product.size)) {
    const mode = resolveSizeFormMode(
      craftType,
      `${title} ${product.sizeText || ''}`
    );
    const fields = getSkuSizeFields(product);
    const fromProductParts = formatSizeFromParts(
      fields.sizeL,
      fields.sizeW,
      fields.sizeH,
      mode
    );
    if (fromProductParts) return fromProductParts;
  }
  if (product && product.size && !isEmptySizeValue(product.size)) {
    return beautifySizeString(product.size);
  }
  return '';
}

/** 多规格尺寸被堆在一段描述里的段落（应隐藏，改按规格展示） */
function isMultiSkuSizeDumpParagraph(text, skuLabels) {
  const t = String(text || '').trim();
  if (!t) return false;
  const sizeCount = (t.match(/尺寸/g) || []).length;
  if (sizeCount >= 2) return true;
  const labels = (skuLabels || [])
    .map((l) => String(l || '').trim())
    .filter(Boolean);
  if (labels.length >= 2 && /尺寸|厘米|\dcm\b/i.test(t)) {
    const hits = labels.filter((l) => t.includes(l));
    if (hits.length >= 2) return true;
  }
  return false;
}

function filterMultiSkuSizeDumpText(description, skuLabels) {
  const raw = String(description || '');
  if (!raw || !(skuLabels || []).length) return raw;

  const stripSizeChunks = (text) =>
    String(text || '')
      .replace(
        /[\u4e00-\u9fffA-Za-z0-9]{0,24}尺寸\s*[：:.]?\s*[\d.]+\s*[x×*]\s*[\d.]+(?:\s*[x×*]\s*[\d.]+)?\s*(?:厘米|cm)?/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();

  const lines = raw.split(/\n+/);
  if (lines.length > 1) {
    const kept = lines
      .map((line) => {
        if (!isMultiSkuSizeDumpParagraph(line, skuLabels)) return line.trim();
        return stripSizeChunks(line);
      })
      .filter(Boolean);
    return kept.join('\n').trim();
  }

  if (isMultiSkuSizeDumpParagraph(raw, skuLabels)) {
    return stripSizeChunks(raw);
  }
  return raw;
}

/**
 * 录入端 / 保存：规范化 SKU 尺寸字段
 * @param {object} s
 * @param {{ craftType?: string, hintText?: string, mode?: SizeFormMode }} [opts]
 */
function normalizeSkuSizeForSave(s, opts) {
  const sizeText = String((s && s.sizeText) || '').trim().slice(0, 120);
  let sizeL = String((s && s.sizeL) != null ? s.sizeL : '').trim().slice(0, 16);
  let sizeW = String((s && s.sizeW) != null ? s.sizeW : '').trim().slice(0, 16);
  let sizeH = String((s && s.sizeH) != null ? s.sizeH : '').trim().slice(0, 16);
  let size = String((s && s.size) || '').trim().slice(0, 64);
  if (!sizeL && !sizeW && !sizeH && size) {
    const parsed = parseSizeParts(size);
    sizeL = parsed.sizeL.slice(0, 16);
    sizeW = parsed.sizeW.slice(0, 16);
    sizeH = parsed.sizeH.slice(0, 16);
  }

  const mode =
    (opts && opts.mode) ||
    resolveSizeFormMode(
      (opts && opts.craftType) || '',
      `${(opts && opts.hintText) || ''} ${sizeText} ${(s && s.specLabel) || ''}`
    );

  const constrained = applySizeFormConstraints(sizeL, sizeW, sizeH, mode);
  sizeL = constrained.sizeL.slice(0, 16);
  sizeW = constrained.sizeW.slice(0, 16);
  sizeH = constrained.sizeH.slice(0, 16);

  size = formatSizeCanonical(sizeL, sizeW, sizeH);
  if (isEmptySizeValue(size)) size = '';
  return { sizeL, sizeW, sizeH, sizeText, size, sizeFormMode: mode };
}

module.exports = {
  SIZE_FORM_META,
  isEmptySizeValue,
  parseSizeParts,
  resolveSizeFormMode,
  getSizeFormMeta,
  applySizeFormConstraints,
  formatSizeFromParts,
  formatSizeCanonical,
  beautifySizeString,
  getSkuSizeFields,
  formatSkuSizeDisplay,
  extractSkuSizeFromDescription,
  resolveDisplaySize,
  isMultiSkuSizeDumpParagraph,
  filterMultiSkuSizeDumpText,
  normalizeSkuSizeForSave
};
