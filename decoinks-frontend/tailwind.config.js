import animate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0D9488',
          foreground: '#ffffff',
        },
        sidebar: '#1F2937',
      },
      borderRadius: {
        card: '8px',
      },
    },
  },
  plugins: [animate],
}
