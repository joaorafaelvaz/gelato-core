import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('gelato', {
  loginPin: (kasseId: string, pin: string) => ipcRenderer.invoke('auth:pin', kasseId, pin),
  products: () => ipcRenderer.invoke('catalog:products'),
  finalize: (cart: unknown, mode: string) => ipcRenderer.invoke('sale:finalize', cart, mode),
  shiftOpen: (openingFloat: number) => ipcRenderer.invoke('shift:open', openingFloat),
  shiftClose: (counted: number) => ipcRenderer.invoke('shift:close', counted),
  cashMovement: (type: string, amount: number) => ipcRenderer.invoke('shift:cashMovement', type, amount),
  drawer: () => ipcRenderer.invoke('drawer:open'),
  reportX: () => ipcRenderer.invoke('report:x'),
  reportZ: () => ipcRenderer.invoke('report:z'),
  ausfallState: () => ipcRenderer.invoke('tse:ausfallState'),
})
