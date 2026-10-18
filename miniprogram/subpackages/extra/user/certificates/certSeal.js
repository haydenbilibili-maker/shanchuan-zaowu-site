/**
 * 证书火漆（2026-10-18 仪式感）：新签发、本机还没启封过的证书盖一枚火漆，点一下掰开再进证书。
 * 纯前端：只读证书 _id，本机记「启封过的 id」；不改云端字段。
 * 第一次进本页（本机还没有记录）时，把现有证书全部记为已启封 —— 老证书不该集体被封上。
 */
const KEY = 'cert_unsealed_ids';
const MAX = 400;

function readSeen(storage) {
  try {
    const raw = storage.getStorageSync(KEY);
    return Array.isArray(raw) ? raw : null;
  } catch (e) {
    return null;
  }
}

function writeSeen(storage, ids) {
  try {
    storage.setStorageSync(KEY, ids.slice(-MAX));
  } catch (e) { /* 存不下就下次再封，不影响查看 */ }
}

/** 给列表打 sealed 标记；首次（seen === null）全部视为已启封并落盘 */
function applySeals(list, storage) {
  const rows = Array.isArray(list) ? list : [];
  const seen = readSeen(storage);
  if (seen === null) {
    writeSeen(storage, rows.map((c) => c._id).filter(Boolean));
    return rows.map((c) => ({ ...c, sealed: false }));
  }
  const set = {};
  seen.forEach((id) => { set[id] = true; });
  return rows.map((c) => ({ ...c, sealed: !!(c._id && !set[c._id]) }));
}

/** 启封一张：记下 id（去重） */
function markUnsealed(id, storage) {
  if (!id) return;
  const seen = readSeen(storage) || [];
  if (seen.indexOf(id) >= 0) return;
  seen.push(id);
  writeSeen(storage, seen);
}

module.exports = { applySeals, markUnsealed, KEY };
