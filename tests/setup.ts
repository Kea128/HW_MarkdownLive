import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

const snapshot = { content: '', filePath: null, fileName: '未命名.md', dirty: false }
Object.defineProperty(window, 'inkdown', {
  configurable: true,
  value: {
    document: {
      initialize: vi.fn(async () => snapshot),
      newDocument: vi.fn(async () => ({ ok: true })),
      open: vi.fn(async () => ({ ok: true })),
      openPath: vi.fn(async () => ({ ok: true })),
      save: vi.fn(async () => ({ ok: true })),
      saveAs: vi.fn(async () => ({ ok: true })),
      close: vi.fn(async () => ({ ok: true })),
      pathForFile: vi.fn(() => 'C:\\测试\\文档.md'),
      changed: vi.fn(async () => undefined),
      onUpdated: vi.fn(() => () => undefined),
      onCommand: vi.fn(() => () => undefined),
    },
    view: {
      onMode: vi.fn(() => () => undefined),
      onTheme: vi.fn(() => () => undefined),
      setTheme: vi.fn(async (theme) => theme),
    },
    external: { open: vi.fn(async () => true) },
  },
})
