/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Category colors (used by planner)
        cat: {
          book: '#3b82f6',        // 看书 - blue
          online: '#a855f7',      // 看网课 - purple
          practice: '#10b981',    // 刷题 - green
          memorize: '#f59e0b',    // 背诵知识点 - amber
          vocab: '#ec4899',       // 背诵单词 - pink
          textbook: '#14b8a6',    // 梳理教材 - teal
          paper: '#6366f1',       // 整理论文 - indigo
          framework: '#f97316',   // 整理框架 - orange
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        cursive: ['"Dancing Script"', 'cursive'],
      },
    },
  },
  plugins: [],
}
