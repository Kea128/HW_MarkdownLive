import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist-electron',
    lib: {
      entry: 'electron/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'main.cjs',
    },
    rollupOptions: {
      external: [/^node:/, 'electron', 'electron-updater'],
    },
    minify: false,
  },
})
