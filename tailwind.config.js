/** @type {import('tailwindcss').Config} */

/*
 * Design tokens mirror the India 101 public portal (~/india101-portal) so the
 * admin console matches the brand. Colors resolve to CSS variables defined in
 * src/index.css (:root), keeping a single source of truth and leaving room for
 * future per-tenant re-skinning (change the vars, not the classes).
 */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand)',
          deep: 'var(--brand-deep)',
        },
        charcoal: {
          DEFAULT: 'var(--charcoal)',
          2: 'var(--charcoal-2)',
          3: 'var(--charcoal-3)',
        },
        cream: 'var(--cream)',
        // semantic surfaces used across the admin console
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        line: 'var(--line)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl2: '1rem',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'none' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        fadeUp: 'fadeUp 0.5s cubic-bezier(0.2,0.7,0.2,1) forwards',
        fadeIn: 'fadeIn 0.4s ease forwards',
      },
    },
  },
  plugins: [],
};
