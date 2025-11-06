import { useCallback, useRef, useState, useEffect } from 'react'
import logoImg from './logo 神經與心理學.png'
import { Terms } from './components/Terms'
import { QueryBuilder } from './components/QueryBuilder'
import { Studies } from './components/Studies'
import { NiiViewer } from './components/NiiViewer'
import { useUrlQueryState } from './hooks/useUrlQueryState'
import './App.css'

export default function App () {
  const [query, setQuery] = useUrlQueryState('q')
  // theme state
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('lotusbf.theme') || 'dark'
    }
    return 'dark'
  })
  useEffect(() => {
    try { localStorage.setItem('lotusbf.theme', theme) } catch (e) {}
  }, [theme])
  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  const handlePickTerm = useCallback((t) => {
    setQuery((q) => (q ? `${q} ${t}` : t))
  }, [setQuery])

  // --- resizable panes state ---
  const gridRef = useRef(null)
  const [sizes, setSizes] = useState([28, 44, 28]) // [left, middle, right]
  const MIN_PX = 240
  const [isViewerFocused, setIsViewerFocused] = useState(false)
  const [isStudiesFocused, setIsStudiesFocused] = useState(false)

  const startDrag = (which, e) => {
    e.preventDefault()
    const startX = e.clientX
    const rect = gridRef.current.getBoundingClientRect()
    const total = rect.width
    const curPx = sizes.map(p => (p / 100) * total)

    const onMouseMove = (ev) => {
      const dx = ev.clientX - startX
      if (which === 0) {
        let newLeft = curPx[0] + dx
        let newMid = curPx[1] - dx
        if (newLeft < MIN_PX) { newMid -= (MIN_PX - newLeft); newLeft = MIN_PX }
        if (newMid < MIN_PX) { newLeft -= (MIN_PX - newMid); newMid = MIN_PX }
        const s0 = (newLeft / total) * 100
        const s1 = (newMid / total) * 100
        const s2 = 100 - s0 - s1
        setSizes([s0, s1, Math.max(s2, 0)])
      } else {
        let newMid = curPx[1] + dx
        let newRight = curPx[2] - dx
        if (newMid < MIN_PX) { newRight -= (MIN_PX - newMid); newMid = MIN_PX }
        if (newRight < MIN_PX) { newMid -= (MIN_PX - newRight); newRight = MIN_PX }
        const s1 = (newMid / total) * 100
        const s2 = (newRight / total) * 100
        const s0 = (curPx[0] / total) * 100
        setSizes([s0, s1, Math.max(s2, 0)])
      }
    }
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // If either pane is focused, allocate more space to it. Ensure mutual exclusion.
  const effectiveSizes = isViewerFocused ? [15, 15, 70]
    : isStudiesFocused ? [6, 88, 6] // squeeze Terms and Viewer, expand Studies (middle)
    : sizes

  return (
    <div className={`app ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
      {/* Inline style injection to enforce no-hover look */}
      <style>{`
  :root {
          --primary-700: #1d4ed8;
          --primary-800: #1e40af;
          --border: #e5e7eb;
        }
        .app { padding-right: 0 !important; }
        .app__grid { width: 100vw; max-width: 100vw; }
        /* Header layout: left 25% (title/logo), right 75% (query) */
  .app__logo-img { width: 64px; height: auto; object-fit: contain; border-radius: 6px; margin-top: 10px; }
        .app__header-right { flex: 1 1 75%; }
        .app__query-card { margin: 0; }
        /* Responsive: stack header on small screens */
        @media (max-width: 768px) {
          .app__header { flex-direction: column; align-items: stretch; }
          .app__header-left, .app__header-right { flex: none; width: 100%; }
          .app__header-left { margin-bottom: 8px; }
          .app__query-card { width: 100%; }
        }
        .card input[type="text"],
        .card input[type="search"],
        .card input[type="number"],
        .card select,
        .card textarea {
          width: 100% !important;
          max-width: 100% !important;
          display: block;
        }
        /* Downsized buttons */
        .card button,
        .card [role="button"],
        .card .btn,
        .card .button {
          font-size: 12px !important;
          padding: 4px 8px !important;
          border-radius: 8px !important;
          line-height: 1.2 !important;
          background: var(--primary-600) !important;
          color: #fff !important;
          border: none !important;
        }
        /* No visual change on hover/active */
        .card button:hover,
        .card button:active,
        .card [role="button"]:hover,
        .card [role="button"]:active,
        .card .btn:hover,
        .card .btn:active,
        .card .button:hover,
        .card .button:active {
          background: var(--primary-600) !important;
          color: #fff !important;
        }
        /* Toolbars / chips also no-hover */
        .card .toolbar button,
        .card .toolbar [role="button"],
        .card .toolbar .btn,
        .card .toolbar .button,
        .card .qb-toolbar button,
        .card .qb-toolbar [role="button"],
        .card .qb-toolbar .btn,
        .card .qb-toolbar .button,
        .card .query-builder button,
        .card .query-builder [role="button"],
        .card .query-builder .btn,
        .card .query-builder .button,
        .card .chip,
        .card .pill,
        .card .tag {
          background: var(--primary-600) !important;
          color: #fff !important;
          border: none !important;
        }
        .card .toolbar button:hover,
        .card .qb-toolbar button:hover,
        .card .query-builder button:hover,
        .card .chip:hover,
        .card .pill:hover,
        .card .tag:hover,
        .card .toolbar button:active,
        .card .qb-toolbar button:active,
        .card .query-builder button:active {
          background: var(--primary-600) !important;
          color: #fff !important;
        }
        /* Disabled stays same color but dimmer for affordance */
        .card .toolbar button:disabled,
        .card .qb-toolbar button:disabled,
        .card .query-builder button:disabled,
        .card button[disabled],
        .card [aria-disabled="true"] {
          background: var(--primary-600) !important;
          color: #fff !important;
          opacity: .55 !important;
        }
  /* subtle card shadow and padding for visual separation */
  .card { box-shadow: 0 1px 3px rgba(0,0,0,0.06); padding: 8px; background: #fff; }
      `}</style>

      <header className="app__header">
        <div className="app__header-left" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={logoImg} alt="Neuroscience and Psychology" className="app__logo-img" />
          <div className="app__title-block" style={{ display: 'flex', flexDirection: 'column' }}>
            <h1 className="app__title">LoTUS-BF</h1>
            <div className="app__subtitle">
              <span className='app__subtitle-line'>Location-or-Term Unified Search</span>
              <span className='app__subtitle-line'>for Brain Functions</span>
            </div>
        </div>
  </div>{/* end header-left */}
  <div className="app__header-right">
          <section className="card app__query-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <QueryBuilder query={query} setQuery={setQuery} />
              <button
                onClick={() => {
                  setIsViewerFocused(v => {
                    const next = !v
                    if (next) setIsStudiesFocused(false)
                    return next
                  })
                }}
                aria-pressed={isViewerFocused}
                className="btn btn-deepblue"
                style={{ marginLeft: 8 }}
              >
                {isViewerFocused ? 'Unfocus Viewer' : 'Focus Viewer'}
              </button>
              <button
                onClick={() => {
                  setIsStudiesFocused(s => {
                    const next = !s
                    if (next) setIsViewerFocused(false)
                    return next
                  })
                }}
                aria-pressed={isStudiesFocused}
                className="btn btn-deepblue"
                style={{ marginLeft: 8 }}
              >
                {isStudiesFocused ? 'Unfocus Studies' : 'Focus Studies'}
              </button>
              <button onClick={toggleTheme} className="btn btn-deepblue" style={{ marginLeft: 8 }}>
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>
            </div>
          </section>
        </div>
  </header>

      <main className="app__grid" ref={gridRef}>
  <section className="card terms" style={{ flexBasis: `${effectiveSizes[0]}%` }}>
          <div className="card__title">Terms</div>
          <Terms onPickTerm={handlePickTerm} />
        </section>

        <div className="resizer" aria-label="Resize left/middle" onMouseDown={(e) => startDrag(0, e)} />

        <section className={`card studies ${isStudiesFocused ? 'studies-focused' : ''}`} style={{ flexBasis: `${effectiveSizes[1]}%` }}>
          <Studies query={query} />
        </section>

        <div className="resizer" aria-label="Resize middle/right" onMouseDown={(e) => startDrag(1, e)} />

        <section className={`card ${isViewerFocused ? 'viewer-focused' : ''}`} style={{ flexBasis: `${effectiveSizes[2]}%` }}>
          <NiiViewer query={query} isFocused={isViewerFocused} expandedHeight={isViewerFocused ? 340 : 260} />
        </section>
      </main>
    </div>
  )
}
