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
      // The lazily loaded electron-updater must go through require(); a native import() of this
      // CommonJS package does not load in Electron's main process.
      output: { dynamicImportInCjs: false },
    },
    minify: false,
  },
})
