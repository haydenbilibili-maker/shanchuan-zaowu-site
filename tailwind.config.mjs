/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // ===== v0.2 深色主题色 · 奇珍柜 =====
        brass: {
          deep: '#8A7530',
          mid: '#C4A76C',
          light: '#E8DDC2',
          bright: '#DDC890',
        },
        ink: {
          DEFAULT: '#1A1814',
          elevated: '#232020',
          deep: '#0F0D0B',
        },
        cream: '#F2EDE4',
        text: {
          DEFAULT: '#F2EDE4',
          soft: '#B8B0A4',
          dim: '#6B6560',
        },
        // ===== VI v2.0 标准色 · 用于纸张感区域（footer / 印刷物料语境）=====
        paper: '#FAFAF5',          // 微暖白：纸张感底色
        'nature-green': '#2D6A4F', // 自然绿：主色，标题/强调（≤30% 视觉面积）
        'earth-brown': '#8B6F47',  // 大地棕：拉丁学名 / 温暖点缀
        'mineral-purple': '#7B68AE', // 矿物紫：仅矿石品类
        'ink-text': '#2C2C2C',     // 墨绿黑：浅底上的正文
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
