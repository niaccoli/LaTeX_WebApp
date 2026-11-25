import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createCourse, listCourses, type Course } from '../lib/api'
import { setEditCode } from '../lib/local'
import { useApp } from '../lib/app-context'
import { CourseForm } from '../components/CourseForm'

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

export function Home() {
  const { notify } = useApp()
  const navigate = useNavigate()
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    document.title = 'Appunti LaTeX'
    listCourses()
      .then(setCourses)
      .catch((e: Error) => setError(e.message))
  }, [])

  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    if (!courses || !q) return courses ?? []
    return courses.filter((c) => normalize(c.name).includes(q) || normalize(c.code ?? '').includes(q))
  }, [courses, query])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Corsi</h1>
          <p className="muted">Appunti in LaTeX scritti insieme. Chiunque abbia il link può leggere e modificare.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + Nuovo corso
        </button>
      </div>

      <input
        className="search"
        type="search"
        placeholder="Cerca per nome o codice…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Cerca corsi"
      />

      {error && <p className="form-error">{error}</p>}
      {!courses && !error && <p className="muted">Caricamento…</p>}
      {courses && filtered.length === 0 && (
        <p className="empty">{courses.length === 0 ? 'Non c’è ancora nessun corso. Crea il primo!' : 'Nessun corso corrisponde alla ricerca.'}</p>
      )}

      <div className="course-grid">
        {filtered.map((c) => (
          <Link key={c.id} to={`/corsi/${c.slug}`} className="card course-card">
            <div className="course-card-top">
              {c.code && <span className="tag">{c.code}</span>}
              <span className="muted small">{c.academic_year}</span>
              {c.is_locked && (
                <span className="muted small" title="Modifica protetta da codice">
                  🔒
                </span>
              )}
            </div>
            <h2>{c.name}</h2>
            {c.teacher && <p className="muted small">{c.teacher}</p>}
            {c.description && <p className="course-desc">{c.description}</p>}
          </Link>
        ))}
      </div>

      <p className="footer-links">
        <Link to="/cestino">Cestino dei corsi</Link>
      </p>

      {creating && (
        <CourseForm
          onClose={() => setCreating(false)}
          onSubmit={async (input, editCode) => {
            const course = await createCourse(input, editCode)
            if (editCode) setEditCode(course.id, editCode)
            notify('Corso creato.')
            navigate(`/corsi/${course.slug}`)
          }}
        />
      )}
    </>
  )
}
