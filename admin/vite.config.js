import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteAliyunNlsPlugin } from './scripts/viteAliyunNlsPlugin.mjs'
import { viteFeishuBitablePlugin } from './scripts/viteFeishuBitablePlugin.mjs'

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

  return {
    '/api/bailian': bailian,
    '/admin/api/bailian': bailian,
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
  return {
    plugins: [vue(), viteAliyunNlsPlugin(env), viteFeishuBitablePlugin(env)],
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
      host: '0.0.0.0',
      port: 5178,
      strictPort: false,
      proxy: devProxy,
    },
    preview: {
      proxy: devProxy,
    },
  }
})
