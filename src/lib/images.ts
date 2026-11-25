// Immagini dei corsi: ridimensionamento nel browser prima del caricamento,
// cache dei byte e raccolta dei file da passare al compilatore LaTeX.
import { getImageBytes, listImages, uploadImage, type CourseImage } from './api'

/** Peso massimo dopo il ridimensionamento (il server accetta fino a 1 MiB). */
const MAX_BYTES = 1_000_000
/** Lato massimo: più di così in un foglio A4 non si distingue. */
const MAX_SIDE = 1800

export interface PreparedImage {
  name: string
  mime: 'image/png' | 'image/jpeg'
  data: string
  width: number
  height: number
  size: number
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function render(bitmap: ImageBitmap, width: number, height: number, background?: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Il browser non riesce a elaborare le immagini.')
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  return canvas
}

/**
 * Porta un'immagine a PNG o JPEG sotto 1 MB: se è già adatta resta com'è, altrimenti
 * viene rimpicciolita (PNG se possibile, per tenere nitidi schemi e screenshot; poi JPEG).
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error(`«${file.name}» non è un'immagine.`)
  if (file.type === 'image/svg+xml') throw new Error('Gli SVG non si possono usare con pdfLaTeX: esportali in PNG e caricali di nuovo.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`Non riesco a leggere «${file.name}»: formato non supportato.`)
  }
  const isPng = file.type === 'image/png'
  const isJpeg = file.type === 'image/jpeg'
  const name = file.name || 'immagine'

  if ((isPng || isJpeg) && file.size <= MAX_BYTES && Math.max(bitmap.width, bitmap.height) <= 2400) {
    return { name, mime: file.type as PreparedImage['mime'], data: await toBase64(file), width: bitmap.width, height: bitmap.height, size: file.size }
  }

  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  for (let attempt = 0; attempt < 6; attempt++) {
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    if (!isJpeg) {
      const png = await canvasBlob(render(bitmap, width, height), 'image/png')
      if (png && png.size <= MAX_BYTES) return { name, mime: 'image/png', data: await toBase64(png), width, height, size: png.size }
    }
    const canvas = render(bitmap, width, height, '#ffffff')
    for (const quality of [0.9, 0.8, 0.7]) {
      const jpeg = await canvasBlob(canvas, 'image/jpeg', quality)
      if (jpeg && jpeg.size <= MAX_BYTES) return { name, mime: 'image/jpeg', data: await toBase64(jpeg), width, height, size: jpeg.size }
    }
    scale *= 0.75
  }
  throw new Error(`Non riesco a ridurre «${file.name}» sotto 1 MB: prova con un'immagine più piccola.`)
}

/** Ridimensiona e carica un file; restituisce l'immagine come salvata (il nome può cambiare). */
export async function uploadImageFile(courseId: string, file: File, author: string | null): Promise<CourseImage> {
  const prepared = await prepareImage(file)
  return uploadImage(courseId, prepared, author)
}

// ---------- Cache ----------

const bytesCache = new Map<string, Promise<Uint8Array>>()
const urlCache = new Map<string, Promise<string>>()

/** Byte di un'immagine; una volta scaricata non si riscarica (le immagini non cambiano). */
export function imageBytes(id: string): Promise<Uint8Array> {
  let p = bytesCache.get(id)
  if (!p) {
    p = getImageBytes(id)
    bytesCache.set(id, p)
    p.catch(() => bytesCache.delete(id))
  }
  return p
}

/** Indirizzo utilizzabile in un <img> per mostrare l'immagine. */
export function imageUrl(image: Pick<CourseImage, 'id' | 'mime'>): Promise<string> {
  let p = urlCache.get(image.id)
  if (!p) {
    p = imageBytes(image.id).then((bytes) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: image.mime })))
    urlCache.set(image.id, p)
    p.catch(() => urlCache.delete(image.id))
  }
  return p
}

export function forgetImage(id: string) {
  bytesCache.delete(id)
  const url = urlCache.get(id)
  urlCache.delete(id)
  void url?.then((u) => URL.revokeObjectURL(u)).catch(() => {})
}

// ---------- Uso nei documenti ----------

const INCLUDE = /\\includegraphics\*?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g

/** Codice da inserire nel documento per mostrare l'immagine. */
export const imageSnippet = (name: string) => `\\begin{center}\n  \\includegraphics[width=0.8\\linewidth]{${name}}\n\\end{center}\n`

/** Immagini richiamate dai testi con \includegraphics (anche senza estensione o con un percorso). */
export function referencedImages(texts: string[], images: CourseImage[]): CourseImage[] {
  const tokens = new Set<string>()
  for (const text of texts) {
    for (const m of text.matchAll(INCLUDE)) {
      const base = m[1].trim().split('/').pop()
      if (base) tokens.add(base)
    }
  }
  if (tokens.size === 0) return []
  return images.filter((i) => tokens.has(i.name) || tokens.has(i.name.replace(/\.[^.]+$/, '')))
}

/**
 * File da dare al compilatore per questi testi: solo le immagini effettivamente usate.
 * Senza \includegraphics non si interroga nemmeno il server.
 */
export async function filesForCompile(courseId: string, texts: string[]): Promise<Record<string, Uint8Array>> {
  if (!texts.some((t) => /\\includegraphics/.test(t))) return {}
  try {
    const used = referencedImages(texts, await listImages(courseId))
    const entries = await Promise.all(used.map(async (img) => [img.name, await imageBytes(img.id)] as const))
    return Object.fromEntries(entries)
  } catch {
    return {} // se le immagini non si scaricano, il compilatore segnalerà il file mancante
  }
}
