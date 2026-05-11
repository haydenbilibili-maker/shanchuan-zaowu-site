/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // ============================================================
        // v0.2 双主题色板 · 通过 CSS 变量自动切换深色 / 浅色
        // ----------------------------------------------------------------
        // 高频被 opacity 修饰的 token（ink / brass）使用 rgb tuple 格式
        // 让 bg-ink/40 border-brass-mid/15 等既有写法继续工作。
        // 其他 token 用简单 var() 引用。
        // ============================================================

        // ----- Backgrounds（ink）-----
        ink: {
          DEFAULT: 'rgb(var(--rgb-ink) / <alpha-value>)',
          elevated: 'rgb(var(--rgb-ink-elevated) / <alpha-value>)',
          deep: 'rgb(var(--rgb-ink-deep) / <alpha-value>)',
        },

        // ----- Text（cream / text）-----
        cream: 'rgb(var(--rgb-cream) / <alpha-value>)',
        text: {
          DEFAULT: 'var(--color-text)',
          soft: 'var(--color-text-soft)',
          dim: 'var(--color-text-dim)',
        },

        // ----- Brass（全部 4 阶都被 opacity 修饰）-----
        brass: {
          deep: 'rgb(var(--rgb-brass-deep) / <alpha-value>)',
          mid: 'rgb(var(--rgb-brass-mid) / <alpha-value>)',
          light: 'rgb(var(--rgb-brass-light) / <alpha-value>)',
          bright: 'rgb(var(--rgb-brass-bright) / <alpha-value>)',
        },

        // ----- Green（v0.2 双主题预定义） -----
        green: {
          deep: 'var(--color-green-deep)',
          mid: 'var(--color-green-mid)',
          light: 'var(--color-green-light)',
          bright: 'var(--color-green-bright)',
        },

        // ----- Cabinet（v0.2 预定义 · 博物蓝） -----
        cabinet: {
          deep: 'var(--color-cabinet-deep)',
          mid: 'var(--color-cabinet-mid)',
          light: 'var(--color-cabinet-light)',
        },

        // ----- Coral（v0.2 预定义 · 标本红 · 不做×符号） -----
        coral: {
          deep: 'var(--color-coral-deep)',
          mid: 'var(--color-coral-mid)',
        },

        // ----- Purple（v0.2 预定义 · 矿物紫） -----
        purple: {
          deep: 'var(--color-purple-deep)',
          mid: 'var(--color-purple-mid)',
          light: 'var(--color-purple-light)',
        },

        // ============================================================
        // VI v2.0 米白纸张色族 · 独立色族 · 不参与双主题切换
        // ----------------------------------------------------------------
        // Footer 是"翻到出版物末页"的物理体验，需要稳定的米白纸张感。
        // paper 设为 #F2EDE4 而非 #FAFAF5，避免浅色模式下 Footer
        // 与 main（也是 #FAFAF5）同色合并丢失边界。
        // ============================================================
        paper: '#F2EDE4',          // 微暖白纸张：比浅色 main 深一档
        'nature-green': '#2D6A4F', // 自然绿：Footer 标题 / hover
        'earth-brown': '#8B6F47',  // 大地棕：拉丁学名
        'mineral-purple': '#7B68AE', // 矿物紫：保留备用
        'ink-text': '#2C2C2C',     // 墨绿黑：Footer 正文
      },
      fontFamily: {
        serif: [
          '"Source Han Serif SC"',
          '"思源宋体"',
          '"Songti SC"',
          '"宋体"',
          'serif',
        ],
        'serif-en': [
          '"Cormorant Garamond"',
          '"Lyon Text"',
          'Georgia',
          'serif',
        ],
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        'display-lg': ['clamp(3rem, 6vw, 5rem)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display': ['clamp(2.25rem, 4vw, 3.5rem)', { lineHeight: '1.15', letterSpacing: '-0.01em' }],
        'title': ['clamp(1.5rem, 2.5vw, 2rem)', { lineHeight: '1.25' }],
      },
      spacing: {
        section: 'clamp(4rem, 10vw, 8rem)',
        paragraph: 'clamp(1.25rem, 2vw, 2rem)',
      },
      maxWidth: {
        'editorial': '38rem',
        'editorial-wide': '52rem',
      },
      letterSpacing: {
        'cn': '0.02em',
      },
    },
  },
  plugins: [],
};
