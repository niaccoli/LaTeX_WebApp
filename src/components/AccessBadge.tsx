import { useState } from 'react'
import { PromptModal } from './Modal'

interface Props {
  locked: boolean
  hasCode: boolean
  unlock: (code: string) => Promise<boolean>
  forget: () => void
}

/** Mostra se il corso è bloccato da un codice e permette di inserirlo. */
export function AccessBadge({ locked, hasCode, unlock, forget }: Props) {
  const [asking, setAsking] = useState(false)
  if (!locked) return null

  return (
    <div className={`access ${hasCode ? 'access-open' : ''}`}>
      {hasCode ? (
        <>
          <span>Corso protetto: hai il codice di modifica.</span>
          <button className="link" onClick={forget}>
            Dimentica il codice
          </button>
        </>
      ) : (
        <>
          <span>Corso protetto: puoi solo leggere.</span>
          <button className="link" onClick={() => setAsking(true)}>
            Inserisci il codice di modifica
          </button>
        </>
      )}
      {asking && (
        <PromptModal
          title="Codice di modifica"
          label="Codice"
          type="password"
          submitLabel="Sblocca"
          maxLength={100}
          onClose={() => setAsking(false)}
          onSubmit={async (code) => {
            if (!(await unlock(code))) throw new Error('Codice non valido.')
            setAsking(false)
          }}
        />
      )}
    </div>
  )
}
