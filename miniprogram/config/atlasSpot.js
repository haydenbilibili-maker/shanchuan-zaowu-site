/** 图鉴印记码解析（主包轻量副本；完整目录见 subpackages/feature/config/atlasCatalog.js） */
function parseSpotCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  let m = s.match(/ATLAS[:/_-]?([a-z0-9]+)/i);
  if (m) return m[1].toLowerCase();
  m = s.match(/[?&]spot=([a-z0-9]+)/i);
  if (m) return m[1].toLowerCase();
  m = s.match(/^a[_-]?([a-z0-9]+)$/i);
  if (m) return m[1].toLowerCase();
  if (/^s[1-9]\d*$/i.test(s)) return s.toLowerCase();
  return '';
}

module.exports = { parseSpotCode };
