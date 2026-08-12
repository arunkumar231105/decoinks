/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: '#0B1226',      // deep navy rail
        sidebarHover: '#161F3D',
        brand: '#4F46E5',        // indigo — active nav, links, primary buttons
        brandDark: '#4338CA',
        canvas: '#F6F7FB',       // page background
        line: '#E9EAF3',         // card / table borders
        ink: '#0F172A',          // primary text
        muted: '#64748B',        // secondary text
        logo: '#F97316',         // orange logo mark
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)',
        panel: '-8px 0 24px rgba(15, 23, 42, 0.08)',
      },
    },
  },
  plugins: [],
}
