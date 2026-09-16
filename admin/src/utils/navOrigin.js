/**
 * 记录「从哪个导航大屏进入功能页」，用于返回 Hub。
 */
import { ref } from 'vue'
import { MODULE_TO_NAV_DOMAIN, getNavDomain } from '../config/adminNavDomains.js'

const STORAGE_KEY = 'sc_admin_nav_origin'
const originByModule = ref(loadMap())

function loadMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(originByModule.value))
  } catch {
    /* ignore */
  }
}

export function setNavOrigin(moduleId, domainId) {
  const mid = String(moduleId || '')
  const did = String(domainId || '')
  if (!mid || !did) return
  originByModule.value = { ...originByModule.value, [mid]: did }
  persist()
}

export function getNavOrigin(moduleId) {
  const mid = String(moduleId || '')
  const stored = originByModule.value[mid]
  if (stored && getNavDomain(stored)) return stored
  // 深链/书签：按模块所属域回推
  return MODULE_TO_NAV_DOMAIN[mid] || null
}

export function clearNavOrigin(moduleId) {
  const mid = String(moduleId || '')
  if (!mid || !originByModule.value[mid]) return
  const next = { ...originByModule.value }
  delete next[mid]
  originByModule.value = next
  persist()
}

export function useNavOrigin() {
  return {
    originByModule,
    setNavOrigin,
    getNavOrigin,
    clearNavOrigin,
  }
}
