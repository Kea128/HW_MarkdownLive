import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: 'dist-electron',
    lib: {
      entry: 'electron/preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rollupOptions: {
      external: ['electron'],
    },
    minify: false,
  },
})
