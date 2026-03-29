module.exports = {
  content: ['./src/renderer/src/**/*.{ts,tsx}', './src/renderer/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        neutral: { 925: '#111111', 950: '#0a0a0a' },
        'th-bg': 'var(--color-background)',
        'th-surface': 'var(--color-surface)',
        'th-surface-raised': 'var(--color-surface-raised)',
        'th-surface-hover': 'var(--color-surface-hover)',
        'th-surface-active': 'var(--color-surface-active)',
        'th-border': 'var(--color-border)',
        'th-border-strong': 'var(--color-border-strong)',
        'th-text-primary': 'var(--color-text-primary)',
        'th-text-secondary': 'var(--color-text-secondary)',
        'th-text-muted': 'var(--color-text-muted)',
        'th-text-subtle': 'var(--color-text-subtle)',
        'th-text-faint': 'var(--color-text-faint)',
      }
    }
  },
  plugins: []
}
