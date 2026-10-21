const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: c('background'), foreground: c('foreground'), card: c('card'), muted: c('muted'), 'muted-foreground': c('muted-foreground'),
        border: c('border'), primary: c('primary'), 'primary-foreground': c('primary-foreground'), accent: c('accent'), 'accent-foreground': c('accent-foreground'),
        success: c('success'), warning: c('warning'), danger: c('danger'), info: c('info'),
        sidebar: c('sidebar'), 'sidebar-foreground': c('sidebar-foreground'), 'sidebar-muted': c('sidebar-muted'),
      },
      borderRadius: { lg: '0.75rem', xl: '1rem' },
      fontFamily: { sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'], display: ['Sora', 'Plus Jakarta Sans', 'sans-serif'] },
    },
  },
  plugins: [],
};
