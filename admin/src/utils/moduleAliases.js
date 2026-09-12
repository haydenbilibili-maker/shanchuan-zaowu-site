/**
 * 模块合并别名：旧侧栏/命令面板 id → 合并后的 Hub + 分区。
 * 打开别名 id 时统一落到主入口，避免能力丢失。
 */
import { reactive } from 'vue'

/** @type {Record<string, { hub: string, section: string }>} */
export const MODULE_ALIASES = {
  // 门店中心 ← 店铺管理(30)
  '55': { hub: '30', section: 'front' },
  '34': { hub: '30', section: 'design' },
  '64': { hub: '30', section: 'staff' },

  // 权益营销 ← 权益与营销(6)
  '20': { hub: '6', section: 'rules' },
  '66': { hub: '6', section: 'welcome' },
  '15': { hub: '6', section: 'points' },
  '68': { hub: '6', section: 'wallet' },
  '70': { hub: '6', section: 'gift' },
  '22': { hub: '6', section: 'achievement' },

  // 会员经营 ← 会员 CRM(4)
  '45': { hub: '4', section: 'insights' },
  '46': { hub: '4', section: 'audience' },
  '47': { hub: '4', section: 'cohort' },
  '14': { hub: '4', section: 'levels' },
  '69': { hub: '4', section: 'adjust' },
  '63': { hub: '4', section: 'honorary' },

  // 首页运营 ← 首页配置(13)
  '8': { hub: '13', section: 'banner' },
  '62': { hub: '13', section: 'flags' },

  // 行为洞察 ← 行为看板(44)
  '23': { hub: '44', section: 'config' },

  // 预约中心 ← 预约与核销(37)
  '16': { hub: '37', section: 'rules' },

  // 监控大屏 ← 实时监控(26)
  '49': { hub: '26', section: 'business' },
}

/** hubId → 当前分区（命令面板/别名跳转时写入） */
export const hubSections = reactive({})

export function setHubSection(hubId, section) {
  if (!hubId || !section) return
  hubSections[String(hubId)] = String(section)
}

/** 将任意模块 id 解析为主入口 id，并设置分区 */
export function resolveModuleOpen(moduleId) {
  const id = String(moduleId || '')
  const alias = MODULE_ALIASES[id]
  if (alias) {
    setHubSection(alias.hub, alias.section)
    return alias.hub
  }
  return id
}

export function isAliasedModule(moduleId) {
  return Boolean(MODULE_ALIASES[String(moduleId || '')])
}
