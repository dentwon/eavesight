/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ─── Token-driven semantic colors (read CSS variables from globals.css) ───
        // These let Tailwind utilities like `bg-background`, `text-foreground`,
        // `border-border`, `bg-card`, `text-muted-foreground`, `bg-primary`, etc.
        // resolve to the runtime theme tokens so dark/light flips automatically.
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          // Legacy hex shades still used in pre-refactor screens
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
        },
        secondary: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
          // Legacy hex shades
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },

        // ─── Legacy custom shades kept for pre-refactor screens ───
        slate: {
          850: '#1a2332',
        },
        surface: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
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
        // One-shot curtain used by parent pages to mask the MetroMap theme
        // remount. 250ms feels snappy on weak mobile GPUs but is long enough
        // to hide the empty-container flash between unmount and first paint.
        // `forwards` keeps the 0% opacity after the animation so the scrim
        // doesn't block clicks after it's faded.
        'map-wash': 'map-wash 250ms ease-out forwards',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'map-wash': {
          '0%':   { opacity: '1' },
          '100%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
