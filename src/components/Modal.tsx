import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose?: () => void
  children: ReactNode
  /** Finestra larga, per contenuti come la cronologia con il confronto. */
  wide?: boolean
}

export function Modal({ title, onClose, children, wide }: ModalProps) {
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

interface PromptModalProps {
  title: string
  label: string
  initial?: string
  submitLabel: string
  type?: 'text' | 'password'
  hint?: string
  maxLength?: number
  onClose: () => void
  /** Può lanciare un errore: il messaggio viene mostrato nel riquadro. */
  onSubmit: (value: string) => Promise<void> | void
}

/** Finestra con un solo campo di testo (nuovo documento, rinomina, codice di modifica). */
export function PromptModal({ title, label, initial = '', submitLabel, type = 'text', hint, maxLength = 200, onClose, onSubmit }: PromptModalProps) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!value.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(value.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto.')
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label>
          <span>{label}</span>
          <input autoFocus type={type} value={value} maxLength={maxLength} onChange={(e) => setValue(e.target.value)} />
        </label>
        {hint && <p className="muted small">{hint}</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim() || busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
