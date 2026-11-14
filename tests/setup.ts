import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import type { Preferences } from '../src/contracts'
import { DEFAULT_PREFERENCES } from '../src/preferences'

// Node 25+ ships an experimental global localStorage that shadows jsdom's implementation.
const { jsdom } = globalThis as typeof globalThis & { jsdom?: { window: Window } }
if (jsdom) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: jsdom.window.localStorage })
}

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

const snapshot = { documentId: 1, content: '', filePath: null, fileName: '未命名.md', dirty: false }
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
    updates: { onState: vi.fn(() => () => undefined) },
    workspace: {
      get: vi.fn(async () => null),
      open: vi.fn(async () => null),
      refresh: vi.fn(async () => null),
      close: vi.fn(async () => null),
      onUpdated: vi.fn(() => () => undefined),
    },
    feedback: {
      submit: vi.fn(async () => ({ ok: true, id: '00000000-feedback', tags: [], truncated: false })),
      openFolder: vi.fn(async () => undefined),
      onShow: vi.fn(() => () => undefined),
    },
    images: {
      save: vi.fn(async () => ({ ok: true, src: '初始.assets/image-20261112170000000.png', location: 'saved' })),
      choose: vi.fn(async () => []),
      open: vi.fn(async () => true),
      reveal: vi.fn(async () => true),
      copy: vi.fn(async () => true),
    },
    settings: {
      get: vi.fn(async () => DEFAULT_PREFERENCES),
      set: vi.fn(async (patch: Partial<Preferences>) => ({ ok: true, value: { ...DEFAULT_PREFERENCES, ...patch } })),
      onChanged: vi.fn(() => () => undefined),
      onShow: vi.fn(() => () => undefined),
    },
  },
})
