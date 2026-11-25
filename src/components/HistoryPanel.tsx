import { useEffect, useMemo, useRef, useState } from 'react'
import { diffLines } from 'diff'
import { formatDate, getVersionContent, listVersions, type VersionMeta } from '../lib/api'
import { Modal } from './Modal'

interface Props {
  documentId: string
  /** Testo attualmente nell'editor. */
  current: string
  canEdit: boolean
  onRestore: (content: string) => Promise<void>
  onClose: () => void
}

interface Row {
  type: 'add' | 'del' | 'same' | 'gap'
  text: string
}

const CONTEXT = 3

/** Confronto riga per riga; i tratti lunghi senza differenze vengono ripiegati. */
function buildRows(from: string, to: string): { rows: Row[]; added: number; removed: number } {
  const rows: Row[] = []
  let added = 0
  let removed = 0
  const parts = diffLines(from, to)
  parts.forEach((part, index) => {
    const lines = part.value.replace(/\n$/, '').split('\n')
    if (part.added || part.removed) {
      if (part.added) added += lines.length
      else removed += lines.length
      for (const text of lines) rows.push({ type: part.added ? 'add' : 'del', text })
      return
    }
    const first = index === 0
    const last = index === parts.length - 1
    const head = first ? 0 : CONTEXT
    const tail = last ? 0 : CONTEXT
    if (lines.length <= head + tail + 1) {
      for (const text of lines) rows.push({ type: 'same', text })
    } else {
      for (const text of lines.slice(0, head)) rows.push({ type: 'same', text })
      const hidden = lines.length - head - tail
      rows.push({ type: 'gap', text: `${hidden} ${hidden === 1 ? 'riga uguale' : 'righe uguali'}` })
      for (const text of lines.slice(lines.length - tail)) rows.push({ type: 'same', text })
    }
  })
  return { rows, added, removed }
}

const KIND_LABEL: Record<VersionMeta['kind'], string> = { auto: '', restore: 'ripristino', import: 'versione iniziale' }

export function HistoryPanel({ documentId, current, canEdit, onRestore, onClose }: Props) {
  const [versions, setVersions] = useState<VersionMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [compareTo, setCompareTo] = useState<'current' | number>('current')
  const [contents, setContents] = useState<Record<number, string>>({})
  const [restoring, setRestoring] = useState(false)
  const requested = useRef(new Set<number>())

  useEffect(() => {
    listVersions(documentId)
      .then((list) => {
        setVersions(list)
        if (list.length > 0) setSelected(list[0].id)
      })
      .catch((e: Error) => setError(e.message))
  }, [documentId])

  // Scarica il contenuto delle versioni coinvolte nel confronto (una volta sola ciascuna)
  useEffect(() => {
    for (const id of [selected, compareTo]) {
      if (typeof id !== 'number' || requested.current.has(id)) continue
      requested.current.add(id)
      getVersionContent(id)
        .then((text) => setContents((c) => ({ ...c, [id]: text })))
        .catch((e: Error) => {
          requested.current.delete(id)
          setError(e.message)
        })
    }
  }, [selected, compareTo])

  const fromText = selected !== null ? contents[selected] : undefined
  const toText = compareTo === 'current' ? current : contents[compareTo]
  const diff = useMemo(() => (fromText !== undefined && toText !== undefined ? buildRows(fromText, toText) : null), [fromText, toText])

  const label = (v: VersionMeta) => `${formatDate(v.created_at)} · ${v.author || 'Anonimo'}`
  const selectedVersion = versions?.find((v) => v.id === selected)
  const sameAsCurrent = fromText !== undefined && fromText === current

  async function restore() {
    if (fromText === undefined || restoring) return
    setRestoring(true)
    setError(null)
    try {
      await onRestore(fromText)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ripristino non riuscito.')
      setRestoring(false)
    }
  }

  return (
    <Modal title="Cronologia delle versioni" onClose={onClose} wide>
      <p className="muted small">
        Si conservano le ultime 5 versioni dell’ultima sessione di lavoro e l’ultima versione di ciascuna delle 5 sessioni precedenti (una nuova sessione
        inizia dopo una pausa di almeno 6 ore). Le versioni più vecchie vengono eliminate in automatico.
      </p>
      {error && <p className="form-error">{error}</p>}
      {!versions && !error && <p className="muted">Caricamento…</p>}
      {versions?.length === 0 && <p className="empty">Non ci sono ancora versioni salvate: compaiono dopo le prime modifiche.</p>}

      {versions && versions.length > 0 && (
        <div className="history">
          <ul className="history-list" aria-label="Versioni">
            {versions.map((v) => (
              <li key={v.id}>
                <button className={v.id === selected ? 'history-item active' : 'history-item'} aria-pressed={v.id === selected} onClick={() => setSelected(v.id)}>
                  <strong>{formatDate(v.created_at)}</strong>
                  <span className="muted small">
                    {v.author || 'Anonimo'}
                    {KIND_LABEL[v.kind] && ` · ${KIND_LABEL[v.kind]}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="history-diff">
            <div className="history-head">
              <label>
                <span className="muted small">Confronta la versione scelta con</span>
                <select value={String(compareTo)} onChange={(e) => setCompareTo(e.target.value === 'current' ? 'current' : Number(e.target.value))}>
                  <option value="current">il testo attuale</option>
                  {versions
                    .filter((v) => v.id !== selected)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {label(v)}
                      </option>
                    ))}
                </select>
              </label>
              {diff && (
                <span className="small">
                  <span className="diff-plus">+{diff.added}</span> <span className="diff-minus">−{diff.removed}</span> righe
                </span>
              )}
            </div>

            <div className="diff" aria-label="Differenze">
              {!diff && <p className="muted pad">Caricamento del confronto…</p>}
              {diff && diff.added === 0 && diff.removed === 0 && <p className="muted pad">Nessuna differenza: i due testi sono identici.</p>}
              {diff &&
                (diff.added > 0 || diff.removed > 0) &&
                diff.rows.map((row, i) => (
                  <div key={i} className={`diff-row diff-${row.type}`}>
                    <span className="diff-sign">{row.type === 'add' ? '+' : row.type === 'del' ? '−' : row.type === 'gap' ? '⋯' : ''}</span>
                    <span className="diff-text">{row.text || ' '}</span>
                  </div>
                ))}
            </div>

            <div className="form-actions">
              <span className="muted small history-note">
                Verde: righe presenti solo {compareTo === 'current' ? 'nel testo attuale' : 'nell’altra versione'}. Rosso: righe presenti solo nella versione scelta.
              </span>
              <button className="btn" onClick={onClose}>
                Chiudi
              </button>
              {canEdit && (
                <button className="btn btn-primary" disabled={!selectedVersion || fromText === undefined || sameAsCurrent || restoring} onClick={restore}>
                  {restoring ? 'Ripristino…' : sameAsCurrent ? 'È già il testo attuale' : 'Ripristina questa versione'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
