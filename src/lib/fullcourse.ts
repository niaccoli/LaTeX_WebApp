import type { Course, Doc } from './api'
import { fontFix, headFor } from './compiler'
import { escapeLatex, isStandalone, startsWithHeading } from './export'

export interface FullSource {
  source: string
  /** Documenti non inclusi perché sono LaTeX completi (hanno già \documentclass). */
  skipped: string[]
  /** Numero di documenti inclusi. */
  count: number
  /** Riporta una riga del sorgente completo al documento (o preambolo) e alla riga al suo interno. */
  locate: (line: number | null) => { label: string; line: number | null }
}

/**
 * Mette insieme preambolo e documenti del corso in un unico sorgente (come main.tex dello zip,
 * ma con i documenti scritti per intero al posto di \input), così si compila in un solo PDF.
 */
export function buildFullSource(course: Course, docs: Doc[]): FullSource {
  const preamble = docs.find((d) => d.kind === 'preamble')
  const pre = preamble?.content ?? ''
  const lessons = docs.filter((d) => d.kind === 'doc')
  const skipped: string[] = []
  const lines: string[] = []
  const segments: { label: string; start: number; count: number }[] = []
  const push = (...l: string[]) => lines.push(...l)
  const segment = (label: string, text: string) => {
    const body = text.replace(/\n$/, '').split('\n')
    segments.push({ label, start: lines.length + 1, count: body.length })
    push(...body)
  }

  const usesGraphics = docs.some((d) => /\\includegraphics/.test(d.content))
  const needsGraphicx = usesGraphics && !/graphicx/.test(pre)
  const ownClass = /^[^%\n]*\\documentclass/m.test(pre)

  if (ownClass) {
    segment('Preambolo', pre)
    push(...fontFix(pre), ...(needsGraphicx ? ['\\usepackage{graphicx}'] : []))
  } else {
    push(...headFor(pre))
    if (needsGraphicx) push('\\usepackage{graphicx}')
    segment('Preambolo', pre)
  }

  const subtitle = [course.code, `A.A. ${course.academic_year}`, course.teacher].filter(Boolean).join(' · ')
  push('', `\\title{${escapeLatex(course.name)}}`, `\\author{${escapeLatex(subtitle)}}`, '\\date{}', '', '\\begin{document}', '\\maketitle', '\\tableofcontents', '\\clearpage', '')

  let count = 0
  for (const doc of lessons) {
    if (isStandalone(doc.content)) {
      skipped.push(doc.title)
      continue
    }
    count++
    if (startsWithHeading(doc.content)) {
      push(`% ${doc.title.replace(/\n/g, ' ')}`)
      segment(doc.title, doc.content)
      push('')
    } else {
      push(`% ${doc.title.replace(/\n/g, ' ')}`, `\\part*{${escapeLatex(doc.title)}}`, `\\addcontentsline{toc}{part}{${escapeLatex(doc.title)}}`, '\\setcounter{section}{0}')
      segment(doc.title, doc.content)
      push('\\clearpage', '')
    }
  }
  push('\\end{document}', '')

  return {
    source: lines.join('\n'),
    skipped,
    count,
    locate: (line) => {
      if (line === null) return { label: '', line: null }
      const s = segments.find((x) => line >= x.start && line < x.start + x.count)
      return s ? { label: s.label, line: line - s.start + 1 } : { label: '', line: null }
    },
  }
}
