import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('gelato', {
  loginPin: (kasseId: string, pin: string) => ipcRenderer.invoke('auth:pin', kasseId, pin),
  products: () => ipcRenderer.invoke('catalog:products'),
  finalize: (cart: unknown, mode: string) => ipcRenderer.invoke('sale:finalize', cart, mode),
})
