/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // StormVault Dark Theme - Storm Cloud / Charcoal Shingle vibes
        slate: {
          850: '#1a2332', // Darker slate for depth
        },
        // Primary - Steel Blue (storm cloud accent)
        primary: {
          400: '#60a5fa', // Light blue
          500: '#3b82f6', // Steel blue
          600: '#2563eb', // Deeper blue
        },
        // Accent - Amber/Orange (warmth, contrast, like warning lights)
        accent: {
          400: '#fbbf24', // Amber
          500: '#f59e0b', // Darker amber
          600: '#d97706', // Even darker
        },
        // Surface colors for dark theme
        surface: {
          900: '#0f172a', // Deep navy/slate (main bg)
          800: '#1e293b', // Slightly lighter (cards)
          700: '#334155', // Card borders
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'glow': '0 0 20px rgba(59, 130, 246, 0.3)',
        'glow-accent': '0 0 20px rgba(245, 158, 11, 0.3)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.4)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
}
