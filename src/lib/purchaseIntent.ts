/**
 * 报价页 → 采购意向提交
 * 主路径：CloudBase 集合 purchase_intents（匿名登录写入）
 * 回退：同域 localStorage（本地演示 / 云库未建时）
 *
 * 线上需：CloudBase 匿名登录 + Web 安全域名 + 集合 purchase_intents + 规则
 * 见 cloudbase/rules/purchase_intents.json、docs/cloudbase-collections.md
 */

export const PURCHASE_INTENTS_COLLECTION = 'purchase_intents';
export const LOCAL_STORAGE_KEY = 'shanhai_purchase_intents_v1';

/** 与 admin/src/cloud.js 同一环境 */
const CLOUDBASE_ENV = 'cloud1-8gnkty5bfff9f0bf';
const CLOUDBASE_REGION = 'ap-shanghai';

export type PurchaseIntentStatus = 'pending' | 'contacted' | 'closed';

export interface PurchaseIntentItem {
  skuId: string;
  name: string;
  quantity: number;
  /** 供货价：单一价，或区间时的下限（估算） */
  price: number | null;
  priceMax?: number | null;
  priceLabel?: string;
  priceIsRange?: boolean;
  guidePrice?: number | null;
  guidePriceMax?: number | null;
  guidePriceLabel?: string;
}

export interface PurchaseIntentPayload {
  contactName: string;
  contactPhone: string;
  company?: string;
  note?: string;
  items: PurchaseIntentItem[];
}

export interface PurchaseIntentRecord extends PurchaseIntentPayload {
  _id: string;
  status: PurchaseIntentStatus;
  source: 'price-list';
  totalAmount: number | null;
  createdAt: number;
  createTime: number;
  persistedVia?: 'cloudbase' | 'local';
}

export interface SubmitResult {
  ok: boolean;
  id?: string;
  mode?: 'cloudbase' | 'local';
  error?: string;
}

function computeTotal(items: PurchaseIntentItem[]): number | null {
  let sum = 0;
  let hasPrice = false;
  for (const it of items) {
    if (typeof it.price === 'number' && Number.isFinite(it.price)) {
      sum += it.price * it.quantity;
      hasPrice = true;
    }
  }
  return hasPrice ? Math.round(sum * 100) / 100 : null;
}

function validate(payload: PurchaseIntentPayload): string | null {
  const name = String(payload.contactName || '').trim();
  const phone = String(payload.contactPhone || '').trim();
  if (!name) return '请填写联系人';
  if (!phone) return '请填写电话或微信';
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return '请至少选择 1 个商品';
  }
  for (const it of payload.items) {
    const q = Number(it.quantity);
    if (!it.skuId || !it.name || !Number.isFinite(q) || q < 1 || q > 9999) {
      return '商品数量无效';
    }
  }
  if (name.length > 40) return '联系人过长';
  if (phone.length > 60) return '联系方式过长';
  if (String(payload.company || '').length > 80) return '公司/店铺名过长';
  if (String(payload.note || '').length > 500) return '备注过长';
  return null;
}

function toRecord(payload: PurchaseIntentPayload, id: string, via: 'cloudbase' | 'local'): PurchaseIntentRecord {
  const now = Date.now();
  const items = payload.items.map((it) => ({
    skuId: String(it.skuId),
    name: String(it.name),
    quantity: Math.min(9999, Math.max(1, Math.floor(Number(it.quantity) || 1))),
    price: typeof it.price === 'number' ? it.price : null,
    priceMax: typeof it.priceMax === 'number' ? it.priceMax : null,
    priceLabel: it.priceLabel || undefined,
    priceIsRange: !!it.priceIsRange,
    guidePrice: typeof it.guidePrice === 'number' ? it.guidePrice : null,
    guidePriceMax: typeof it.guidePriceMax === 'number' ? it.guidePriceMax : null,
    guidePriceLabel: it.guidePriceLabel || undefined,
  }));
  return {
    _id: id,
    contactName: String(payload.contactName).trim(),
    contactPhone: String(payload.contactPhone).trim(),
    company: String(payload.company || '').trim() || undefined,
    note: String(payload.note || '').trim() || undefined,
    items,
    status: 'pending',
    source: 'price-list',
    totalAmount: computeTotal(items),
    createdAt: now,
    createTime: now,
    persistedVia: via,
  };
}

function readLocal(): PurchaseIntentRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeLocal(list: PurchaseIntentRecord[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list.slice(0, 200)));
}

function saveLocal(record: PurchaseIntentRecord) {
  const list = readLocal();
  list.unshift(record);
  writeLocal(list);
}

let appPromise: Promise<{ db: any }> | null = null;

async function getCloudDb(): Promise<{ db: any }> {
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
      return { db: app.database() };
    })();
  }
  return appPromise;
}

/** 官网报价页提交 */
export async function submitPurchaseIntent(payload: PurchaseIntentPayload): Promise<SubmitResult> {
  const err = validate(payload);
  if (err) return { ok: false, error: err };

  const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const { db } = await getCloudDb();
    const record = toRecord(payload, localId, 'cloudbase');
    const { _id: _omit, persistedVia: _p, ...doc } = record;
    const res = await db.collection(PURCHASE_INTENTS_COLLECTION).add({
      ...doc,
      createdAt: record.createdAt,
      createTime: record.createTime,
    });
    const id = res?.id || res?._id || localId;
    // 同域镜像，便于本地 admin 在云库未就绪时也能看到
    saveLocal({ ...record, _id: id, persistedVia: 'cloudbase' });
    return { ok: true, id: String(id), mode: 'cloudbase' };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[purchaseIntent] CloudBase 写入失败，回退 localStorage', message);
    try {
      const record = toRecord(payload, localId, 'local');
      saveLocal(record);
      return {
        ok: true,
        id: localId,
        mode: 'local',
        error: `云端暂不可用，已暂存在本机（${message.slice(0, 80)}）`,
      };
    } catch {
      return { ok: false, error: message || '提交失败，请稍后重试' };
    }
  }
}

/** 管理端合并读取本地镜像（同源 /admin 可访问） */
export function listLocalPurchaseIntents(): PurchaseIntentRecord[] {
  return readLocal().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
