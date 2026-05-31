/**
 * 多标签页管理
 * - 维护当前打开的标签数组（每项一个 module id）
 * - 持久化 localStorage：sc_admin_open_tabs / sc_admin_tab_active
 * - 提供 open / close / closeOthers / closeAll / pin / unpin / reorder API
 *
 * 与 modulesRegistry / App.vue 配合使用
 */
import { ref, watch } from 'vue'
import { MODULES_BY_ID } from '../utils/modulesRegistry'

const TABS_KEY = 'sc_admin_open_tabs'
const ACTIVE_KEY = 'sc_admin_tab_active'
const MAX_TABS = 12  // 软上限，超过会提示

// 单例 state（多个组件共享）
const openTabs = ref(loadTabs())
const activeTabId = ref(loadActive())

function loadTabs() {
  try {
    const raw = localStorage.getItem(TABS_KEY)
    if (!raw) return ['0'] // 默认开"经营驾驶舱"
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr) || !arr.length) return ['0']
    return arr.filter(t => t && MODULES_BY_ID[t.id || t]).map(t => typeof t === 'string' ? { id: t, pinned: false } : t)
  } catch (e) { return [{ id: '0', pinned: false }] }
}
function loadActive() {
  try {
    const v = localStorage.getItem(ACTIVE_KEY)
    if (v && MODULES_BY_ID[v]) return v
  } catch (e) {}
  return '0'
}
function persistTabs() {
  try { localStorage.setItem(TABS_KEY, JSON.stringify(openTabs.value)) } catch (e) {}
}
function persistActive() {
  try { localStorage.setItem(ACTIVE_KEY, activeTabId.value) } catch (e) {}
}

// 初始化：兼容旧 string 数组数据
if (openTabs.value.length && typeof openTabs.value[0] === 'string') {
  openTabs.value = openTabs.value.map(id => ({ id, pinned: false }))
}

watch(openTabs, persistTabs, { deep: true })
watch(activeTabId, persistActive)

export function useTabsManager() {
  /** 打开（或激活）一个 tab */
  const openTab = (moduleId) => {
    if (!MODULES_BY_ID[moduleId]) return
    const exists = openTabs.value.find(t => t.id === moduleId)
    if (!exists) {
      if (openTabs.value.length >= MAX_TABS) {
        // 关掉最旧的未固定标签
        const oldestUnpinned = openTabs.value.find(t => !t.pinned && t.id !== activeTabId.value)
        if (oldestUnpinned) {
          openTabs.value = openTabs.value.filter(t => t.id !== oldestUnpinned.id)
        }
      }
      openTabs.value = [...openTabs.value, { id: moduleId, pinned: false }]
    }
    activeTabId.value = moduleId
  }

  /** 关闭一个 tab */
  const closeTab = (moduleId) => {
    const tab = openTabs.value.find(t => t.id === moduleId)
    if (!tab || tab.pinned) return false
    const idx = openTabs.value.findIndex(t => t.id === moduleId)
    openTabs.value = openTabs.value.filter(t => t.id !== moduleId)
    if (!openTabs.value.length) {
      openTabs.value = [{ id: '0', pinned: false }]
      activeTabId.value = '0'
      return true
    }
    if (activeTabId.value === moduleId) {
      // 激活相邻 tab
      const next = openTabs.value[Math.min(idx, openTabs.value.length - 1)]
      activeTabId.value = next.id
    }
    return true
  }

  /** 关闭其它（保留当前 + pinned） */
  const closeOthers = (keepId) => {
    const k = keepId || activeTabId.value
    openTabs.value = openTabs.value.filter(t => t.id === k || t.pinned)
    activeTabId.value = k
  }

  /** 关闭全部（保留 pinned） */
  const closeAll = () => {
    const pinned = openTabs.value.filter(t => t.pinned)
    if (pinned.length) {
      openTabs.value = pinned
      activeTabId.value = pinned[0].id
    } else {
      openTabs.value = [{ id: '0', pinned: false }]
      activeTabId.value = '0'
    }
  }

  /** 固定/取消固定 */
  const togglePin = (moduleId) => {
    const tab = openTabs.value.find(t => t.id === moduleId)
    if (tab) {
      tab.pinned = !tab.pinned
      // 固定的排在最前
      openTabs.value = [
        ...openTabs.value.filter(t => t.pinned),
        ...openTabs.value.filter(t => !t.pinned)
      ]
    }
  }

  /** 在两个 tab 之间插入排序 */
  const reorder = (fromId, toId) => {
    const from = openTabs.value.findIndex(t => t.id === fromId)
    const to = openTabs.value.findIndex(t => t.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const arr = [...openTabs.value]
    const [item] = arr.splice(from, 1)
    arr.splice(to, 0, item)
    openTabs.value = arr
  }

  /** 激活下一个/上一个（用于快捷键） */
  const cycleTab = (dir = 1) => {
    const idx = openTabs.value.findIndex(t => t.id === activeTabId.value)
    if (idx < 0) return
    const next = (idx + dir + openTabs.value.length) % openTabs.value.length
    activeTabId.value = openTabs.value[next].id
  }

  return {
    openTabs,
    activeTabId,
    openTab,
    closeTab,
    closeOthers,
    closeAll,
    togglePin,
    reorder,
    cycleTab
  }
}
