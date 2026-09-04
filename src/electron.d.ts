import type { InkdownApi } from './contracts'

declare global {
  interface Window {
    inkdown: InkdownApi
  }
}

export {}
