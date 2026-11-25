import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteImage, formatDate, listImages, type CourseImage } from '../lib/api'
import { forgetImage, imageUrl, uploadImageFile } from '../lib/images'
import { useApp } from '../lib/app-context'
import { Modal } from './Modal'

interface Props {
  courseId: string
  canEdit: boolean
  author: string | null
  /** Inserisce l'immagine nel documento, dove si trova il cursore. */
  onInsert: (name: string) => void
  /** Chiamata quando l'elenco cambia (caricamento o eliminazione), per aggiornare l'autocompletamento. */
  onChanged: (images: CourseImage[]) => void
  onClose: () => void
}

function Thumb({ image }: { image: CourseImage }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    imageUrl(image)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [image])
  return (
    <div className="image-thumb">
      {url ? <img src={url} alt={image.name} /> : <span className="muted small">{failed ? 'Non disponibile' : 'Carico…'}</span>}
    </div>
  )
}

const kb = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`)

export function ImagePanel({ courseId, canEdit, author, onInsert, onChanged, onClose }: Props) {
  const { notify, notifyError } = useApp()
  const [images, setImages] = useState<CourseImage[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const list = await listImages(courseId)
    setImages(list)
    onChanged(list)
  }, [courseId, onChanged])

  useEffect(() => {
    refresh().catch((e) => {
      notifyError(e)
      setImages([])
    })
    // si carica una volta all'apertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function upload(files: File[]) {
    if (files.length === 0) return
    setBusy(true)
    let done = 0
    for (const file of files) {
      try {
        await uploadImageFile(courseId, file, author)
        done++
      } catch (e) {
        notifyError(e)
      }
    }
    try {
      await refresh()
    } catch (e) {
      notifyError(e)
    }
    setBusy(false)
    if (done > 0) notify(done === 1 ? 'Immagine caricata.' : `${done} immagini caricate.`)
  }

  async function remove(image: CourseImage) {
    if (confirmId !== image.id) {
      setConfirmId(image.id)
      return
    }
    setConfirmId(null)
    try {
      await deleteImage(courseId, image.id)
      forgetImage(image.id)
      await refresh()
      notify(`«${image.name}» eliminata.`)
    } catch (e) {
      notifyError(e)
    }
  }

  return (
    <Modal title="Immagini del corso" onClose={onClose} wide>
      <p className="muted small">
        PNG o JPEG, ridimensionate da sole sotto 1 MB. Puoi anche incollarle (Cmd/Ctrl+V) o trascinarle direttamente nell’editor.
        {!canEdit && ' Per aggiungerne serve il codice di modifica del corso.'}
      </p>
      {canEdit && (
        <div className="image-toolbar">
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              void upload(files)
            }}
          />
          <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Carico…' : 'Carica immagini'}
          </button>
        </div>
      )}
      {images === null ? (
        <p className="muted">Caricamento…</p>
      ) : images.length === 0 ? (
        <div className="empty">
          <p>Nessuna immagine in questo corso.</p>
        </div>
      ) : (
        <ul className="image-grid">
          {images.map((image) => (
            <li key={image.id} className="image-card">
              <Thumb image={image} />
              <div className="image-meta">
                <code>{image.name}</code>
                <span className="muted small">
                  {image.width && image.height ? `${image.width}×${image.height} · ` : ''}
                  {kb(image.size)}
                </span>
                <span className="muted small">
                  {image.created_by ? `${image.created_by} · ` : ''}
                  {formatDate(image.created_at)}
                </span>
              </div>
              <div className="image-actions">
                {canEdit && (
                  <button className="btn btn-primary" onClick={() => onInsert(image.name)}>
                    Inserisci
                  </button>
                )}
                {canEdit && (
                  <button className={confirmId === image.id ? 'btn btn-danger' : 'btn'} onClick={() => void remove(image)} onBlur={() => setConfirmId(null)}>
                    {confirmId === image.id ? 'Conferma' : 'Elimina'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </Modal>
  )
}
