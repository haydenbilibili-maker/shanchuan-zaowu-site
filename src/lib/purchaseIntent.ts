/**
 * 报价页 → 采购意向提交
 * 主路径：CloudBase 集合 purchase_intents（匿名登录写入）
 * 回退：同域 localStorage —— ⚠️ 这是**访客自己浏览器**的草稿，公司看不到它。
 *
 * 2026-09-17 全面审计 B3：原实现在云写失败时回退 localStorage 却仍返回 `ok:true`，
 * 前端于是显示「已提交，我们会尽快联系」—— 线索其实从未送达，用户也不会再联系。
 * 现在：回退分支返回 `ok:false` + `delivered:false`，由调用方**如实告知未送达**并让用户重试；
 * 本地草稿只作为「刷新后还能找回填写内容」的便利，绝不当作已提交。
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
  /** 线索是否**真的送达**公司（云库写入成功）。ok:true 必然 delivered:true。 */
  delivered?: boolean;
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
    return { ok: true, id: String(id), mode: 'cloudbase', delivered: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[purchaseIntent] CloudBase 写入失败，未送达；已在本机留一份草稿', message);
    // 本机草稿：只为「刷新后还能找回填写内容」，**不是**提交成功
    try {
      saveLocal(toRecord(payload, localId, 'local'));
    } catch {
      /* 草稿写不进去不影响结论：本来就没送达 */
    }
    return {
      ok: false,
      id: localId,
      mode: 'local',
      delivered: false,
      // 面向访客的话：说清「没收到」并给出下一步。技术原因只进 console，不甩给用户。
      error: '提交未送达：网络或服务暂时不可用，我们没有收到您的采购意向。'
        + '您的填写已保留在本页，可直接重试；若仍失败，请通过页面联系方式直接联系我们。',
    };
  }
}

