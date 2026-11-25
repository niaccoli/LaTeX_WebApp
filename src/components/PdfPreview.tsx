import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

/**
 * Mostra il PDF compilato disegnando le pagine su canvas con pdf.js.
 * Rispetto a un <iframe>, funziona anche su tablet e mantiene la posizione
 * di scorrimento quando il PDF viene ricompilato. In alto c'è una barra con
 * pagina corrente/totale e zoom; i link del PDF (indice, riferimenti, URL) sono cliccabili.
 */
export function PdfPreview({ data }: { data: Uint8Array | null }) {
  const container = useRef<HTMLDivElement>(null)
  const boxes = useRef<HTMLDivElement[]>([])
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageDraft, setPageDraft] = useState<string | null>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setWidth(Math.round(el.clientWidth)), 150)
    })
    observer.observe(el)
    setWidth(Math.round(el.clientWidth))
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  /** Scorre fino a una pagina (e, se noto, a un punto della pagina in pixel dall'alto). */
  const scrollToPage = useCallback((n: number, offsetY = 0) => {
    const el = container.current
    const box = boxes.current[n - 1]
    if (!el || !box) return
    el.scrollTo({ top: Math.max(0, box.offsetTop + offsetY - 12), behavior: 'smooth' })
  }, [])

  // Pagina corrente = quella che occupa il centro del riquadro
  useEffect(() => {
    const el = container.current
    if (!el) return
    let frame = 0
    const update = () => {
      frame = 0
      const middle = el.scrollTop + el.clientHeight / 2
      const list = boxes.current
      let current = 1
      for (let i = 0; i < list.length; i++) {
        if (list[i].offsetTop <= middle) current = i + 1
        else break
      }
      setPage(current)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    const el = container.current
    if (!el || !data || width < 50) return
    let cancelled = false
    let observer: IntersectionObserver | undefined
    // pdf.js prende possesso del buffer: gliene passiamo una copia
    const task = pdfjs.getDocument({ data: data.slice() })

    void (async () => {
      try {
        const pdf = await task.promise
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const cssWidth = Math.round(Math.min(width - 32, 900) * zoom)
        const first = await pdf.getPage(1)
        const cssHeight = first.getViewport({ scale: cssWidth / first.getViewport({ scale: 1 }).width }).height

        // Segnaposto per tutte le pagine: si disegnano solo quelle visibili (o vicine)
        const holders: HTMLDivElement[] = []
        for (let n = 1; n <= pdf.numPages; n++) {
          const box = document.createElement('div')
          box.className = 'pdf-page'
          box.dataset.page = String(n)
          box.style.width = `${cssWidth}px`
          box.style.height = `${cssHeight}px`
          box.setAttribute('role', 'img')
          box.setAttribute('aria-label', `Pagina ${n} di ${pdf.numPages}`)
          holders.push(box)
        }
        if (cancelled) return
        const ratioTop = el.scrollHeight > 0 ? el.scrollTop / el.scrollHeight : 0
        boxes.current = holders
        el.replaceChildren(...holders)
        el.scrollTop = ratioTop * el.scrollHeight
        setTotal(pdf.numPages)

        const goTo = async (dest: unknown) => {
          try {
            const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : (dest as unknown[] | null)
            if (!explicit) return
            const ref = explicit[0]
            const index = typeof ref === 'object' && ref !== null ? await pdf.getPageIndex(ref as never) : Number(ref)
            const target = await pdf.getPage(index + 1)
            const view = target.getViewport({ scale: cssWidth / target.getViewport({ scale: 1 }).width })
            const kind = (explicit[1] as { name?: string } | null)?.name
            let y = 0
            if (kind === 'XYZ' && typeof explicit[3] === 'number') y = view.convertToViewportPoint(0, explicit[3])[1]
            else if ((kind === 'FitH' || kind === 'FitBH') && typeof explicit[2] === 'number') y = view.convertToViewportPoint(0, explicit[2])[1]
            scrollToPage(index + 1, Math.max(0, y))
          } catch {
            /* destinazione non valida: si ignora */
          }
        }

        const drawn = new Set<number>()
        const draw = async (n: number) => {
          if (drawn.has(n) || cancelled) return
          drawn.add(n)
          const p = await pdf.getPage(n)
          const sc = cssWidth / p.getViewport({ scale: 1 }).width
          const viewport = p.getViewport({ scale: sc * ratio })
          const box = holders[n - 1]
          box.style.height = `${viewport.height / ratio}px`
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.cssText = 'display:block;width:100%;height:100%'
          const context = canvas.getContext('2d')
          if (!context || cancelled) return
          await p.render({ canvasContext: context, viewport }).promise
          if (cancelled) return
          box.replaceChildren(canvas)
          // Link: indice, riferimenti incrociati, URL
          const css = p.getViewport({ scale: sc })
          for (const a of await p.getAnnotations()) {
            if (a.subtype !== 'Link' || !a.rect) continue
            const [x1, y1, x2, y2] = css.convertToViewportRectangle(a.rect)
            const link = document.createElement('a')
            link.className = 'pdf-link'
            link.style.left = `${Math.min(x1, x2)}px`
            link.style.top = `${Math.min(y1, y2)}px`
            link.style.width = `${Math.abs(x2 - x1)}px`
            link.style.height = `${Math.abs(y2 - y1)}px`
            if (a.url && /^(https?:|mailto:)/i.test(a.url)) {
              link.href = a.url
              link.target = '_blank'
              link.rel = 'noopener noreferrer'
            } else if (a.dest) {
              link.href = '#'
              const dest = a.dest
              link.addEventListener('click', (ev) => {
                ev.preventDefault()
                void goTo(dest)
              })
            } else continue
            box.appendChild(link)
          }
        }
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) void draw(Number((entry.target as HTMLElement).dataset.page)).catch(() => undefined)
            }
          },
          { root: el, rootMargin: '600px 0px' },
        )
        holders.forEach((h) => observer?.observe(h))
      } catch (e) {
        if (!cancelled) console.error('Anteprima PDF non riuscita', e)
      }
    })()

    return () => {
      cancelled = true
      observer?.disconnect()
      void task.destroy()
    }
  }, [data, width, zoom, scrollToPage])

  const stepZoom = (dir: 1 | -1) => {
    const i = ZOOM_STEPS.findIndex((z) => z >= zoom - 0.001)
    const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i < 0 ? ZOOM_STEPS.length - 1 : i) + dir))
    setZoom(ZOOM_STEPS[next])
  }

  const commitPage = () => {
    const n = Math.round(Number(pageDraft))
    setPageDraft(null)
    if (Number.isFinite(n) && n >= 1 && n <= total) scrollToPage(n)
  }

  return (
    <div className="pdf-wrap">
      <div className="pdf-toolbar" role="toolbar" aria-label="Controlli anteprima">
        <span className="pdf-pager">
          <input
            className="pdf-page-input"
            inputMode="numeric"
            aria-label="Numero di pagina"
            value={pageDraft ?? String(total ? page : 0)}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setPageDraft(e.target.value.replace(/\D/g, ''))}
            onBlur={() => setPageDraft(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitPage()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') e.currentTarget.blur()
            }}
          />
          <span aria-label={`su ${total} pagine`}>/ {total}</span>
        </span>
        <span className="pdf-zoom">
          <button type="button" className="btn btn-ghost" onClick={() => stepZoom(-1)} disabled={zoom <= ZOOM_STEPS[0]} aria-label="Riduci zoom">
            −
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setZoom(1)} title="Adatta alla larghezza" aria-label="Ripristina zoom">
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => stepZoom(1)}
            disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            aria-label="Aumenta zoom"
          >
            +
          </button>
        </span>
      </div>
      <div ref={container} className="pdf-view" />
    </div>
  )
}
