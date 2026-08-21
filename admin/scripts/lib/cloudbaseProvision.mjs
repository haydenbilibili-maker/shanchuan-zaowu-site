/**
 * CloudBase 集合 provision 共用逻辑（@cloudbase/manager-node）
 * 密钥仅从环境变量 / admin/.env 读取，勿写入本文件。
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

export const ENV_ID = 'cloud1-8gnkty5bfff9f0bf'

/** 读取 admin/.env（不覆盖已 export 的环境变量） */
export function loadDotEnv(adminDir) {
  const path = join(adminDir, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

export function printManual(repoRoot, name) {
  const rulePath = join(repoRoot, `cloudbase/rules/${name}.json`)
  let rule = '{}'
  try {
    rule = readFileSync(rulePath, 'utf8').trim()
  } catch {
    /* ignore */
  }
  console.log('\n—— 手动：', name, '——')
  console.log('1. 控制台新建集合', name)
  console.log('2. 自定义安全规则：')
  console.log(rule)
}

/**
 * @returns {{ status: 'created'|'existed'|'failed', rulesOk: boolean }}
 */
export async function provisionOne(database, permission, repoRoot, name) {
  const rulePath = join(repoRoot, `cloudbase/rules/${name}.json`)
  if (!existsSync(rulePath)) {
    console.error('缺少规则', rulePath)
    return { status: 'failed', rulesOk: false }
  }
  const securityRule = JSON.stringify(JSON.parse(readFileSync(rulePath, 'utf8')))

  let status = 'existed'
  try {
    const created = await database.createCollectionIfNotExists(name)
    if (created?.IsCreated) {
      status = 'created'
      console.log('✓ 已创建', name)
    } else {
      console.log('· 已存在', name)
    }
  } catch (e) {
    const msg = e.message || String(e)
    if (/exist|已存在|already/i.test(msg)) {
      console.log('· 已存在', name)
      status = 'existed'
    } else {
      console.warn('⚠ 创建失败', name, msg)
      printManual(repoRoot, name)
      return { status: 'failed', rulesOk: false }
    }
  }

  let rulesOk = false
  try {
    const res = await permission.modifyResourcePermission({
      resourceType: 'collection',
      resource: name,
      permission: 'CUSTOM',
      securityRule,
    })
    console.log('✓ 规则已部署', name, res?.RequestId || '')
    rulesOk = true
  } catch (e) {
    console.warn('⚠ 规则失败', name, e.message || e)
    printManual(repoRoot, name)
  }

  // 集合已就绪但规则失败 → 仍算部分成功；调用方可用 rulesOk 判断
  if (!rulesOk && status === 'failed') return { status: 'failed', rulesOk: false }
  if (!rulesOk) return { status, rulesOk: false }
  return { status, rulesOk: true }
}

export async function initManager({ secretId, secretKey, envId = ENV_ID }) {
  let CloudBase
  try {
    CloudBase = (await import('@cloudbase/manager-node')).default
  } catch {
    throw new Error('未安装 @cloudbase/manager-node。运行: cd admin && npm install')
  }
  return CloudBase.init({ secretId, secretKey, envId })
}
