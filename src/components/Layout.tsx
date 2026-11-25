import { useState } from 'react'
import { Link, Outlet, useMatch } from 'react-router-dom'
import { useApp } from '../lib/app-context'
import { getTheme, setTheme, type Theme } from '../lib/local'
import { PromptModal } from './Modal'

export function Layout() {
  const { nickname, setNickname } = useApp()
  const [theme, setThemeState] = useState<Theme>(() => getTheme())
  const [editingNick, setEditingNick] = useState(false)
  // La pagina del documento (editor + anteprima) occupa tutta la finestra
  const wide = !!useMatch('/corsi/:courseSlug/:docSlug')

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  return (
    <div className={wide ? 'app app-wide' : 'app'}>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">∑</span> Appunti LaTeX
        </Link>
        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={() => setEditingNick(true)} title="Cambia nickname">
            <span className="avatar">{(nickname ?? '?').slice(0, 1).toUpperCase()}</span>
            <span className="hide-narrow">{nickname ?? 'Scegli un nickname'}</span>
          </button>
          <button className="btn btn-ghost" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>

      {(!nickname || editingNick) && (
        <PromptModal
          title={nickname ? 'Cambia nickname' : 'Benvenuto! Scegli un nickname'}
          label="Nickname"
          initial={nickname ?? ''}
          submitLabel="Salva"
          maxLength={40}
          hint="Serve solo a mostrare chi è presente e chi ha fatto una modifica. Resta salvato in questo browser."
          onClose={() => {
            if (!nickname) setNickname('Anonimo')
            setEditingNick(false)
          }}
          onSubmit={(name) => {
            setNickname(name)
            setEditingNick(false)
          }}
        />
      )}
    </div>
  )
}
