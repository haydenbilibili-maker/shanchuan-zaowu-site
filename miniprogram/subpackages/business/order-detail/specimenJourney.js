/**
 * 标本旅程（2026-10-18，产品负责人点名「标本旅程 / 签收入藏卡」，只做展示层）
 * 快递面单下的四站时间轴：入册 → 启程 → 在途 → 抵达。
 * 纯前端派生：只读订单已有的 createTime / logistics.shipTime / logistics.carrier / receiveTime / status，
 * 不改云函数、不改状态机。真实中转站点以承运商轨迹为准（「查询物流轨迹」按钮不动）。
 */
function fmt(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}.${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 只给快递单的已发货 / 已签收两态；其它状态返回 [] → 整块不出现 */
function buildJourney(order) {
  const o = order || {};
  const status = o.status;
  if (status !== 'shipped' && status !== 'received') return [];
  const lg = o.logistics || {};
  const carrier = String(lg.carrier || '').trim();
  const arrived = status === 'received';
  return [
    { key: 'order', cn: '入册', en: 'LOGGED', sub: '订单建档', time: fmt(o.createTime), state: 'done' },
    { key: 'ship', cn: '启程', en: 'DEPARTED', sub: carrier && carrier !== '等待揽收' ? `交 ${carrier} 承运` : '已交承运', time: fmt(lg.shipTime), state: 'done' },
    { key: 'transit', cn: '在途', en: 'IN TRANSIT', sub: arrived ? '一路平安' : '途经站点以承运商轨迹为准', time: '', state: arrived ? 'done' : 'now' },
    { key: 'arrive', cn: '抵达', en: 'ARRIVED', sub: arrived ? '已签收入藏' : '待你签收', time: arrived ? fmt(o.receiveTime) : '', state: arrived ? 'done' : 'todo' }
  ];
}

module.exports = { buildJourney };
