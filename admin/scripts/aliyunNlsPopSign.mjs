/**
 * 阿里云 POP 签名（CreateToken）— 仅用于开发服务器 / 预览服务器，不向浏览器暴露 Secret。
 * 文档：https://help.aliyun.com/zh/isi/getting-started/use-http-or-https-to-obtain-an-access-token
 */
import crypto from 'node:crypto'

export function percentEncode(s) {
  if (s == null || s === '') return ''
  return encodeURIComponent(String(s))
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')
}

/**
 * 返回「不含 Signature」的规范化查询串（已按 key 排序并编码）。
 */
export function buildCanonicalQueryWithoutSignature(params) {
  const keys = Object.keys(params).sort()
  return keys.map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&')
}

export function signCreateTokenRequest(accessKeyId, accessKeySecret) {
  const params = {
    AccessKeyId: accessKeyId,
    Action: 'CreateToken',
    Format: 'JSON',
    RegionId: 'cn-shanghai',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z/, 'Z'),
    Version: '2019-02-28',
  }
  const canonicalized = buildCanonicalQueryWithoutSignature(params)
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalized)}`
  const rawSig = crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64')
  const signature = percentEncode(rawSig)
  return `Signature=${signature}&${canonicalized}`
}

export async function fetchNlsToken(accessKeyId, accessKeySecret) {
  const query = signCreateTokenRequest(accessKeyId, accessKeySecret)
  const url = `https://nls-meta.cn-shanghai.aliyuncs.com/?${query}`
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`CreateToken 响应非 JSON: ${text.slice(0, 200)}`)
  }
  if (!res.ok || json.ErrMsg || !json.Token?.Id) {
    const msg = json.Message || json.ErrMsg || json.Code || text.slice(0, 200)
    throw new Error(`CreateToken 失败: ${msg}`)
  }
  return {
    id: json.Token.Id,
    expireTime: json.Token.ExpireTime,
  }
}
