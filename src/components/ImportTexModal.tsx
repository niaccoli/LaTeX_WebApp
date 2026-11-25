import { useState } from 'react'
import type { ParsedTex } from '../lib/split'
import { Modal } from './Modal'

export type ImportMode = 'split' | 'asis'

interface Props {
  fileTitle: string
  parsed: ParsedTex
  /** Il preambolo del corso contiene già qualcosa. */
  courseHasPreamble: boolean
  onClose: () => void
  /** Può lanciare un errore: il messaggio resta nella finestra. */
  onImport: (mode: ImportMode, replacePreamble: boolean, onProgress: (done: number, total: number) => void) => Promise<void>
}

export function ImportTexModal({ fileTitle, parsed, courseHasPreamble, onClose, onImport }: Props) {
  const [mode, setMode] = useState<ImportMode>('split')
  const [replace, setReplace] = useState(!courseHasPreamble)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unit = parsed.level === 'chapter' ? 'capitoli' : 'sezioni'
  const preambleLines = parsed.preamble.trimEnd().split('\n').length

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onImport(mode, replace, (done, total) => setProgress(`Creo i documenti: ${done} di ${total}…`))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore imprevisto.')
      setBusy(false)
    }
  }

  return (
    <Modal title={`Importa «${fileTitle}»`} onClose={busy ? undefined : onClose} wide>
      <p>
        Il file è un documento completo: ha un preambolo di {preambleLines} righe (classe <code>{parsed.documentClass}</code>) e il corpo
        {parsed.parts.length > 0 ? `, che contiene ${parsed.parts.length} ${unit}` : ''}.
      </p>
      <div className="form">
        <label className="choice">
          <input type="radio" name="mode" checked={mode === 'split'} disabled={busy} onChange={() => setMode('split')} />
          <span>
            <strong>Dividi e usa il preambolo del corso (consigliato)</strong>
            <span className="muted small">
              Il preambolo va nel preambolo condiviso del corso;{' '}
              {parsed.parts.length > 0
                ? `ogni ${parsed.level === 'chapter' ? 'capitolo' : 'sezione'} diventa un documento (${parsed.parts.length} in tutto).`
                : 'il corpo diventa un solo documento.'}{' '}
              L’anteprima è più veloce e si scrive a più mani senza pestarsi i piedi.
            </span>
          </span>
        </label>
        {mode === 'split' && courseHasPreamble && (
          <div className="choice-sub">
            <p className="muted small">Questo corso ha già un preambolo.</p>
            <label className="choice">
              <input type="radio" name="replace" checked={!replace} disabled={busy} onChange={() => setReplace(false)} />
              <span>Lascia il preambolo del corso com’è (se mancano delle macro, il PDF darà errori)</span>
            </label>
            <label className="choice">
              <input type="radio" name="replace" checked={replace} disabled={busy} onChange={() => setReplace(true)} />
              <span>Sostituiscilo con quello del file (resta nella cronologia)</span>
            </label>
          </div>
        )}
        <label className="choice">
          <input type="radio" name="mode" checked={mode === 'asis'} disabled={busy} onChange={() => setMode('asis')} />
          <span>
            <strong>Importa così com’è</strong>
            <span className="muted small">
              Un solo documento autonomo, con il suo preambolo: non usa quello del corso. Nello zip resta un file a parte.
            </span>
          </span>
        </label>
      </div>
      {progress && <p className="muted small">{progress}</p>}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          Annulla
        </button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Importo…' : 'Importa'}
        </button>
      </div>
    </Modal>
  )
}
