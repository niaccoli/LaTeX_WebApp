import { supabase } from './supabase'
import { getEditCode } from './local'

export interface Course {
  id: string
  slug: string
  name: string
  code: string | null
  academic_year: string
  teacher: string | null
  description: string
  is_locked: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface DocMeta {
  id: string
  course_id: string
  kind: 'doc' | 'preamble'
  slug: string
  title: string
  position: number
  updated_at: string
  updated_by: string | null
  deleted_at: string | null
}

export interface Doc extends DocMeta {
  content: string
  ystate: string | null
}

export interface CourseInput {
  name: string
  academic_year: string
  code: string
  teacher: string
  description: string
  /** Solo in creazione: 'split' = preambolo condiviso e documenti per capitolo (default); 'single' = un solo documento LaTeX completo. */
  layout?: 'split' | 'single'
}

/** Errore con un codice leggibile: RATE_LIMIT, EDIT_CODE, VALIDATION, TOO_LARGE, NOT_FOUND. */
export class ApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

function fail(error: { message: string; hint?: string | null }): never {
  const offline = /failed to fetch|networkerror|load failed/i.test(error.message)
  throw new ApiError(
    offline ? 'Connessione al server non riuscita. Controlla la rete e riprova.' : error.message || 'Errore imprevisto.',
    error.hint ?? undefined,
  )
}

/** Chiama una funzione del database. Se è indicato un corso, allega il codice di modifica salvato. */
async function rpc<T>(fn: string, args: Record<string, unknown>, courseId?: string): Promise<T> {
  const full = courseId ? { ...args, p_edit_code: getEditCode(courseId) } : args
  const { data, error } = await supabase.rpc(fn, full)
  if (error) fail(error)
  return data as T
}

const DOC_META = 'id,course_id,kind,slug,title,position,updated_at,updated_by,deleted_at'
const DOC_FULL = `${DOC_META},content,ystate`

// ---------- Corsi ----------

export async function listCourses(deleted = false): Promise<Course[]> {
  let q = supabase.from('courses').select('*')
  q = deleted ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null)
  const { data, error } = await q.order('name')
  if (error) fail(error)
  return data as Course[]
}

/** Cerca il corso per slug; se è stato rinominato, segue il reindirizzamento. */
export async function getCourseBySlug(slug: string): Promise<Course | null> {
  const { data, error } = await supabase.from('courses').select('*').eq('slug', slug).maybeSingle()
  if (error) fail(error)
  if (data) return data as Course
  const r = await supabase.from('slug_redirects').select('course_id').is('document_id', null).eq('old_slug', slug).maybeSingle()
  if (r.error) fail(r.error)
  if (!r.data) return null
  const c = await supabase.from('courses').select('*').eq('id', r.data.course_id).maybeSingle()
  if (c.error) fail(c.error)
  return (c.data as Course) ?? null
}

export function createCourse(input: CourseInput, editCode: string) {
  return rpc<Course>('create_course', {
    p_name: input.name,
    p_academic_year: input.academic_year,
    p_code: input.code,
    p_teacher: input.teacher,
    p_description: input.description,
    p_edit_code: editCode || null,
    p_layout: input.layout ?? 'split',
  })
}

export function updateCourse(id: string, input: CourseInput) {
  return rpc<Course>(
    'update_course',
    {
      p_id: id,
      p_name: input.name,
      p_academic_year: input.academic_year,
      p_code: input.code,
      p_teacher: input.teacher,
      p_description: input.description,
    },
    id,
  )
}

export const deleteCourse = (id: string) => rpc<void>('delete_course', { p_id: id }, id)
export const restoreCourse = (id: string) => rpc<void>('restore_course', { p_id: id }, id)

export function verifyEditCode(courseId: string, code: string) {
  return rpc<boolean>('verify_edit_code', { p_id: courseId, p_edit_code: code })
}

// ---------- Documenti ----------

export async function listDocuments(courseId: string): Promise<DocMeta[]> {
  const { data, error } = await supabase.from('documents').select(DOC_META).eq('course_id', courseId).order('position')
  if (error) fail(error)
  return data as DocMeta[]
}

/** Cerca il documento per slug nel corso; se è stato rinominato, segue il reindirizzamento. */
export async function getDocumentBySlug(courseId: string, slug: string): Promise<Doc | null> {
  const { data, error } = await supabase.from('documents').select(DOC_FULL).eq('course_id', courseId).eq('slug', slug).maybeSingle()
  if (error) fail(error)
  if (data) return data as Doc
  const r = await supabase
    .from('slug_redirects')
    .select('document_id')
    .eq('course_id', courseId)
    .eq('old_slug', slug)
    .not('document_id', 'is', null)
    .maybeSingle()
  if (r.error) fail(r.error)
  if (!r.data) return null
  const d = await supabase.from('documents').select(DOC_FULL).eq('id', r.data.document_id).maybeSingle()
  if (d.error) fail(d.error)
  return (d.data as Doc) ?? null
}

export async function getDocumentById(id: string): Promise<Doc | null> {
  const { data, error } = await supabase.from('documents').select(DOC_FULL).eq('id', id).maybeSingle()
  if (error) fail(error)
  return (data as Doc) ?? null
}

/** Chiave del canale di modifica in tempo reale: non nulla solo per i corsi protetti da codice. */
export function getChannelKey(courseId: string) {
  return rpc<string | null>('get_channel_key', { p_id: courseId }, courseId)
}

/** Sorgente del preambolo condiviso del corso (stringa vuota se manca). */
export async function getPreamble(courseId: string): Promise<string> {
  const { data, error } = await supabase.from('documents').select('content').eq('course_id', courseId).eq('kind', 'preamble').maybeSingle()
  if (error) fail(error)
  return (data?.content as string | undefined) ?? ''
}

export function createDocument(courseId: string, title: string, content: string, author: string | null) {
  return rpc<Doc>('create_document', { p_course_id: courseId, p_title: title, p_content: content, p_author: author }, courseId)
}

export const renameDocument = (courseId: string, id: string, title: string) =>
  rpc<Doc>('rename_document', { p_id: id, p_title: title }, courseId)
export const deleteDocument = (courseId: string, id: string) => rpc<void>('delete_document', { p_id: id }, courseId)
export const restoreDocument = (courseId: string, id: string) => rpc<void>('restore_document', { p_id: id }, courseId)
export const reorderDocuments = (courseId: string, ids: string[]) =>
  rpc<void>('reorder_documents', { p_course_id: courseId, p_ids: ids }, courseId)

export interface SaveResult {
  updated_at: string
  version_created: boolean
}

export function saveDocument(
  courseId: string,
  id: string,
  content: string,
  author: string | null,
  opts: { snapshot?: boolean; kind?: 'auto' | 'restore'; ystate?: string | null } = {},
) {
  return rpc<SaveResult>(
    'save_document',
    {
      p_id: id,
      p_content: content,
      p_ystate: opts.ystate ?? null,
      p_author: author,
      p_snapshot: opts.snapshot ?? false,
      p_kind: opts.kind ?? 'auto',
    },
    courseId,
  )
}

/** Tutti i documenti attivi del corso con il contenuto, in ordine (per l'esportazione). */
export async function listDocumentsWithContent(courseId: string): Promise<Doc[]> {
  const { data, error } = await supabase.from('documents').select(DOC_FULL).eq('course_id', courseId).is('deleted_at', null).order('position')
  if (error) fail(error)
  return data as Doc[]
}

export interface SearchHit {
  id: string
  slug: string
  title: string
  /** Estratto del testo; le parole trovate sono racchiuse tra « e ». */
  snippet: string
}

/** Ricerca nel testo dei documenti di un corso. */
export async function searchDocuments(courseId: string, query: string): Promise<SearchHit[]> {
  const { data, error } = await supabase.rpc('search_documents', { p_course_id: courseId, p_query: query })
  if (error) fail(error)
  return data as SearchHit[]
}

// ---------- Cronologia ----------

export interface VersionMeta {
  id: number
  author: string | null
  kind: 'auto' | 'restore' | 'import'
  created_at: string
}

/** Versioni salvate di un documento, dalla più recente (senza il contenuto). */
export async function listVersions(documentId: string): Promise<VersionMeta[]> {
  const { data, error } = await supabase
    .from('document_versions')
    .select('id,author,kind,created_at')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(300)
  if (error) fail(error)
  return data as VersionMeta[]
}

export async function getVersionContent(versionId: number): Promise<string> {
  const { data, error } = await supabase.from('document_versions').select('content').eq('id', versionId).single()
  if (error) fail(error)
  return data.content as string
}

// ---------- Immagini ----------

export interface CourseImage {
  id: string
  course_id: string
  /** Nome del file da usare in \includegraphics (es. grafo.png). */
  name: string
  mime: 'image/png' | 'image/jpeg'
  size: number
  width: number | null
  height: number | null
  created_by: string | null
  created_at: string
}

const IMAGE_META = 'id,course_id,name,mime,size,width,height,created_by,created_at'

/** Immagini del corso, dalla più recente (senza i dati). */
export async function listImages(courseId: string): Promise<CourseImage[]> {
  const { data, error } = await supabase.from('course_images').select(IMAGE_META).eq('course_id', courseId).order('created_at', { ascending: false })
  if (error) fail(error)
  return data as CourseImage[]
}

/** Carica un'immagine già ridimensionata (dati in base64). Il nome finale può cambiare se esiste già. */
export function uploadImage(
  courseId: string,
  image: { name: string; mime: string; data: string; width: number; height: number },
  author: string | null,
) {
  return rpc<CourseImage>(
    'upload_image',
    { p_course_id: courseId, p_name: image.name, p_mime: image.mime, p_data: image.data, p_width: image.width, p_height: image.height, p_author: author },
    courseId,
  )
}

export const deleteImage = (courseId: string, id: string) => rpc<void>('delete_image', { p_id: id }, courseId)

/** Byte dell'immagine. */
export async function getImageBytes(id: string): Promise<Uint8Array> {
  const { data, error } = await supabase.rpc('get_image_data', { p_id: id })
  if (error) fail(error)
  if (typeof data !== 'string') throw new ApiError('Immagine non trovata.', 'NOT_FOUND')
  const binary = atob(data)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

// ---------- Utilità ----------

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })
}
