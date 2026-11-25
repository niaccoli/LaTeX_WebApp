import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDate, listCourses, restoreCourse, type Course } from '../lib/api'
import { useApp } from '../lib/app-context'

/** Cestino dei corsi eliminati (i documenti eliminati stanno nel cestino del loro corso). */
export function TrashPage() {
  const { notify, notifyError } = useApp()
  const [courses, setCourses] = useState<Course[] | null>(null)

  const load = useCallback(() => {
    listCourses(true).then(setCourses).catch(notifyError)
  }, [notifyError])

  useEffect(() => {
    document.title = 'Cestino · Appunti LaTeX'
    load()
  }, [load])

  async function restore(course: Course) {
    try {
      await restoreCourse(course.id)
      notify(`«${course.name}» ripristinato.`)
      load()
    } catch (e) {
      notifyError(e)
    }
  }

  return (
    <>
      <nav className="breadcrumb">
        <Link to="/">Corsi</Link> <span>/</span> Cestino
      </nav>
      <h1>Cestino dei corsi</h1>
      {!courses && <p className="muted">Caricamento…</p>}
      {courses?.length === 0 && <p className="empty">Il cestino è vuoto.</p>}
      <ul className="list">
        {courses?.map((c) => (
          <li key={c.id} className="list-row">
            <div className="list-main">
              <strong>{c.name}</strong>
              <span className="muted small">
                {c.academic_year}
                {c.deleted_at && ` · eliminato il ${formatDate(c.deleted_at)}`}
                {c.is_locked && ' · protetto da codice'}
              </span>
            </div>
            <button className="btn" onClick={() => restore(c)}>
              Ripristina
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
