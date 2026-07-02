import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastMsg { id: number; kind: 'success' | 'error'; text: string }

const ToastCtx = createContext<(kind: ToastMsg['kind'], text: string) => void>(() => {})

export function useToast(): (kind: 'success' | 'error', text: string) => void {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const nextId = useRef(1)
  const push = useCallback((kind: ToastMsg['kind'], text: string) => {
    const id = nextId.current++
    setToasts((ts) => [...ts, { id, kind, text }])
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((x) => (
          <div key={x.id} className={`toast toast-${x.kind}`}>{x.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
