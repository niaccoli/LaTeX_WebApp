import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { keymap } from '@codemirror/view'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getChannelKey, getDocumentById, getDocumentBySlug, getPreamble, listImages, saveDocument, type Doc } from '../lib/api'
import { buildSource, compileLatex, extractEnvironments, extractMacros, type LatexError } from '../lib/compiler'
import { DocSession, userColor } from '../lib/collab'
import { downloadPdf, downloadTex } from '../lib/export'
import { filesForCompile, imageSnippet, uploadImageFile } from '../lib/images'
import { usePresence } from '../lib/presence'
import { openChannel, supabase } from '../lib/supabase'
import { useApp } from '../lib/app-context'
import { useCourse, useEditAccess } from '../lib/hooks'
import { AccessBadge } from '../components/AccessBadge'
import { LatexEditor, type LatexEditorHandle } from '../components/LatexEditor'
import { numberingOffset } from '../lib/numbering'
import { PdfPreview } from '../components/PdfPreview'
import { HistoryPanel } from '../components/HistoryPanel'
import { ImagePanel } from '../components/ImagePanel'
import { PresenceBar } from '../components/PresenceBar'

/** Pausa nella scrittura dopo cui parte il salvataggio automatico (e la ricompilazione). */
const AUTOSAVE_PAUSE_MS = 2500
/** Durante una scrittura continua si salva comunque almeno con questa frequenza. */
const MAX_UNSAVED_MS = 60_000
/** Se chi sta scrivendo non salva (es. ha chiuso la scheda), dopo questo tempo salva chi ha ricevuto le modifiche. */
const REMOTE_FALLBACK_MS = 8000

type CompileState = { phase: 'idle' | 'running' | 'ok' | 'error'; note?: string }

export function DocumentPage() {
  const { courseSlug, docSlug } = useParams()
  const navigate = useNavigate()
  const { nickname, notify, notifyError } = useApp()
  const { course, loading: courseLoading } = useCourse(courseSlug)
  const access = useEditAccess(course)

  // Il documento caricato e l'indirizzo per cui è stato caricato: mentre si passa da un
  // documento a un altro non si deve mai usare quello precedente (né reindirizzare al suo slug)
  const [loadedDoc, setLoadedDoc] = useState<{ doc: Doc | null; forKey?: string }>({ doc: null })
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [compile, setCompile] = useState<CompileState>({ phase: 'idle' })
  const [errors, setErrors] = useState<LatexError[]>([])
  const [macros, setMacros] = useState<string[]>([])
  const [environments, setEnvironments] = useState<string[]>([])
  const [tab, setTab] = useState<'source' | 'preview'>('source')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [imagesOpen, setImagesOpen] = useState(false)
  const [imageNames, setImageNames] = useState<string[]>([])
  const [session, setSession] = useState<DocSession | null>(null)

  const editor = useRef<LatexEditorHandle>(null)
  const exportMenu = useRef<HTMLDetailsElement>(null)
  // Testo nell'editor e documento a cui appartiene; ultimo testo salvato sul server
  const content = useRef('')
  const contentFor = useRef<string | null>(null)
  const saved = useRef<{ id: string | null; text: string }>({ id: null, text: '' })
  const sessionRef = useRef<DocSession | null>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>()
  const fallbackTimer = useRef<ReturnType<typeof setTimeout>>()
  const lastSaveAt = useRef(Date.now())
  const savingNow = useRef(false)
  const saveQueued = useRef(false)
  const leavingInfo = useRef<{ docId: string; courseId: string; editable: boolean; author: string | null } | null>(null)
  const compiling = useRef(false)
  const compileAgain = useRef(false)
  /** Impronta dell'ultima compilazione riuscita (documento + sorgente + immagini): se non cambia, non si ricompila. */
  const lastBuild = useRef<{ key: string; phase: 'ok' | 'error' } | null>(null)

  const courseId = course?.id
  const urlKey = `${courseId}/${docSlug}`
  const fresh =
    loadedDoc.forKey === urlKey || (!!loadedDoc.doc && loadedDoc.doc.course_id === courseId && loadedDoc.doc.slug === docSlug)
  const doc = fresh ? loadedDoc.doc : null
  const docId = doc?.id
  const setDoc = useCallback((update: (prev: Doc | null) => Doc | null) => setLoadedDoc((s) => ({ ...s, doc: update(s.doc) })), [])
  const canEdit = access.canEdit && !!doc && !doc.deleted_at

  // Come ci vedono gli altri: nome e colore (cursore e pallino della presenza)
  const myName = nickname ?? 'Anonimo'
  const me = useMemo(() => ({ name: myName, ...userColor(myName) }), [myName])
  const people = usePresence(docId, { name: me.name, color: me.color, editing: canEdit })

  // Valori più recenti, per le funzioni richiamate da scorciatoie, timer ed eventi
  const latest = useRef({ course, doc, canEdit, nickname, me })
  latest.current = { course, doc, canEdit, nickname, me }
  if (course && doc) leavingInfo.current = { docId: doc.id, courseId: course.id, editable: canEdit, author: nickname }

  // ---------- Caricamento ----------
  useEffect(() => {
    if (courseLoading) return
    if (!courseId || !docSlug) {
      setLoading(false)
      return
    }
    // Dopo un reindirizzamento da uno slug vecchio il documento è già caricato
    const current = latest.current.doc
    if (current && current.course_id === courseId && current.slug === docSlug) return
    let cancelled = false
    setLoading(true)
    getDocumentBySlug(courseId, docSlug)
      .then((d) => {
        if (cancelled) return
        content.current = d?.content ?? ''
        contentFor.current = d?.id ?? null
        saved.current = { id: d?.id ?? null, text: d?.content ?? '' }
        setLoadedDoc({ doc: d, forKey: `${courseId}/${docSlug}` })
        setDirty(false)
        setPdf(null)
        setErrors([])
        setCompile({ phase: 'idle' })
      })
      .catch((e) => {
        if (cancelled) return
        setLoadedDoc({ doc: null, forKey: `${courseId}/${docSlug}` })
        notifyError(e)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [courseId, courseLoading, docSlug, notifyError])

  // Slug vecchi (corso o documento rinominati) → URL attuale
  useEffect(() => {
    if (!course || !doc) return
    document.title = `${doc.title} · ${course.name}`
    if (course.slug !== courseSlug || doc.slug !== docSlug) navigate(`/corsi/${course.slug}/${doc.slug}`, { replace: true })
  }, [course, doc, courseSlug, docSlug, navigate])

  // ---------- Compilazione ----------
  const runCompile = useCallback(async () => {
    const d = latest.current.doc
    if (!d) return
    if (compiling.current) {
      compileAgain.current = true
      return
    }
    compiling.current = true
    setCompile({ phase: 'running', note: 'Compilazione…' })
    try {
      const text = contentFor.current === d.id ? content.current : d.content
      let preamble = ''
      if (d.kind === 'doc') {
        preamble = await getPreamble(d.course_id)
        // Senza preambolo condiviso (documento unico) le macro si prendono dal documento stesso
        const defs = preamble.trim() ? preamble : text
        setMacros(extractMacros(defs))
        setEnvironments(extractEnvironments(defs))
      }
      const offset = d.kind === 'doc' && preamble.trim() ? await numberingOffset(d.course_id, d.id) : undefined
      const built = buildSource(text, preamble, d.kind, offset)
      // Le immagini usate (anche nel preambolo) vanno date al compilatore insieme al sorgente
      const files = await filesForCompile(d.course_id, [text, preamble])
      const key = `${d.id}\u0000${built.source}\u0000${Object.entries(files).map(([n, b]) => `${n}:${b.length}`).join(',')}`
      if (lastBuild.current?.key === key) {
        // Sorgente identico all'ultima compilazione: il PDF è già aggiornato
        setCompile({ phase: lastBuild.current.phase })
        return
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('La compilazione sta impiegando troppo (oltre 3 minuti). Riprova o dividi il documento in capitoli.')), 180_000)
      })
      let result: Awaited<ReturnType<typeof compileLatex>>
      try {
        result = await Promise.race([compileLatex(built.source, (note) => setCompile({ phase: 'running', note }), files), timeout])
      } finally {
        clearTimeout(timer)
      }
      if (latest.current.doc?.id !== d.id) return // nel frattempo si è passati a un altro documento
      const located = result.errors.map(built.locate)
      setErrors(located)
      editor.current?.setErrors(located.filter((e) => e.where === 'doc'))
      if (result.pdf) setPdf(result.pdf)
      const phase = result.pdf && located.length === 0 ? 'ok' : 'error'
      lastBuild.current = { key, phase }
      setCompile({ phase })
    } catch (e) {
      setErrors([{ line: null, where: 'other', message: e instanceof Error ? e.message : 'Compilazione non riuscita.' }])
      setCompile({ phase: 'error' })
    } finally {
      compiling.current = false
      if (compileAgain.current) {
        compileAgain.current = false
        void runCompile()
      }
    }
  }, [])

  // Nomi delle immagini del corso, proposti nell'autocompletamento di \includegraphics
  useEffect(() => {
    if (!courseId) return
    let cancelled = false
    listImages(courseId)
      .then((list) => !cancelled && setImageNames(list.map((i) => i.name)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [courseId])

  /** Immagini incollate o trascinate nell'editor: si caricano e si inserisce il codice dove sta il cursore. */
  const addImages = useCallback(
    async (files: File[]) => {
      const { course: c, nickname: author, canEdit: editable } = latest.current
      if (!c || !editable) return
      for (const file of files) {
        try {
          const image = await uploadImageFile(c.id, file, author)
          editor.current?.insertText(imageSnippet(image.name))
          setImageNames((names) => [...names.filter((n) => n !== image.name), image.name])
          notify(`Immagine «${image.name}» inserita.`)
        } catch (e) {
          notifyError(e)
        }
      }
    },
    [notify, notifyError],
  )

  const onImagesChanged = useCallback((list: { name: string }[]) => setImageNames(list.map((i) => i.name)), [])

  // Prima compilazione all'apertura del documento
  useEffect(() => {
    if (docId) void runCompile()
  }, [docId, runCompile])

  // ---------- Salvataggio: salva (creando una versione) e ricompila ----------
  // Parte da solo dopo una pausa nella scrittura, oppure subito con il pulsante o Cmd/Ctrl+S.
  const save = useCallback(
    async (opts: { snapshot?: boolean; kind?: 'restore' } = {}) => {
      clearTimeout(autosaveTimer.current)
      clearTimeout(fallbackTimer.current)
      const { course: c, doc: d, canEdit: editable, nickname: author } = latest.current
      if (!c || !d || contentFor.current !== d.id) return
      const text = content.current
      if (editable && (text !== saved.current.text || opts.kind === 'restore')) {
        if (savingNow.current) {
          saveQueued.current = true
          return
        }
        savingNow.current = true
        setSaving(true)
        try {
          // Testo e stato di sincronizzazione vengono salvati insieme, così restano allineati
          const live = sessionRef.current?.docId === d.id ? sessionRef.current : null
          const result = await saveDocument(c.id, d.id, text, author, { snapshot: opts.snapshot ?? true, kind: opts.kind, ystate: live?.encodeState() })
          saved.current = { id: d.id, text }
          lastSaveAt.current = Date.now()
          setDoc((prev) => (prev && prev.id === d.id ? { ...prev, content: text, updated_at: result.updated_at, updated_by: author } : prev))
          if (contentFor.current === d.id) setDirty(content.current !== text)
        } catch (e) {
          notifyError(e)
          return
        } finally {
          savingNow.current = false
          setSaving(false)
        }
        if (saveQueued.current) {
          // Nel frattempo è arrivata un'altra richiesta: salva di nuovo il testo più recente
          saveQueued.current = false
          void save()
          return
        }
      }
      void runCompile()
    },
    [notifyError, runCompile, setDoc],
  )

  /** Chiamata a ogni modifica del testo nell'editor, propria o ricevuta da altri. */
  const onEdit = useCallback(
    (value: string) => {
      const { doc: d, canEdit: editable } = latest.current
      if (!d) return
      const remote = sessionRef.current?.applyingRemote === true
      const wasClean = content.current === saved.current.text
      content.current = value
      contentFor.current = d.id
      setDirty(value !== saved.current.text)
      if (!editable) return
      if (remote) {
        // Di norma salva chi ha scritto; questo timer copre il caso in cui non lo faccia
        clearTimeout(fallbackTimer.current)
        fallbackTimer.current = setTimeout(() => void save({ snapshot: false }), REMOTE_FALLBACK_MS + Math.random() * 4000)
        return
      }
      if (wasClean) lastSaveAt.current = Date.now()
      clearTimeout(autosaveTimer.current)
      if (Date.now() - lastSaveAt.current > MAX_UNSAVED_MS) {
        // Scrittura continua da molto: salva comunque, senza forzare una nuova versione
        void save({ snapshot: false })
      } else {
        autosaveTimer.current = setTimeout(() => void save(), AUTOSAVE_PAUSE_MS)
      }
    },
    [save],
  )

  // Uscendo dal documento (o passando a un altro) salva subito le modifiche in sospeso.
  // Va dichiarato prima dell'effetto della sessione, così qui la sessione è ancora viva.
  useEffect(() => {
    if (!docId) return
    return () => {
      clearTimeout(autosaveTimer.current)
      clearTimeout(fallbackTimer.current)
      const leaving = leavingInfo.current
      if (!leaving || leaving.docId !== docId || !leaving.editable) return
      if (contentFor.current === docId && saved.current.id === docId && content.current !== saved.current.text) {
        const text = content.current
        const live = sessionRef.current?.docId === docId ? sessionRef.current : null
        saved.current = { id: docId, text }
        void saveDocument(leaving.courseId, docId, text, leaving.author, { snapshot: true, ystate: live?.encodeState() }).catch(() => {})
      }
    }
  }, [docId])

  // ---------- Tempo reale: sessione di scrittura condivisa (solo per chi può modificare) ----------
  useEffect(() => {
    if (!docId || !courseId || !canEdit) return
    let cancelled = false
    let opened: DocSession | null = null
    void (async () => {
      const { doc: d, course: c, me: user } = latest.current
      if (!d || !c || d.id !== docId) return
      const channelKey = c.is_locked ? await getChannelKey(c.id) : null
      if (cancelled) return
      const text = contentFor.current === d.id ? content.current : d.content
      const s = await DocSession.open(d.id, { content: text, ystate: d.ystate }, user, channelKey)
      if (cancelled) {
        s.destroy()
        return
      }
      opened = s
      sessionRef.current = s
      setSession(s)
    })().catch(notifyError)
    return () => {
      cancelled = true
      opened?.destroy()
      sessionRef.current = null
      setSession(null)
    }
  }, [docId, courseId, canEdit, notifyError])

  useEffect(() => {
    session?.setUser(me)
  }, [session, me])

  // Qualcuno ha salvato il documento (o l'ha rinominato, eliminato…): riallinea e ricompila
  const onRowChanged = useCallback(
    async (id: string) => {
      let row: Doc | null
      try {
        row = await getDocumentById(id)
      } catch {
        return
      }
      if (!row || latest.current.doc?.id !== id) return
      const fromServer = row
      setDoc((prev) => (prev && prev.id === id ? { ...prev, ...fromServer } : prev))
      if (fromServer.content === saved.current.text) return
      saved.current = { id, text: fromServer.content }
      clearTimeout(fallbackTimer.current)
      if (!sessionRef.current) {
        // Sola lettura: il testo arriva solo a ogni salvataggio altrui
        content.current = fromServer.content
        contentFor.current = id
        editor.current?.setValue(fromServer.content)
      }
      setDirty(content.current !== fromServer.content)
      void runCompile()
    },
    [runCompile, setDoc],
  )

  useEffect(() => {
    if (!docId) return
    let cancelled = false
    let channel: RealtimeChannel | null = null
    void openChannel(`doc-row:${docId}`).then((opened) => {
      if (cancelled) {
        void supabase.removeChannel(opened)
        return
      }
      channel = opened
      opened.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'documents', filter: `id=eq.${docId}` }, () => void onRowChanged(docId)).subscribe()
    })
    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [docId, onRowChanged])

  const restoreVersion = useCallback(
    async (text: string) => {
      editor.current?.setValue(text)
      await save({ kind: 'restore' })
      setHistoryOpen(false)
    },
    [save],
  )

  // Cmd/Ctrl+S anche quando il cursore non è nell'editor
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  // Avviso se si chiude la scheda con modifiche non salvate
  useEffect(() => {
    if (!dirty || !canEdit) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, canEdit])

  // La sessione vale solo per il documento per cui è stata aperta
  const liveSession = session && session.docId === docId ? session : null
  const collabExtensions = useMemo(
    () => (liveSession ? [yCollab(liveSession.ytext, liveSession.awareness, { undoManager: liveSession.undoManager }), keymap.of(yUndoManagerKeymap)] : undefined),
    [liveSession],
  )

  if (courseLoading || loading || !fresh) return <p className="muted pad">Caricamento…</p>
  if (!course || !doc) {
    return (
      <div className="empty pad">
        <p>Documento non trovato.</p>
        <Link to={course ? `/corsi/${course.slug}` : '/'}>Torna indietro</Link>
      </div>
    )
  }

  const status = saving
    ? 'Salvataggio…'
    : compile.phase === 'running'
      ? (compile.note ?? 'Compilazione…')
      : dirty
        ? canEdit
          ? 'Modifiche in corso…'
          : 'Sola lettura'
        : compile.phase === 'error'
          ? `${errors.length} ${errors.length === 1 ? 'errore' : 'errori'} di compilazione`
          : compile.phase === 'ok'
            ? 'Salvato · PDF aggiornato'
            : 'Salvato'
  const statusKind = compile.phase === 'error' && !dirty && !saving ? 'bad' : dirty ? 'warn' : 'ok'

  function jumpTo(error: LatexError) {
    if (error.where === 'doc' && error.line) {
      setTab('source')
      // Aspetta che il pannello del sorgente sia visibile (su schermi stretti è una scheda)
      requestAnimationFrame(() => editor.current?.goToLine(error.line!))
    } else if (error.where === 'preamble' && course) {
      navigate(`/corsi/${course.slug}/preambolo`)
    }
  }

  return (
    <div className="editor-page">
      <div className="editor-bar">
        <div className="editor-title">
          <nav className="breadcrumb">
            <Link to="/">Corsi</Link> <span>/</span> <Link to={`/corsi/${course.slug}`}>{course.name}</Link>
          </nav>
          <h1>{doc.title}</h1>
        </div>
        <div className="editor-actions">
          <PresenceBar people={people} />
          <span className={`status status-${statusKind}`} role="status">
            {status}
          </span>
          {doc.kind === 'doc' && (
            <button className="btn" onClick={() => setImagesOpen(true)}>
              Immagini
            </button>
          )}
          <button className="btn" onClick={() => setHistoryOpen(true)}>
            Cronologia
          </button>
          <details className="menu" ref={exportMenu}>
            <summary className="btn">Esporta</summary>
            <div className="menu-items">
              <button
                onClick={() => {
                  downloadTex(doc, contentFor.current === doc.id ? content.current : doc.content)
                  exportMenu.current?.removeAttribute('open')
                }}
              >
                Sorgente (.tex)
              </button>
              <button
                disabled={!pdf}
                title={pdf ? undefined : 'Disponibile dopo una compilazione riuscita'}
                onClick={() => {
                  if (pdf) downloadPdf(doc, pdf)
                  exportMenu.current?.removeAttribute('open')
                }}
              >
                PDF
              </button>
            </div>
          </details>
          <button className="btn btn-primary" disabled={saving || compile.phase === 'running'} onClick={() => void save()} title="Cmd/Ctrl + S">
            {canEdit ? 'Salva e compila' : 'Ricompila'}
          </button>
        </div>
      </div>

      {(access.locked || doc.deleted_at) && (
        <div className="editor-notices">
          <AccessBadge {...access} />
          {doc.deleted_at && <div className="access">Questo documento è nel cestino del corso.</div>}
        </div>
      )}

      <div className="pane-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'source'} onClick={() => setTab('source')}>
          Sorgente
        </button>
        <button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>
          Anteprima PDF{errors.length > 0 && ` (${errors.length})`}
        </button>
      </div>

      <div className="panes" data-tab={tab}>
        <section className="pane pane-source" aria-label="Sorgente LaTeX">
          {canEdit && !liveSession ? (
            <div className="pdf-empty">
              <p>Connessione al documento…</p>
            </div>
          ) : (
            <LatexEditor
              key={liveSession ? `${doc.id}:live` : `${doc.id}:readonly`}
              ref={editor}
              initialValue={liveSession ? liveSession.ytext.toString() : contentFor.current === doc.id ? content.current : doc.content}
              readOnly={!canEdit}
              macros={macros}
              environments={environments}
              images={imageNames}
              onImageFiles={canEdit ? (files) => void addImages(files) : undefined}
              onChange={onEdit}
              onSave={() => void save()}
              extensions={collabExtensions}
            />
          )}
        </section>

        <section className="pane pane-preview" aria-label="Anteprima PDF">
          {pdf ? (
            <PdfPreview data={pdf} />
          ) : (
            <div className="pdf-empty">
              {compile.phase === 'running' ? (
                <p>{compile.note ?? 'Compilazione…'}</p>
              ) : compile.phase === 'error' ? (
                <p>Il PDF non è stato generato: correggi gli errori qui sotto e salva di nuovo.</p>
              ) : (
                <p>L’anteprima compare dopo la prima compilazione.</p>
              )}
            </div>
          )}
          {errors.length > 0 && (
            <div className="errors" role="alert">
              <strong>
                {errors.length} {errors.length === 1 ? 'errore' : 'errori'}
                {pdf && ' · il PDF mostrato è l’ultimo compilato senza errori'}
              </strong>
              <ul>
                {errors.map((e, i) => (
                  <li key={i}>
                    {e.line && e.where !== 'other' ? (
                      <button className="link" onClick={() => jumpTo(e)}>
                        {e.where === 'preamble' ? `Preambolo, riga ${e.line}` : `Riga ${e.line}`}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {imagesOpen && (
        <ImagePanel
          courseId={course.id}
          canEdit={canEdit}
          author={nickname}
          onChanged={onImagesChanged}
          onInsert={(name) => {
            setImagesOpen(false)
            requestAnimationFrame(() => editor.current?.insertText(imageSnippet(name)))
          }}
          onClose={() => setImagesOpen(false)}
        />
      )}

      {historyOpen && (
        <HistoryPanel documentId={doc.id} current={content.current} canEdit={canEdit} onRestore={restoreVersion} onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  )
}
