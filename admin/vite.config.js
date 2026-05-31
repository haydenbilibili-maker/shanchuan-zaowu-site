import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteAliyunNlsPlugin } from './scripts/viteAliyunNlsPlugin.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue(), viteAliyunNlsPlugin(env)],
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
      host: '0.0.0.0', // 🔧 允许局域网访问
      port: 5178, // 开发服务器端口（5173–5177 已被占用时使用）
      strictPort: false, // 如果端口被占用，自动尝试下一个可用端口
      proxy: {
        '/api/gemini': {
          target: 'https://generativelanguage.googleapis.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/gemini/, '/v1beta'),
          secure: true
        },
        '/api/deepseek': {
          target: 'https://api.deepseek.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/deepseek/, '/v1'),
          secure: true,
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              // 将 X-API-Key header 转换为 Authorization header
              if (req.headers['x-api-key']) {
                proxyReq.setHeader('Authorization', `Bearer ${req.headers['x-api-key']}`)
                proxyReq.removeHeader('x-api-key')
              }
            })
          }
        },
        '/api/openai': {
          target: 'https://api.openai.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/openai/, '/v1'),
          secure: true,
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              // 将 X-API-Key header 转换为 Authorization header
              if (req.headers['x-api-key']) {
                proxyReq.setHeader('Authorization', `Bearer ${req.headers['x-api-key']}`)
                proxyReq.removeHeader('x-api-key')
              }
            })
          }
        }
      }
    }
  }
})