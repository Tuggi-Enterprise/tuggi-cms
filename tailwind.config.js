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
        // Updated theme colors using Tuggi brand
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
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
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: '#D9D9D9',
        input: '#D9D9D9',
        ring: '#00A8E8',
      },
    },
  },
  plugins: [],
} 