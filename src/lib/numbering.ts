import { listDocumentsWithContent, type Doc } from './api'
import { isStandalone, startsWithHeading } from './export'

export interface NumberingOffset {
  chapter: number
  section: number
}

/** Toglie commenti e ambienti verbatim, così non si contano titoli che non sono veri titoli. */
function plain(text: string): string {
  return text
    .replace(/\\begin\{(verbatim|lstlisting|minted)\}[\s\S]*?\\end\{\1\}/g, '')
    .replace(/(^|[^\\])%.*$/gm, '$1')
}

const count = (text: string, re: RegExp) => (plain(text).match(re) ?? []).length

let cache: { courseId: string; at: number; docs: Doc[] } | null = null

/**
 * Numerazione con cui comincia un documento nel PDF completo del corso: i titoli dei documenti
 * precedenti (\chapter, \section) contano, perché il PDF completo prosegue la numerazione.
 * Chi non comincia con un titolo viene introdotto da una «parte» e riparte da zero (come in fullcourse.ts).
 */
export async function numberingOffset(courseId: string, docId: string): Promise<NumberingOffset> {
  const none = { chapter: 0, section: 0 }
  try {
    if (!cache || cache.courseId !== courseId || Date.now() - cache.at > 20_000) {
      cache = { courseId, at: Date.now(), docs: await listDocumentsWithContent(courseId) }
    }
    const lessons = cache.docs.filter((d) => d.kind === 'doc' && !isStandalone(d.content))
    const index = lessons.findIndex((d) => d.id === docId)
    if (index <= 0 || !startsWithHeading(lessons[index].content)) return none
    let chapter = 0
    let section = 0
    for (const d of lessons.slice(0, index)) {
      if (!startsWithHeading(d.content)) section = 0
      chapter += count(d.content, /\\chapter(?!\*)\s*[[{]/g)
      section += count(d.content, /\\section(?!\*)\s*[[{]/g)
    }
    // Con \chapter le sezioni ripartono a ogni capitolo: conta solo il numero del capitolo
    return chapter > 0 ? { chapter, section: 0 } : { chapter: 0, section }
  } catch {
    return none
  }
}
