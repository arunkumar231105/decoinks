/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: '#0A1A3C',       // navy rail
        sidebarHover: '#15294F',
        brand: '#1D4ED8',         // primary blue — active nav, links, primary buttons
        brandDark: '#1E40AF',
        heading: '#12306E',       // page titles / section headings
        canvas: '#F7F9FC',        // page background
        line: '#E4E9F2',          // borders
        ink: '#0F172A',
        muted: '#64748B',
        logo: '#F26522',          // orange logo mark
        // Kept so the existing login / profile screens keep working while the
        // remaining pages are migrated to the new design.
        accent: '#1D4ED8',
        success: '#16A34A',
        warning: '#EA580C',
        danger: '#DC2626',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)',
        pop: '0 8px 24px rgba(15,23,42,.10)',
      },
    },
  },
  plugins: [],
}
