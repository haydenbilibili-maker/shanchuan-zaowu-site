import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import { ElMessage } from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import { migrateFinanceRecordsFromLegacy } from './utils/financeLocalStorageKey.js'

migrateFinanceRecordsFromLegacy()
import './styles/design-tokens.css'
import './styles/vi-enterprise-modules.css'
import './styles/content-factory-vi.css'
import './styles/erp-vi-actions.css'
import './styles/global-refinement.css'
import './styles/mobile-responsive.css'
import './styles/mobile-app-redesign.css'
import './styles/mobile-app-redesign-fix.css'
import './styles/mobile-comprehensive.css'

const app = createApp(App)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}
app.use(ElementPlus)

// 全局错误处理：渲染/生命周期错误
app.config.errorHandler = (err, instance, info) => {
  console.error('[App error]', info, err)
  try {
    ElMessage.error(err?.message || '页面发生错误，请刷新重试')
  } catch (_) {}
}

// 未处理的 Promise rejection（如接口失败未 catch）
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || e.reason?.error?.message || String(e.reason)
  if (msg && !msg.includes('AbortError') && !msg.includes('cancel')) {
    console.error('[Unhandled rejection]', e.reason)
    try {
      ElMessage.warning(msg.length > 60 ? msg.slice(0, 60) + '…' : msg)
    } catch (_) {}
  }
})

app.mount('#app')