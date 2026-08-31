/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Taken from decoinks.com: the store is white-and-black with Poppins,
        // and the wordmark's ink drips are a CMYK set. Those four are the whole
        // brand, so they are the whole palette here too.
        ink:     '#121212',   // --color-foreground on the store
        muted:   '#6B6B6B',
        hairline:'#E4E4E4',
        canvas:  '#F5F5F5',   // --color-background
        cyan:    '#00B4E4',   // the "o" and the first drip
        magenta: '#E45490',
        yellow:  '#F0C00C',
      },
      fontFamily: {
        sans: ['Poppins', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        // The store's buttons are square (--buttons-radius: 0px). Keeping that
        // is most of what makes this feel like the same company.
        btn: '0px',
        card: '4px',
      },
    },
  },
  plugins: [],
}
