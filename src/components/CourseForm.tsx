import { useState, type FormEvent } from 'react'
import { Modal } from './Modal'
import type { Course, CourseInput } from '../lib/api'

function defaultYear() {
  const now = new Date()
  // L'anno accademico parte a settembre
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
  return `${start}/${String(start + 1).slice(2)}`
}

interface Props {
  course?: Course
  onClose: () => void
  /** `editCode` è valorizzato solo in creazione. */
  onSubmit: (input: CourseInput, editCode: string) => Promise<void>
}

export function CourseForm({ course, onClose, onSubmit }: Props) {
  const [input, setInput] = useState<CourseInput>({
    name: course?.name ?? '',
    academic_year: course?.academic_year ?? defaultYear(),
    code: course?.code ?? '',
    teacher: course?.teacher ?? '',
    description: course?.description ?? '',
    layout: 'split',
  })
  const [editCode, setEditCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (field: keyof CourseInput) => (e: { target: { value: string } }) => setInput((v) => ({ ...v, [field]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (editCode && editCode.length < 6) {
      setError('Il codice di modifica deve avere almeno 6 caratteri.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(input, editCode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto.')
      setBusy(false)
    }
  }

  return (
    <Modal title={course ? 'Modifica corso' : 'Nuovo corso'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label>
          <span>Nome</span>
          <input autoFocus required minLength={2} maxLength={120} value={input.name} onChange={set('name')} placeholder="Reti di calcolatori" />
        </label>
        <div className="form-row">
          <label>
            <span>Anno accademico</span>
            <input required maxLength={20} value={input.academic_year} onChange={set('academic_year')} />
          </label>
          <label>
            <span>Codice (facoltativo)</span>
            <input maxLength={40} value={input.code} onChange={set('code')} />
          </label>
        </div>
        <label>
          <span>Docente (facoltativo)</span>
          <input maxLength={120} value={input.teacher} onChange={set('teacher')} />
        </label>
        <label>
          <span>Breve descrizione</span>
          <textarea rows={3} maxLength={500} value={input.description} onChange={set('description')} />
        </label>
        {!course && (
          <fieldset className="layout-choice">
            <legend>Come vuoi organizzare gli appunti?</legend>
            <label className="choice">
              <input type="radio" name="layout" checked={input.layout !== 'single'} onChange={() => setInput((v) => ({ ...v, layout: 'split' }))} />
              <span>
                <strong>Capitoli separati, con preambolo condiviso</strong>
                <span className="muted small">Un documento per lezione o capitolo più un preambolo comune: più persone scrivono senza pestarsi i piedi.</span>
              </span>
            </label>
            <label className="choice">
              <input type="radio" name="layout" checked={input.layout === 'single'} onChange={() => setInput((v) => ({ ...v, layout: 'single' }))} />
              <span>
                <strong>Un unico documento LaTeX</strong>
                <span className="muted small">Un solo file completo, con il suo preambolo, come lo scriveresti sul tuo computer. Più semplice se hai già un .tex.</span>
              </span>
            </label>
          </fieldset>
        )}
        {!course && (
          <label>
            <span>Codice di modifica (facoltativo)</span>
            <input type="text" autoComplete="off" maxLength={100} value={editCode} onChange={(e) => setEditCode(e.target.value)} />
            <small className="muted">
              Se lo imposti, solo chi lo conosce può modificare il corso; gli altri possono leggere. Non si può recuperare: segnatelo.
            </small>
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {course ? 'Salva' : 'Crea corso'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
