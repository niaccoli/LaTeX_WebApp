import JSZip from 'jszip'
import type { Course, Doc } from './api'
import { headFor } from './compiler'

/** Fa scaricare un file al browser. */
export function download(filename: string, data: Blob | string | Uint8Array, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function downloadTex(doc: Pick<Doc, 'slug' | 'content'>, content = doc.content) {
  download(`${doc.slug}.tex`, content, 'application/x-tex;charset=utf-8')
}

export function downloadPdf(doc: Pick<Doc, 'slug'>, pdf: Uint8Array) {
  download(`${doc.slug}.pdf`, pdf, 'application/pdf')
}

/** Rende sicuro un testo libero (titolo, nome del corso) dentro un sorgente LaTeX. */
export function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

export const isStandalone = (content: string) => /^[^%\n]*\\documentclass/m.test(content)

/** Il documento comincia già con un suo titolo (\chapter o \section): non serve introdurlo con una «parte». */
export function startsWithHeading(content: string): boolean {
  const first = content.split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('%'))
  return !!first && /^\s*\\(?:chapter|section)\*?\s*[[{]/.test(first)
}

/**
 * Esporta il corso come progetto LaTeX: main.tex include il preambolo e fa \input
 * di ogni documento, nell'ordine del sito. Si compila con `pdflatex main.tex` (due volte, per l'indice).
 */
export async function downloadCourseZip(course: Course, docs: Doc[], images: { name: string; bytes: Uint8Array }[] = []) {
  const zip = new JSZip()
  const preamble = docs.find((d) => d.kind === 'preamble')
  const lessons = docs.filter((d) => d.kind === 'doc')
  const inputs: string[] = []
  const standalone: string[] = []

  // Corso con un unico LaTeX completo (nessun preambolo condiviso): file nella radice e immagini accanto, così \includegraphics{nome.png} funziona
  if (!preamble && lessons.length > 0 && lessons.every((d) => isStandalone(d.content))) {
    for (const doc of lessons) zip.file(`${doc.slug}.tex`, doc.content.endsWith('\n') ? doc.content : doc.content + '\n')
    for (const image of images) zip.file(image.name, image.bytes)
    download(`${course.slug}.zip`, await zip.generateAsync({ type: 'blob' }))
    return
  }

  lessons.forEach((doc, index) => {
    const name = `${String(index + 1).padStart(2, '0')}-${doc.slug}`
    if (isStandalone(doc.content)) {
      // Ha già il suo \documentclass: non si può includere con \input, resta un file a parte
      zip.file(`autonomi/${name}.tex`, doc.content)
      standalone.push(`% autonomi/${name}.tex — ${doc.title} (documento completo, da compilare da solo)`)
      return
    }
    zip.file(`documenti/${name}.tex`, doc.content.endsWith('\n') ? doc.content : doc.content + '\n')
    // Un documento che comincia con \chapter o \section ha già il suo titolo e la numerazione prosegue da quello prima;
    // un testo senza titoli viene introdotto da una «parte» con il nome del documento e la numerazione riparte
    inputs.push(
      (startsWithHeading(doc.content)
        ? [`% ${doc.title}`, `\\input{documenti/${name}}`]
        : [
            `% ${doc.title}`,
            `\\part*{${escapeLatex(doc.title)}}`,
            `\\addcontentsline{toc}{part}{${escapeLatex(doc.title)}}`,
            '\\setcounter{section}{0}',
            `\\input{documenti/${name}}`,
            '\\clearpage',
          ]
      ).join('\n'),
    )
  })

  zip.file('preambolo.tex', preamble?.content ?? '% Preambolo condiviso del corso\n')
  for (const image of images) zip.file(`immagini/${image.name}`, image.bytes)
  // Nei documenti le immagini si richiamano per nome: \graphicspath le fa trovare nella cartella immagini/
  const usesGraphics = images.length > 0 || docs.some((d) => /\\includegraphics/.test(d.content))
  const graphicx = usesGraphics && !/graphicx/.test(preamble?.content ?? '')
  // Se il preambolo ha una sua \documentclass, main.tex non ne aggiunge un'altra
  const ownClass = /^[^%\n]*\\documentclass/m.test(preamble?.content ?? '')

  const subtitle = [course.code, `A.A. ${course.academic_year}`, course.teacher].filter(Boolean).join(' · ')
  const main = [
    `% ${course.name} — appunti esportati da Appunti LaTeX`,
    '% Compilazione: pdflatex main.tex (due volte, per l\'indice)',
    ...(ownClass
      ? ['\\input{preambolo}', ...(graphicx ? ['\\usepackage{graphicx}'] : [])]
      : [
          ...headFor(preamble?.content ?? ''),
          ...(graphicx ? ['\\usepackage{graphicx}'] : []),
          '\\input{preambolo}',
        ]),
    ...(usesGraphics ? ['\\graphicspath{{immagini/}}'] : []),
    '',
    `\\title{${escapeLatex(course.name)}}`,
    `\\author{${escapeLatex(subtitle)}}`,
    '\\date{}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '\\tableofcontents',
    '\\clearpage',
    '',
    inputs.join('\n\n'),
    '',
    ...(standalone.length ? ['% Documenti non inclusi qui sopra:', ...standalone, ''] : []),
    '\\end{document}',
    '',
  ].join('\n')
  zip.file('main.tex', main)

  const blob = await zip.generateAsync({ type: 'blob' })
  download(`${course.slug}.zip`, blob)
}

/** Legge un file .tex scelto dall'utente; il titolo proposto è il nome del file. */
export async function readTexFile(file: File): Promise<{ title: string; content: string }> {
  if (file.size > 1024 * 1024) throw new Error('Il file supera il limite di 1 MB.')
  const content = await file.text()
  if (content.includes('\u0000')) throw new Error('Il file non sembra un sorgente LaTeX di testo.')
  const title = file.name.replace(/\.(tex|ltx|txt)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Documento importato'
  return { title: title.slice(0, 200), content }
}
