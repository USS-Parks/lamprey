import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping')
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window {
    api: typeof api
  }
}
