import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteAliyunNlsPlugin } from './scripts/viteAliyunNlsPlugin.mjs'
import { viteOssTtsPlugin } from './scripts/viteOssTtsPlugin.mjs'
import { viteFeishuBitablePlugin } from './scripts/viteFeishuBitablePlugin.mjs'
import { viteCloudFnPlugin } from './scripts/viteCloudFnPlugin.mjs'

function buildDevProxies(env = {}) {
  const withAuthHeader = (proxy) => {
    proxy.on('proxyReq', (proxyReq, req) => {
      if (req.headers['x-api-key']) {
        proxyReq.setHeader('Authorization', `Bearer ${req.headers['x-api-key']}`)
        proxyReq.removeHeader('x-api-key')
      }
    })
  }

  const bailian = {
    target: 'https://dashscope.aliyuncs.com',
    changeOrigin: true,
    secure: true,
    configure: withAuthHeader,
    rewrite: (path) => path.replace(/^\/(?:admin\/)?api\/bailian/, '/compatible-mode/v1'),
  }

  const gemini = {
    target: 'https://generativelanguage.googleapis.com',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/(?:admin\/)?api\/gemini/, '/v1beta'),
  }

  const deepseekTarget = String(env.VITE_DEEPSEEK_BASE_URL || 'https://api.deepseek.com')
    .replace(/\/v1\/?$/i, '')
    .replace(/\/$/, '')

  const deepseek = {
    target: deepseekTarget || 'https://api.deepseek.com',
    changeOrigin: true,
    secure: true,
    configure: withAuthHeader,
    rewrite: (path) => path.replace(/^\/(?:admin\/)?api\/deepseek/, '/v1'),
  }

  const openai = {
    target: 'https://api.openai.com',
    changeOrigin: true,
    secure: true,
    configure: withAuthHeader,
    rewrite: (path) => path.replace(/^\/(?:admin\/)?api\/openai/, '/v1'),
  }

  /** 百炼原生文生图 / 异步任务（非 OpenAI 兼容路径） */
  const bailianNative = {
    target: 'https://dashscope.aliyuncs.com',
    changeOrigin: true,
    secure: true,
    configure: withAuthHeader,
    rewrite: (path) => path.replace(/^\/(?:admin\/)?api\/bailian-native/, '/api/v1'),
  }

  return {
    '/api/bailian': bailian,
    '/admin/api/bailian': bailian,
    '/api/bailian-native': bailianNative,
    '/admin/api/bailian-native': bailianNative,
    '/api/gemini': gemini,
    '/admin/api/gemini': gemini,
    '/api/deepseek': deepseek,
    '/admin/api/deepseek': deepseek,
    '/api/openai': openai,
    '/admin/api/openai': openai,
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devProxy = buildDevProxies(env)
  const isProd = mode === 'production'
  /**
   * 开发期 AI Key 注入。
   *
   * 为什么不用 import.meta.env.VITE_*_API_KEY：Vite 会在**构建期**把静态访问
   * 内联为字面量，于是厂商密钥随前端包公开发布（2026-09-15 部署即因此被仓库的
   * 密钥扫描阻断：VITE_DEEPSEEK_API_KEY 的值出现在 index-*.js）。
   * 生产环境一律走 Pages Function 网关 /api/ai，前端不需要也不应持有任何 Key；
   * 因此这里只在非 production 构建时注入 __AI_DEV_ENV__，生产包内不含任何密钥字面量。
   */
  const devAiEnv = isProd
    ? undefined
    : JSON.stringify({
        VITE_DEEPSEEK_API_KEY: env.VITE_DEEPSEEK_API_KEY || '',
        VITE_DEEPSEEK_API_KEYS: env.VITE_DEEPSEEK_API_KEYS || '',
        VITE_BAILIAN_API_KEY: env.VITE_BAILIAN_API_KEY || '',
        VITE_BAILIAN_API_KEYS: env.VITE_BAILIAN_API_KEYS || '',
        VITE_OPENAI_API_KEY: env.VITE_OPENAI_API_KEY || '',
        VITE_OPENAI_API_KEYS: env.VITE_OPENAI_API_KEYS || '',
        VITE_GEMINI_API_KEY: env.VITE_GEMINI_API_KEY || '',
        VITE_GEMINI_API_KEYS: env.VITE_GEMINI_API_KEYS || '',
        VITE_DASHSCOPE_API_KEY: env.VITE_DASHSCOPE_API_KEY || ''
      })
  return {
    ...(devAiEnv ? { define: { __AI_DEV_ENV__: devAiEnv } } : {}),
    plugins: [
      vue(),
      viteAliyunNlsPlugin(env),
      viteOssTtsPlugin(env),
      viteFeishuBitablePlugin(env),
      viteCloudFnPlugin(env),
    ],
    /** 挂载于 shanhaizaowu.com/admin/；构建输出到 public/admin/ */
    base: '/admin/',
    build: {
      outDir: '../public/admin',
      emptyOutDir: false,
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              if (id.includes('element-plus')) return 'element-plus'
              if (id.includes('vue') && !id.includes('vue-router')) return 'vue'
              if (id.includes('chart.js') || id.includes('chartjs')) return 'chart'
              if (id.includes('xlsx')) return 'xlsx'
            }
            return null
          },
        },
      },
    },
    server: {
      // 2026-09-17 审计 B5：默认只绑本机。此前 0.0.0.0 + 代理无条件注入 ADMIN_OPS_KEY
      // = 同局域网任何人拿到超管身份。要手机/局域网调试请显式 ADMIN_DEV_HOST=0.0.0.0。
      host: env.ADMIN_DEV_HOST || '127.0.0.1',
      port: 5178,
      strictPort: false,
      proxy: devProxy,
    },
    preview: {
      proxy: devProxy,
    },
  }
})
