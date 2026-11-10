import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  // The CSP only allows fonts from 'self', so small assets such as KaTeX fonts must not become data: URIs.
  build: { assetsInlineLimit: 0 },
})
