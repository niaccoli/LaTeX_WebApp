import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  createDocument,
  getPreamble,
  deleteCourse,
  deleteDocument,
  formatDate,
  listDocuments,
  listDocumentsWithContent,
  listImages,
  renameDocument,
  reorderDocuments,
  restoreDocument,
  saveDocument,
  searchDocuments,
  updateCourse,
  type DocMeta,
  type SearchHit,
} from '../lib/api'
import { downloadCourseZip, readTexFile } from '../lib/export'
import { imageBytes } from '../lib/images'
import { isBlankTex, parseFullTex, type ParsedTex } from '../lib/split'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { openChannel, supabase } from '../lib/supabase'
import { useApp } from '../lib/app-context'
import { useCourse, useEditAccess } from '../lib/hooks'
import { CourseForm } from '../components/CourseForm'
import { ImportTexModal, type ImportMode } from '../components/ImportTexModal'
import { PromptModal } from '../components/Modal'
import { AccessBadge } from '../components/AccessBadge'

export function CoursePage() {
  const { courseSlug } = useParams()
  const navigate = useNavigate()
  const { nickname, notify, notifyError } = useApp()
  const { course, setCourse, loading, error } = useCourse(courseSlug)
  const access = useEditAccess(course)
  const { canEdit } = access

  const [docs, setDocs] = useState<DocMeta[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<DocMeta | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [pendingImport, setPendingImport] = useState<{ title: string; content: string; parsed: ParsedTex; courseHasPreamble: boolean } | null>(null)
  const dragging = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const courseId = course?.id

  const loadDocs = useCallback(async () => {
    if (!courseId || dragging.current) return
    try {
      setDocs(await listDocuments(courseId))
    } catch (e) {
      notifyError(e)
    }
  }, [courseId, notifyError])

  // Se l'URL usa uno slug vecchio (corso rinominato), passa a quello attuale
  useEffect(() => {
    if (course && course.slug !== courseSlug) navigate(`/corsi/${course.slug}`, { replace: true })
    if (course) document.title = `${course.name} · Appunti LaTeX`
  }, [course, courseSlug, navigate])

  // Lista dei documenti, aggiornata in tempo reale quando qualcuno la cambia
  useEffect(() => {
    if (!courseId) return
    void loadDocs()
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    let channel: RealtimeChannel | null = null
    void openChannel(`course-docs:${courseId}`).then((opened) => {
      if (cancelled) {
        void supabase.removeChannel(opened)
        return
      }
      channel = opened
      opened
        .on('postgres_changes', { event: '*', schema: 'public', table: 'documents', filter: `course_id=eq.${courseId}` }, () => {
          clearTimeout(timer)
          timer = setTimeout(() => void loadDocs(), 400)
        })
        .subscribe()
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [courseId, loadDocs])

  // Ricerca nel testo, con una breve attesa mentre si scrive
  useEffect(() => {
    const text = query.trim()
    if (!courseId || text.length < 2) {
      setHits(null)
      return
    }
    setHits(null)
    let cancelled = false
    const timer = setTimeout(() => {
      searchDocuments(courseId, text)
        .then((found) => !cancelled && setHits(found))
        .catch((e) => {
          if (cancelled) return
          setHits([])
          notifyError(e)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [courseId, query, notifyError])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (loading) return <p className="muted">Caricamento…</p>
  if (error) return <p className="form-error">{error}</p>
  if (!course) {
    return (
      <div className="empty">
        <p>Corso non trovato.</p>
        <Link to="/">Torna all’elenco dei corsi</Link>
      </div>
    )
  }

  const active = (docs ?? []).filter((d) => d.kind === 'doc' && !d.deleted_at)
  const trashed = (docs ?? []).filter((d) => d.kind === 'doc' && d.deleted_at)
  const preamble = (docs ?? []).find((d) => d.kind === 'preamble')

  async function run(action: () => Promise<unknown>, done?: string) {
    try {
      await action()
      if (done) notify(done)
      await loadDocs()
    } catch (e) {
      notifyError(e)
    }
  }

  async function exportZip() {
    if (!course) return
    setExporting(true)
    try {
      const docs = await listDocumentsWithContent(course.id)
      const list = await listImages(course.id)
      const images = await Promise.all(list.map(async (i) => ({ name: i.name, bytes: await imageBytes(i.id) })))
      await downloadCourseZip(course, docs, images)
    } catch (e) {
      notifyError(e)
    } finally {
      setExporting(false)
    }
  }

  async function importTex(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // permette di riscegliere lo stesso file
    if (!file || !course) return
    try {
      const { title, content } = await readTexFile(file)
      // Un documento completo (con \documentclass e \begin{document}) si può dividere in preambolo e capitoli
      const parsed = (docs ?? []).some((d) => d.kind === 'preamble') ? parseFullTex(content) : null // senza preambolo del corso resta un documento a sé
      if (parsed) {
        setPendingImport({ title, content, parsed, courseHasPreamble: !isBlankTex(await getPreamble(course.id)) })
        return
      }
      const created = await createDocument(course.id, title, content, nickname)
      notify(`«${created.title}» importato.`)
      navigate(`/corsi/${course.slug}/${created.slug}`)
    } catch (e) {
      notifyError(e)
    }
  }

  async function runImport(mode: ImportMode, replacePreamble: boolean, onProgress: (done: number, total: number) => void) {
    if (!course || !pendingImport) return
    const { title, content, parsed, courseHasPreamble } = pendingImport
    let first: { slug: string } | null = null
    let count = 0
    try {
      if (mode === 'asis') {
        first = await createDocument(course.id, title, content, nickname)
        count = 1
      } else {
        // Il preambolo del file passa al corso se il corso non ne ha uno o se lo si è chiesto
        const target = (docs ?? []).find((d) => d.kind === 'preamble')
        if (target && (replacePreamble || !courseHasPreamble)) await saveDocument(course.id, target.id, parsed.preamble, nickname, { snapshot: true })
        const items = parsed.parts.length > 0 ? parsed.parts : [{ title, content: parsed.body }]
        for (const item of items) {
          const created = await createDocument(course.id, item.title, item.content, nickname)
          first ??= created
          onProgress(++count, items.length)
        }
      }
    } catch (e) {
      await loadDocs()
      throw new Error(`${e instanceof Error ? e.message : 'Errore imprevisto.'}${count > 0 ? ` (creati ${count} documenti prima dell'errore)` : ''}`)
    }
    await loadDocs()
    notify(count === 1 ? 'Documento importato.' : `${count} documenti importati.`)
    if (count === 1 && first) navigate(`/corsi/${course.slug}/${first.slug}`)
  }

  async function onDragEnd(event: DragEndEvent) {
    dragging.current = false
    const { active: from, over } = event
    if (!over || from.id === over.id || !course) return
    const oldIndex = active.findIndex((d) => d.id === from.id)
    const newIndex = active.findIndex((d) => d.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(active, oldIndex, newIndex)
    // Aggiorna subito la lista, poi salva; se il salvataggio fallisce si ricarica quella vera
    setDocs((all) => (all ? [...all.filter((d) => !next.includes(d)), ...next.map((d, i) => ({ ...d, position: i + 1 }))] : all))
    await run(() => reorderDocuments(course.id, next.map((d) => d.id)))
  }

  return (
    <>
      <nav className="breadcrumb">
        <Link to="/">Corsi</Link> <span>/</span> {course.name}
      </nav>

      {course.deleted_at && <div className="access">Questo corso è nel cestino. Ripristinalo dal cestino dei corsi per modificarlo.</div>}

      <div className="page-head">
        <div>
          <div className="course-card-top">
            {course.code && <span className="tag">{course.code}</span>}
            <span className="muted small">A.A. {course.academic_year}</span>
            {course.teacher && <span className="muted small">· {course.teacher}</span>}
          </div>
          <h1>{course.name}</h1>
          {course.description && <p className="muted">{course.description}</p>}
        </div>
        {canEdit && (
          <div className="head-actions">
            <button className="btn" onClick={() => setEditing(true)}>
              Modifica
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                try {
                  await deleteCourse(course.id)
                  notify('Corso spostato nel cestino.')
                  navigate('/')
                } catch (e) {
                  notifyError(e)
                }
              }}
            >
              Elimina
            </button>
          </div>
        )}
      </div>

      <AccessBadge {...access} />

      <section className="section">
        <div className="section-head">
          <h2>Documenti</h2>
          <div className="head-actions">
            <button className="btn" onClick={exportZip} disabled={exporting || active.length === 0} title="Scarica main.tex, preambolo e tutti i documenti">
              {exporting ? 'Preparo lo zip…' : 'Esporta .zip'}
            </button>
            {preamble && active.length > 0 && (
              <Link className="btn" to={`/corsi/${course.slug}/_completo`} title="Tutti i capitoli in un unico PDF">
                PDF completo
              </Link>
            )}
            {canEdit && (
              <>
                <button className="btn" onClick={() => fileInput.current?.click()}>
                  Importa .tex
                </button>
                <input ref={fileInput} type="file" accept=".tex,.ltx,.txt,text/plain" hidden onChange={importTex} />
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  + Nuovo documento
                </button>
              </>
            )}
          </div>
        </div>

        <input
          className="search"
          type="search"
          placeholder="Cerca nel testo dei documenti…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Cerca nel testo dei documenti"
        />
        {query.trim().length >= 2 && (
          <div className="search-results" aria-live="polite">
            {hits === null && <p className="muted small">Ricerca…</p>}
            {hits?.length === 0 && <p className="muted small">Nessun documento contiene «{query.trim()}».</p>}
            {hits?.map((hit) => (
              <Link key={hit.id} to={`/corsi/${course.slug}/${hit.slug}`} className="search-hit">
                <strong>{hit.title}</strong>
                {hit.snippet && <span className="muted small">{renderSnippet(hit.snippet)}</span>}
              </Link>
            ))}
          </div>
        )}

        {!docs && <p className="muted">Caricamento…</p>}
        {docs && active.length === 0 && <p className="empty">Nessun documento. {canEdit && 'Crea il primo con «Nuovo documento».'}</p>}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => (dragging.current = true)} onDragCancel={() => (dragging.current = false)} onDragEnd={onDragEnd}>
          <SortableContext items={active.map((d) => d.id)} strategy={verticalListSortingStrategy}>
            <ul className="list">
              {active.map((d, i) => (
                <DocRow
                  key={d.id}
                  doc={d}
                  index={i + 1}
                  courseSlug={course.slug}
                  canEdit={canEdit}
                  onRename={() => setRenaming(d)}
                  onDelete={() => run(() => deleteDocument(course.id, d.id), `«${d.title}» spostato nel cestino.`)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </section>

      {preamble && (
        <section className="section">
          <h2>Preambolo condiviso</h2>
          <Link to={`/corsi/${course.slug}/${preamble.slug}`} className="card preamble-card">
            <div>
              <strong>Macro e pacchetti del corso</strong>
              <p className="muted small">
                I <code>\newcommand</code> e i <code>\usepackage</code> scritti qui valgono per tutti i documenti. Se ci metti anche una{' '}
                <code>\documentclass</code>, sostituisce quella predefinita (article, 11pt, A4).
              </p>
            </div>
            <span className="muted small">Aggiornato il {formatDate(preamble.updated_at)}</span>
          </Link>
        </section>
      )}

      <section className="section">
        <button className="link" onClick={() => setShowTrash((v) => !v)} aria-expanded={showTrash}>
          {showTrash ? '▾' : '▸'} Cestino del corso ({trashed.length})
        </button>
        {showTrash && (
          <ul className="list">
            {trashed.length === 0 && <li className="empty">Il cestino è vuoto.</li>}
            {trashed.map((d) => (
              <li key={d.id} className="list-row">
                <div className="list-main">
                  <strong>{d.title}</strong>
                  {d.deleted_at && <span className="muted small">eliminato il {formatDate(d.deleted_at)}</span>}
                </div>
                {canEdit && (
                  <button className="btn" onClick={() => run(() => restoreDocument(course.id, d.id), `«${d.title}» ripristinato.`)}>
                    Ripristina
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <CourseForm
          course={course}
          onClose={() => setEditing(false)}
          onSubmit={async (input) => {
            const updated = await updateCourse(course.id, input)
            setCourse(updated)
            setEditing(false)
            notify('Corso aggiornato.')
          }}
        />
      )}

      {pendingImport && (
        <ImportTexModal
          fileTitle={pendingImport.title}
          parsed={pendingImport.parsed}
          courseHasPreamble={pendingImport.courseHasPreamble}
          onClose={() => setPendingImport(null)}
          onImport={runImport}
        />
      )}

      {creating && (
        <PromptModal
          title="Nuovo documento"
          label="Titolo"
          submitLabel="Crea"
          hint="Per esempio «Lezione 3 – Ricorsione» o «Capitolo 2 – Reti TCP/IP»."
          onClose={() => setCreating(false)}
          onSubmit={async (title) => {
            const doc = await createDocument(course.id, title, '', nickname)
            navigate(`/corsi/${course.slug}/${doc.slug}`)
          }}
        />
      )}

      {renaming && (
        <PromptModal
          title="Rinomina documento"
          label="Titolo"
          initial={renaming.title}
          submitLabel="Rinomina"
          onClose={() => setRenaming(null)}
          onSubmit={async (title) => {
            await renameDocument(course.id, renaming.id, title)
            setRenaming(null)
            await loadDocs()
          }}
        />
      )}
    </>
  )
}

/** Evidenzia nell'estratto le parole trovate (racchiuse tra « e » dal database). */
function renderSnippet(snippet: string) {
  return snippet.split(/«(.+?)»/g).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))
}

interface DocRowProps {
  doc: DocMeta
  index: number
  courseSlug: string
  canEdit: boolean
  onRename: () => void
  onDelete: () => void
}

function DocRow({ doc, index, courseSlug, canEdit, onRename, onDelete }: DocRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: doc.id, disabled: !canEdit })

  return (
    <li ref={setNodeRef} className={`list-row ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
      {canEdit && (
        <button className="drag-handle" aria-label={`Sposta «${doc.title}»`} {...attributes} {...listeners}>
          ⠿
        </button>
      )}
      <span className="row-index">{index}</span>
      <Link to={`/corsi/${courseSlug}/${doc.slug}`} className="list-main">
        <strong>{doc.title}</strong>
        <span className="muted small">
          Aggiornato il {formatDate(doc.updated_at)}
          {doc.updated_by && ` da ${doc.updated_by}`}
        </span>
      </Link>
      {canEdit && (
        <div className="row-actions">
          <button className="btn btn-ghost" onClick={onRename}>
            Rinomina
          </button>
          <button className="btn btn-ghost btn-danger-text" onClick={onDelete}>
            Elimina
          </button>
        </div>
      )}
    </li>
  )
}
