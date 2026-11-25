import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { listDocumentsWithContent } from '../lib/api'
import { compileLatex } from '../lib/compiler'
import { download } from '../lib/export'
import { buildFullSource, type FullSource } from '../lib/fullcourse'
import { filesForCompile } from '../lib/images'
import { useApp } from '../lib/app-context'
import { useCourse } from '../lib/hooks'
import { PdfPreview } from '../components/PdfPreview'

interface Problem {
  label: string
  line: number | null
  message: string
}

/** PDF dell'intero corso: preambolo + tutti i capitoli in un unico documento (i capitoli restano separati nel sito). */
export function FullCoursePage() {
  const { courseSlug } = useParams()
  const { notifyError } = useApp()
  const { course, loading, error } = useCourse(courseSlug)
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [full, setFull] = useState<FullSource | null>(null)
  const [problems, setProblems] = useState<Problem[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const running = useRef(false)

  const courseId = course?.id
  const build = useCallback(async () => {
    if (!course || running.current) return
    running.current = true
    setBusy('Leggo i documenti…')
    try {
      const docs = await listDocumentsWithContent(course.id)
      const built = buildFullSource(course, docs)
      setFull(built)
      const files = await filesForCompile(course.id, docs.map((d) => d.content))
      // L'indice ha bisogno di due passate: il motore le fa da solo quando serve
      const result = await compileLatex(built.source, (note) => setBusy(note || 'Compilazione…'), files)
      setProblems(result.errors.map((e) => ({ ...built.locate(e.line), message: e.message })))
      if (result.pdf) setPdf(result.pdf)
    } catch (e) {
      notifyError(e)
    } finally {
      running.current = false
      setBusy(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  useEffect(() => {
    if (course) {
      document.title = `PDF completo · ${course.name}`
      void build()
    }
  }, [courseId, build]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="muted pad">Caricamento…</p>
  if (error || !course) return <p className="pad">{error ?? 'Corso non trovato.'}</p>

  return (
    <div className="editor-page">
      <div className="editor-bar">
        <div className="editor-title">
          <nav className="breadcrumb">
            <Link to="/">Corsi</Link> <span>/</span> <Link to={`/corsi/${course.slug}`}>{course.name}</Link>
          </nav>
          <h1>PDF completo</h1>
        </div>
        <div className="editor-actions">
          <span className={`status status-${busy ? 'warn' : problems.length ? 'bad' : 'ok'}`} role="status">
            {busy ?? (problems.length ? 'Compilato con errori' : 'Aggiornato')}
          </span>
          <button className="btn" onClick={() => void build()} disabled={!!busy} title="Rilegge i capitoli e ricompila">
            Aggiorna
          </button>
          <button className="btn" onClick={() => pdf && download(`${course.slug}.pdf`, pdf, 'application/pdf')} disabled={!pdf}>
            Scarica PDF
          </button>
          <button className="btn" onClick={() => full && download(`${course.slug}-completo.tex`, full.source, 'application/x-tex;charset=utf-8')} disabled={!full}>
            Scarica .tex
          </button>
        </div>
      </div>
      {full && full.skipped.length > 0 && (
        <p className="muted pad">Non inclusi perché sono LaTeX completi con una propria classe: {full.skipped.join(', ')}.</p>
      )}
      <div className="panes" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <section className="pane pane-preview" aria-label="PDF completo del corso">
          {pdf ? (
            <PdfPreview data={pdf} />
          ) : (
            <div className="pdf-empty">
              <p>{busy ?? 'Nessun PDF: controlla gli errori qui sotto.'}</p>
            </div>
          )}
          {problems.length > 0 && (
            <div className="errors" role="alert">
              <strong>
                {problems.length} {problems.length === 1 ? 'errore' : 'errori'}
                {pdf && ' · il PDF mostrato è l’ultimo compilato senza errori'}
              </strong>
              <ul>
                {problems.map((p, i) => (
                  <li key={i}>
                    <span className="muted">{p.line ? `${p.label}, riga ${p.line}` : p.label || '—'}</span>
                    <span>{p.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
