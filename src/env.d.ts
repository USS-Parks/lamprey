/// <reference types="vite/client" />

import type { LampreyAPI } from '../electron/preload'

declare global {
  interface Window {
    api: LampreyAPI
  }
}
