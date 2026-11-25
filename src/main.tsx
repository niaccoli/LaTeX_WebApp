import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { AppProvider } from './lib/app-context'
import { AuthGate } from './lib/auth'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { FullCoursePage } from './pages/FullCoursePage'
import { CoursePage } from './pages/CoursePage'
import { DocumentPage } from './pages/DocumentPage'
import { TrashPage } from './pages/TrashPage'
import './styles.css'

function NotFound() {
  return (
    <div className="empty">
      <p>Pagina non trovata.</p>
      <Link to="/">Torna all’elenco dei corsi</Link>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthGate>
      <AppProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/cestino" element={<TrashPage />} />
            <Route path="/corsi/:courseSlug" element={<CoursePage />} />
            <Route path="/corsi/:courseSlug/_completo" element={<FullCoursePage />} />
            <Route path="/corsi/:courseSlug/:docSlug" element={<DocumentPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AppProvider>
      </AuthGate>
    </BrowserRouter>
  </StrictMode>,
)
