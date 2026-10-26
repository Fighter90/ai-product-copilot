import type { Config } from 'tailwindcss';

/**
 * ProductCamp design tokens. Every colour scale points at CSS variables (src/styles/palette.css,
 * src/index.css) so the whole UI — including pre-v3 pages written with slate/indigo utilities —
 * switches between the night (default, productcamp.ru) and day themes without per-page edits.
 */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const scale = (name: string, extra: number[] = []) =>
  Object.fromEntries(
    [...SHADES, ...extra].map((s) => [s, `rgb(var(--tw-${name}-${s}) / <alpha-value>)`]),
  );

const neutral = scale('neutral', [950]);
const brand = scale('brand');

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        raised: 'rgb(var(--c-raised) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-text': 'rgb(var(--c-accent-text) / <alpha-value>)',
        onaccent: 'rgb(var(--c-onaccent) / <alpha-value>)',
        // Legacy palettes remapped to the brand
        white: 'rgb(var(--c-surface) / <alpha-value>)',
        snow: '#ffffff',
        slate: neutral,
        gray: neutral,
        zinc: neutral,
        neutral,
        stone: neutral,
        indigo: brand,
        blue: brand,
        violet: brand,
        brand,
        green: scale('green'),
        emerald: scale('emerald'),
        red: scale('red'),
        rose: scale('rose'),
        amber: scale('amber'),
        yellow: scale('yellow'),
        orange: scale('orange'),
        sky: scale('sky'),
        teal: scale('teal'),
        purple: scale('purple'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        pulseDot: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '.4', transform: 'scale(.8)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-up': 'fade-up .5s cubic-bezier(.2,.7,.2,1) both',
        'fade-in': 'fade-in .3s ease-out both',
        float: 'float 6s ease-in-out infinite',
        'spin-slow': 'spin-slow 60s linear infinite',
        'pulse-dot': 'pulseDot 1.6s ease-in-out infinite',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
