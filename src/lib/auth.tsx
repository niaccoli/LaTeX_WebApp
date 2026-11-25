import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthValue {
  email: string
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth va usato dentro AuthGate')
  return value
}

type Phase = 'loading' | 'out' | 'checking' | 'denied' | 'ok' | 'offline'

/** Mostra l'app solo a chi ha fatto l'accesso con un account autorizzato; altrimenti la pagina di accesso. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setPhase(data.session ? 'checking' : 'out')
    })
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'TOKEN_REFRESHED') return // stessa persona: niente da ricontrollare
      setSession(next)
      setPhase(next ? 'checking' : 'out')
    })
    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [])

  // L'account deve essere anche nell'elenco delle email autorizzate (lo controlla il database)
  const userId = session?.user.id
  useEffect(() => {
    if (!userId || phase !== 'checking') return
    let cancelled = false
    void supabase.rpc('is_member').then(({ data, error }) => {
      if (cancelled) return
      setPhase(error ? 'offline' : data === true ? 'ok' : 'denied')
    })
    return () => {
      cancelled = true
    }
  }, [userId, phase])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    window.location.assign('/')
  }, [])

  const value = useMemo(() => ({ email: session?.user.email ?? '', signOut }), [session, signOut])

  if (phase === 'loading' || phase === 'checking') return <p className="auth-wait muted">Verifico l’accesso…</p>
  if (phase === 'out') return <LoginPage />
  if (phase === 'denied')
    return (
      <AuthShell title="Account non autorizzato">
        <p>
          L’account <strong>{session?.user.email}</strong> non è nell’elenco di chi può usare questo sito. Chiedi a chi lo gestisce di aggiungerti,
          oppure accedi con un altro account.
        </p>
        <button className="btn" onClick={() => void signOut()}>
          Esci
        </button>
      </AuthShell>
    )
  if (phase === 'offline')
    return (
      <AuthShell title="Server non raggiungibile">
        <p>Non riesco a verificare l’accesso. Controlla la connessione e riprova.</p>
        <button className="btn btn-primary" onClick={() => setPhase('checking')}>
          Riprova
        </button>
      </AuthShell>
    )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <p className="brand">
          <span className="brand-mark">∑</span> Appunti LaTeX
        </p>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  )
}

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: failure } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (failure) {
      setBusy(false)
      setError(
        /invalid login|credentials/i.test(failure.message)
          ? 'Email o password non corrette.'
          : /failed to fetch|network/i.test(failure.message)
            ? 'Connessione al server non riuscita. Riprova.'
            : failure.message,
      )
    }
    // Se riesce, onAuthStateChange passa alla verifica e poi all'app
  }

  return (
    <AuthShell title="Accedi">
      <p className="muted">Questo sito è riservato: entra con l’email e la password che ti sono state date.</p>
      <form className="auth-form" onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Accesso…' : 'Accedi'}
        </button>
      </form>
    </AuthShell>
  )
}
