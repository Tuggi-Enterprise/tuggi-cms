/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Tuggi Brand Colors
        tuggi: {
          blue: '#00A8E8',
          orange: '#FF6F00',
          background: '#F7F9FA',
          text: '#1A1A1A',
          border: '#D9D9D9',
        },
        // Updated theme colors using Tuggi brand.
        //
        // The wrapper is `rgb()` because `app/globals.css` declares every token as an RGB
        // triplet (`--destructive: 220 38 38; /* #DC2626 */`). With `hsl()` around it the
        // browser read `220 38 38` as hue 220°, saturation 38%, lightness 38% and painted
        // navy — and `--destructive-foreground: 255 255 255` became yellow. Card #329:
        // `Button variant="destructive"` rendered rgb(60, 85, 134) with rgb(255, 255, 0)
        // tint, and `Input` rendered a fluorescent-yellow field. `<alpha-value>` is what
        // keeps `bg-destructive/5` and `border-destructive/40` working.
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: '#00A8E8',
          foreground: '#FFFFFF',
          50: '#E6F7FF',
          100: '#B3E5FF',
          500: '#00A8E8',
          600: '#0096D1',
          700: '#0085BA',
        },
        secondary: {
          DEFAULT: '#FF6F00',
          foreground: '#FFFFFF',
          50: '#FFF3E0',
          100: '#FFE0B3',
          500: '#FF6F00',
          600: '#E65C00',
          700: '#CC5200',
        },
        muted: {
          DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
          foreground: 'rgb(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          foreground: 'rgb(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'rgb(var(--destructive) / <alpha-value>)',
          foreground: 'rgb(var(--destructive-foreground) / <alpha-value>)',
          // Darkening by a named token, not by opacity: `hover:bg-destructive/90` composes
          // with whatever is behind it, and over the white of a dialog that LIGHTENS the
          // button to #E03C3C = 4.32:1, which fails SC 1.4.3 AA in the state the operator
          // is in while reading and clicking. Same shape as `--color-tuggi-secondary-hover`
          // on the site (DS-COR-004).
          hover: 'rgb(var(--destructive-hover) / <alpha-value>)',
        },
        border: '#D9D9D9',
        input: '#D9D9D9',
        ring: '#00A8E8',
      },
    },
  },
  plugins: [],
} 