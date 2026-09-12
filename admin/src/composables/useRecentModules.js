/**
 * 侧栏 / 命令面板共享的「最近常用」模块列表
 * - localStorage: sc_admin_recent_modules
 * - 去重、最近优先；仅写入 modulesRegistry 中的合法功能入口
 */
import { ref, computed } from 'vue'
import { MODULES_BY_ID } from '../utils/modulesRegistry'
import { resolveModuleOpen } from '../utils/moduleAliases'

export const RECENT_MODULES_KEY = 'sc_admin_recent_modules'
export const RECENT_CHANGED_EVENT = 'recent-changed'
/** 5–8 项上限；与命令面板既有行为对齐取 6 */
export const RECENT_MAX = 6

function loadRecentIds() {
  try {
    const raw = localStorage.getItem(RECENT_MODULES_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    const seen = new Set()
    const out = []
    for (const rawId of arr) {
      const id = resolveModuleOpen(String(rawId))
      if (!MODULES_BY_ID[id] || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  } catch {
    return []
  }
}

function persistRecentIds(ids) {
  try {
    localStorage.setItem(RECENT_MODULES_KEY, JSON.stringify(ids))
  } catch {
    /* ignore quota / private mode */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RECENT_CHANGED_EVENT))
  }
}

/** 单例，供侧栏与命令面板同步 */
const recentIds = ref(loadRecentIds())

function isRecordableModuleId(moduleId) {
  const id = resolveModuleOpen(moduleId)
  if (!id) return false
  if (id.startsWith('grp-') || id.startsWith('sub-')) return false
  return Boolean(MODULES_BY_ID[id])
}

export function useRecentModules() {
  const loadRecent = () => {
    recentIds.value = loadRecentIds()
  }

  const recordRecent = (moduleId) => {
    if (!isRecordableModuleId(moduleId)) return
    const id = resolveModuleOpen(moduleId)
    recentIds.value = [id, ...recentIds.value.filter((x) => x !== id)].slice(0, RECENT_MAX)
    persistRecentIds(recentIds.value)
  }

  const recentModules = computed(() =>
    recentIds.value.map((id) => MODULES_BY_ID[id]).filter(Boolean).slice(0, RECENT_MAX)
  )

  return {
    recentIds,
    recentModules,
    recordRecent,
    loadRecent,
  }
}
