import { useCallback, useEffect, useRef, useState } from 'react'
import { getCourseBySlug, verifyEditCode, type Course } from './api'
import { getEditCode, setEditCode } from './local'

/**
 * Carica un corso dallo slug nell'URL. `course === null` a caricamento finito significa "non trovato".
 * Il corso restituito corrisponde sempre allo slug richiesto (o è quello a cui un vecchio slug
 * reindirizza): mentre si passa da un corso a un altro vale `loading`, mai il corso precedente.
 */
export function useCourse(slug: string | undefined) {
  const [state, setState] = useState<{ course: Course | null; forSlug?: string }>({ course: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fresh = state.forSlug === slug || state.course?.slug === slug
  const course = fresh ? state.course : null

  const reload = useCallback(async () => {
    if (!slug) return
    try {
      const found = await getCourseBySlug(slug)
      setState({ course: found, forSlug: slug })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore imprevisto.')
    } finally {
      setLoading(false)
    }
  }, [slug])

  const loadedSlug = useRef<string | null>(null)
  loadedSlug.current = state.course?.slug ?? null

  useEffect(() => {
    // Dopo una rinomina l'URL cambia ma il corso è già quello giusto: niente ricaricamento
    if (loadedSlug.current === slug) return
    setLoading(true)
    void reload()
  }, [reload, slug])

  const setCourse = useCallback((updated: Course) => setState((s) => ({ ...s, course: updated })), [])

  return { course, setCourse, loading: (loading || !fresh) && !error, error, reload }
}

/** Stato di modifica di un corso: libero, oppure bloccato da un codice salvato in questo browser. */
export function useEditAccess(course: Course | null) {
  const [code, setCode] = useState<string | null>(null)

  useEffect(() => {
    setCode(course ? getEditCode(course.id) : null)
  }, [course?.id])

  const canEdit = !!course && !course.deleted_at && (!course.is_locked || !!code)

  /** Verifica il codice sul server e, se è giusto, lo ricorda. */
  const unlock = useCallback(
    async (candidate: string) => {
      if (!course) return false
      const ok = await verifyEditCode(course.id, candidate)
      if (ok) {
        setEditCode(course.id, candidate)
        setCode(candidate)
      }
      return ok
    },
    [course],
  )

  const forget = useCallback(() => {
    if (!course) return
    setEditCode(course.id, null)
    setCode(null)
  }, [course])

  return { canEdit, locked: !!course?.is_locked, hasCode: !!code, unlock, forget }
}
