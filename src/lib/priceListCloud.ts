/**
 * 官网 /price-list · 从 CloudBase price_list_items 拉取上架条目
 * 失败或空列表时由页面回退静态种子（SSR）
 */
import {
  formatPriceAmount,
  isPriceRange,
  priceLowerBound,
  priceUpperBound,
  type BioFilter,
  type PackagingFilter,
  type PrepMethod,
  type PriceAmount,
  type PriceListItem,
} from '../data/priceList';

export const PRICE_LIST_ITEMS_COLLECTION = 'price_list_items';

/** 与 admin/src/cloud.js、purchaseIntent 同一环境 */
const CLOUDBASE_ENV = 'cloud1-8gnkty5bfff9f0bf';
const CLOUDBASE_REGION = 'ap-shanghai';
/** 相对路径在 Admin 或其它域打开时回退到此官网源 */
export const PRICE_LIST_SITE_ORIGIN = 'https://shanhaizaowu.com';

export type CloudPriceListItem = PriceListItem & {
  skuId?: string;
  sort?: number;
  status?: string;
};

let appPromise: Promise<{ db: any; app: any }> | null = null;

async function getCloudApp(): Promise<{ db: any; app: any }> {
  if (!appPromise) {
    appPromise = (async () => {
      const cloudbase = (await import('@cloudbase/js-sdk')).default;
      const app = cloudbase.init({
        env: CLOUDBASE_ENV,
        region: CLOUDBASE_REGION,
        persistence: 'local',
      });
      const auth = app.auth();
      try {
        const state = await auth.getLoginState();
        if (!state && typeof auth.signInAnonymously === 'function') {
          await auth.signInAnonymously();
        }
      } catch {
        if (typeof auth.signInAnonymously === 'function') {
          await auth.signInAnonymously();
        }
      }
      return { db: app.database(), app };
    })();
  }
  return appPromise;
}

/** 相对路径 → 绝对 URL（优先当前站点 origin，否则官网） */
export function toPublicImageUrl(url: string, siteOrigin = PRICE_LIST_SITE_ORIGIN): string {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u) || u.startsWith('cloud://') || u.startsWith('blob:') || u.startsWith('data:')) {
    return u;
  }
  if (u.startsWith('//')) return `https:${u}`;
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : String(siteOrigin || PRICE_LIST_SITE_ORIGIN).replace(/\/$/, '');
  // 本地 Astro :4321 时相对路径可用；Admin 预览请用绝对官网 URL（同步时已写死）
  const base = origin.includes('localhost') || origin.includes('127.0.0.1')
    ? origin
    : origin.includes('shanhaizaowu')
      ? origin
      : String(siteOrigin || PRICE_LIST_SITE_ORIGIN).replace(/\/$/, '');
  if (u.startsWith('/')) return `${base.replace(/\/$/, '')}${u}`;
  return `${base.replace(/\/$/, '')}/${u}`;
}

async function resolveCloudFileUrls(urls: string[]): Promise<Map<string, string>> {
  const cloudIds = urls.filter((u) => u.startsWith('cloud://'));
  const map = new Map<string, string>();
  if (!cloudIds.length) return map;
  try {
    const { app } = await getCloudApp();
    const res = await app.getTempFileURL({ fileList: cloudIds });
    for (const f of res?.fileList || []) {
      if (f?.fileID && f?.tempFileURL) map.set(f.fileID, f.tempFileURL);
    }
  } catch (e) {
    console.warn('[priceListCloud] getTempFileURL 失败', e);
  }
  return map;
}

/** 把 image/images 解析为浏览器可加载的 http(s) URL */
export async function resolveItemImageUrls(item: CloudPriceListItem): Promise<CloudPriceListItem> {
  const rawGallery =
    item.images && item.images.length ? item.images : item.image ? [item.image] : [];
  const expanded = rawGallery.map((u) => toPublicImageUrl(u)).filter(Boolean);
  const cloudMap = await resolveCloudFileUrls(expanded.filter((u) => u.startsWith('cloud://')));
  const gallery = expanded.map((u) => (u.startsWith('cloud://') ? cloudMap.get(u) || '' : u)).filter(Boolean);
  return {
    ...item,
    image: gallery[0] || undefined,
    images: gallery.length ? gallery : undefined,
  };
}

function normalizePrice(raw: unknown): PriceAmount | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'object' && raw !== null && 'min' in raw && 'max' in raw) {
    const min = Number((raw as { min: unknown }).min);
    const max = Number((raw as { max: unknown }).max);
    if (Number.isFinite(min) && Number.isFinite(max)) return { min, max };
  }
  return null;
}

export function normalizeCloudItem(doc: Record<string, unknown>): CloudPriceListItem | null {
  const skuId = String(doc.skuId || doc.id || '').trim();
  const name = String(doc.name || '').trim();
  if (!skuId || !name) return null;
  const images = Array.isArray(doc.images)
    ? (doc.images as unknown[]).map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  const image = String(doc.image || images[0] || '').trim() || undefined;
  return {
    id: skuId,
    skuId,
    name,
    species: String(doc.species || name),
    prepMethod: (String(doc.prepMethod || '其他') as PrepMethod) || '其他',
    packaging: String(doc.packaging || ''),
    packagingFilter: String(doc.packagingFilter || '其它标本') as PackagingFilter,
    bioFilter: String(doc.bioFilter || '蝴蝶') as BioFilter,
    price: normalizePrice(doc.price),
    guidePrice: normalizePrice(doc.guidePrice),
    specs: String(doc.specs || ''),
    note: String(doc.note || '') || undefined,
    image,
    images: images.length ? images : image ? [image] : undefined,
    imageAlt: String(doc.imageAlt || name),
    sort: Number(doc.sort) || 0,
    status: String(doc.status || 'active'),
  };
}

export type FetchPriceListResult = {
  items: CloudPriceListItem[];
  source: 'cloud' | 'empty' | 'error';
  error?: string;
};

/** 拉取上架报价；按 sort 升序；图片 URL 已解析为可加载地址 */
export async function fetchPublishedPriceList(): Promise<FetchPriceListResult> {
  try {
    const { db } = await getCloudApp();
    const res = await db
      .collection(PRICE_LIST_ITEMS_COLLECTION)
      .where({ status: 'active' })
      .limit(200)
      .get();
    const raw = (res?.data || []) as Record<string, unknown>[];
    const normalized = raw
      .map(normalizeCloudItem)
      .filter((x): x is CloudPriceListItem => !!x)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.id.localeCompare(b.id));
    if (!normalized.length) return { items: [], source: 'empty' };
    const items = await Promise.all(normalized.map(resolveItemImageUrls));
    return { items, source: 'cloud' };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[priceListCloud] 拉取失败，保留静态种子', message);
    return { items: [], source: 'error', error: message };
  }
}

export function resolveGallery(item: PriceListItem): string[] {
  if (item.images && item.images.length > 0) return item.images;
  if (item.image) return [item.image];
  return [];
}

export function enrichForDom(item: PriceListItem) {
  const gallery = resolveGallery(item);
  const guide = item.guidePrice ?? null;
  return {
    ...item,
    priceLabel: formatPriceAmount(item.price),
    guidePriceLabel: formatPriceAmount(guide),
    priceIsRange: isPriceRange(item.price),
    guideIsRange: isPriceRange(guide),
    priceMin: priceLowerBound(item.price),
    priceMax: priceUpperBound(item.price),
    guideMin: priceLowerBound(guide),
    guideMax: priceUpperBound(guide),
    gallery,
    cover: gallery[0] || '',
    imageCount: gallery.length,
  };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attr(v: string | number | null | undefined) {
  if (v === null || v === undefined) return '';
  return escapeHtml(String(v));
}

/** 桌面表行 HTML（与 price-list.astro SSR 结构对齐） */
export function renderDesktopRowHtml(item: ReturnType<typeof enrichForDom>): string {
  const zoomBtn = item.cover
    ? `<button type="button" class="price-zoom-trigger relative block h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass-bright/70" data-price-zoom data-zoom-src="${attr(item.cover)}" data-zoom-images="${attr(JSON.stringify(item.gallery))}" data-zoom-index="0" data-zoom-alt="${attr(item.imageAlt || item.name)}" aria-label="查看大图：${attr(item.imageAlt || item.name)}"><img src="${attr(item.cover)}" alt="" class="pointer-events-none h-full w-full object-cover select-none" loading="lazy" decoding="async" draggable="false" data-price-thumb />${
        item.imageCount > 1
          ? `<span class="price-zoom-badge absolute bottom-0.5 right-0.5 min-w-[1.1rem] px-1 py-px text-[10px] leading-tight tabular-nums text-cream bg-ink-deep/80 border border-brass-mid/40" aria-hidden="true">${item.imageCount}</span>`
          : ''
      }</button>`
    : `<span class="price-thumb-oos" aria-label="暂时无货"><span class="price-thumb-oos__text" aria-hidden="true">暂时<br />无货</span></span>`;

  return `<tr class="price-list-row border-b border-brass-mid/15 last:border-b-0 align-middle" data-packaging="${attr(item.packagingFilter)}" data-bio="${attr(item.bioFilter)}" data-sku-id="${attr(item.id)}" data-sku-name="${attr(item.name)}" data-sku-price-min="${attr(item.priceMin ?? '')}" data-sku-price-max="${attr(item.priceMax ?? '')}" data-sku-price-label="${attr(item.priceLabel)}" data-sku-price-range="${item.priceIsRange ? '1' : ''}" data-sku-guide-min="${attr(item.guideMin ?? '')}" data-sku-guide-max="${attr(item.guideMax ?? '')}" data-sku-guide-label="${attr(item.guidePriceLabel)}">
    <td class="px-2 py-3"><input type="checkbox" class="price-sku-check accent-[var(--color-brass-mid)] h-4 w-4 cursor-pointer" data-sku-check aria-label="选择 ${attr(item.name)}" /></td>
    <td class="px-2 py-3"><input type="number" min="1" max="9999" value="1" disabled data-sku-qty class="price-sku-qty w-14 mx-auto block rounded-none border border-brass-mid/25 bg-ink-deep/40 px-1 py-1 text-center text-sm text-cream tabular-nums disabled:opacity-40" aria-label="${attr(item.name)} 数量" /></td>
    <td class="px-2 py-3"><div class="mx-auto w-[64px] aspect-square border border-brass-mid/30 bg-ink-deep/40 overflow-hidden flex items-center justify-center">${zoomBtn}</div></td>
    <td class="px-3 py-3 font-serif text-cream tracking-cn text-sm md:text-base text-left whitespace-nowrap">${escapeHtml(item.name)}</td>
    <td class="px-2 py-3 text-sm text-text-soft tracking-cn whitespace-nowrap">${escapeHtml(item.species)}</td>
    <td class="px-2 py-3 text-sm text-text-soft tracking-cn whitespace-nowrap">${escapeHtml(item.prepMethod)}</td>
    <td class="px-2 py-3 text-sm text-text-soft tracking-cn whitespace-nowrap">${escapeHtml(item.packaging)}</td>
    <td class="px-2 py-3 font-serif text-brass-bright text-lg tracking-cn tabular-nums whitespace-nowrap">${escapeHtml(item.priceLabel)}</td>
    <td class="px-2 py-3 font-serif text-cream/90 text-base tracking-cn tabular-nums whitespace-nowrap">${escapeHtml(item.guidePriceLabel)}</td>
    <td class="px-3 py-3 text-sm text-text-soft tracking-cn leading-relaxed text-left">${escapeHtml(item.specs)}</td>
    <td class="px-2 py-3 text-sm text-text-dim tracking-cn leading-relaxed">${escapeHtml(item.note || '—')}</td>
  </tr>`;
}

/** 移动端条目 HTML */
export function renderMobileRowHtml(item: ReturnType<typeof enrichForDom>): string {
  const zoomBtn = item.cover
    ? `<button type="button" class="price-zoom-trigger relative block h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass-bright/70" data-price-zoom data-zoom-src="${attr(item.cover)}" data-zoom-images="${attr(JSON.stringify(item.gallery))}" data-zoom-index="0" data-zoom-alt="${attr(item.imageAlt || item.name)}" aria-label="查看大图：${attr(item.imageAlt || item.name)}"><img src="${attr(item.cover)}" alt="" class="pointer-events-none h-full w-full object-cover select-none" loading="lazy" decoding="async" draggable="false" data-price-thumb />${
        item.imageCount > 1
          ? `<span class="price-zoom-badge absolute bottom-0.5 right-0.5 min-w-[1.1rem] px-1 py-px text-[10px] leading-tight tabular-nums text-cream bg-ink-deep/80 border border-brass-mid/40" aria-hidden="true">${item.imageCount}</span>`
          : ''
      }</button>`
    : `<span class="price-thumb-oos" aria-label="暂时无货"><span class="price-thumb-oos__text" aria-hidden="true">暂时<br />无货</span></span>`;

  return `<li class="price-list-row border-b border-brass-mid/15 py-6" data-packaging="${attr(item.packagingFilter)}" data-bio="${attr(item.bioFilter)}" data-sku-id="${attr(item.id)}" data-sku-name="${attr(item.name)}" data-sku-price-min="${attr(item.priceMin ?? '')}" data-sku-price-max="${attr(item.priceMax ?? '')}" data-sku-price-label="${attr(item.priceLabel)}" data-sku-price-range="${item.priceIsRange ? '1' : ''}" data-sku-guide-min="${attr(item.guideMin ?? '')}" data-sku-guide-max="${attr(item.guideMax ?? '')}" data-sku-guide-label="${attr(item.guidePriceLabel)}">
    <div class="mb-3 flex items-center justify-between gap-3">
      <label class="flex items-center gap-2 text-sm text-text-soft tracking-cn cursor-pointer"><input type="checkbox" class="price-sku-check accent-[var(--color-brass-mid)] h-4 w-4" data-sku-check aria-label="选择 ${attr(item.name)}" />加入采购篮</label>
      <input type="number" min="1" max="9999" value="1" disabled data-sku-qty class="price-sku-qty w-16 rounded-none border border-brass-mid/25 bg-ink-deep/40 px-1 py-1 text-center text-sm text-cream tabular-nums disabled:opacity-40" aria-label="${attr(item.name)} 数量" />
    </div>
    <div class="grid grid-cols-[88px_1fr] gap-4">
      <div class="aspect-square border border-brass-mid/30 bg-ink-deep/40 overflow-hidden flex items-center justify-center">${zoomBtn}</div>
      <div>
        <h3 class="font-serif text-cream text-lg tracking-cn mb-1">${escapeHtml(item.name)}</h3>
        <p class="text-xs text-text-dim tracking-cn mb-2">物种 ${escapeHtml(item.species)} · 制作 ${escapeHtml(item.prepMethod)} · 包装 ${escapeHtml(item.packaging)}</p>
        <p class="font-serif text-brass-bright tabular-nums mb-1">供货 ${escapeHtml(item.priceLabel)} <span class="text-cream/80">指导 ${escapeHtml(item.guidePriceLabel)}</span></p>
        <p class="text-sm text-text-soft tracking-cn leading-relaxed">${escapeHtml(item.specs)}</p>
        ${item.note ? `<p class="text-xs text-text-dim tracking-cn mt-2">备注：${escapeHtml(item.note)}</p>` : ''}
      </div>
    </div>
  </li>`;
}

/** 用云端清单替换桌面 tbody + 移动 ul，并刷新计数 */
export function applyPriceListToDom(items: PriceListItem[]) {
  const root = document.querySelector('[data-price-list]');
  if (!root) return;
  const enriched = items.map(enrichForDom);
  const tbody = root.querySelector('tbody');
  const mobile = root.querySelector('[data-price-mobile-list]');
  if (tbody) tbody.innerHTML = enriched.map(renderDesktopRowHtml).join('');
  if (mobile) mobile.innerHTML = enriched.map(renderMobileRowHtml).join('');
  const countEl = root.querySelector<HTMLElement>('[data-price-count]');
  if (countEl) countEl.textContent = `显示 ${enriched.length} / ${enriched.length} 款`;
  root.setAttribute('data-price-source', 'cloud');
  document.dispatchEvent(new CustomEvent('price-list:hydrated', { detail: { count: enriched.length } }));
}
