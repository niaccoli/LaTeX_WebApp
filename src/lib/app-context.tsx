import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { getNickname, setNickname as storeNickname } from './local'
import { ApiError } from './api'

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

interface AppContextValue {
  nickname: string | null
  setNickname: (name: string) => void
  /** Mostra un avviso temporaneo in basso. */
  notify: (text: string, kind?: Toast['kind']) => void
  /** Mostra l'errore di un'operazione fallita. */
  notifyError: (error: unknown) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [nickname, setNick] = useState<string | null>(() => getNickname())
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const setNickname = useCallback((name: string) => {
    storeNickname(name)
    setNick(name.trim().slice(0, 40))
  }, [])

  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = nextId.current++
    setToasts((list) => [...list, { id, text, kind }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500)
  }, [])

  const notifyError = useCallback(
    (error: unknown) => {
      const text = error instanceof ApiError || error instanceof Error ? error.message : 'Errore imprevisto.'
      notify(text, 'error')
    },
    [notify],
  )

  const value = useMemo(() => ({ nickname, setNickname, notify, notifyError }), [nickname, setNickname, notify, notifyError])

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp va usato dentro AppProvider')
  return ctx
}
