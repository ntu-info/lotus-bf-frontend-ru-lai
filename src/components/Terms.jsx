
import { API_BASE } from '../api'
import { useEffect, useMemo, useState } from 'react'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export function Terms ({ onPickTerm }) {
  const [terms, setTerms] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [openLetter, setOpenLetter] = useState(null) // currently expanded letter

  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    const load = async () => {
      setLoading(true)
      setErr('')
      try {
        const res = await fetch(`${API_BASE}/terms`, { signal: ac.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!alive) return
        setTerms(Array.isArray(data?.terms) ? data.terms : [])
      } catch (e) {
        if (!alive) return
        setErr(`Failed to fetch terms: ${e?.message || e}`)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false; ac.abort() }
  }, [])

  const normalized = useMemo(() => terms.map(t => ({ raw: t, key: (t || '').toUpperCase().trim() })), [terms])

  // Group terms by first letter A-Z; non-alpha go into '#'
  const groups = useMemo(() => {
    const g = {}
    for (const { raw, key } of normalized) {
      const L = (key && key[0] >= 'A' && key[0] <= 'Z') ? key[0] : '#'
      if (!g[L]) g[L] = []
      g[L].push(raw)
    }
    // sort each group
    for (const k of Object.keys(g)) g[k].sort((a,b)=>a.localeCompare(b, 'en'))
    return g
  }, [normalized])

  // global filtered set based on search
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return terms
    return terms.filter(t => t.toLowerCase().includes(s))
  }, [terms, search])

  const toggleLetter = (L) => {
    setOpenLetter(prev => (prev === L ? null : L))
  }

  return (
    <div className='terms'>
        <div className='terms__controls' style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search terms…'
          className='input controls--capsule'
        />
        <button onClick={() => setSearch('')} className='btn btn--primary'>Clear</button>
      </div>

      {loading && <div>Loading terms…</div>}
      {err && <div className='text-sm text-red-600'>{err}</div>}

      {!loading && !err && (
        <div>
          {/* Alphabet buttons (grid-aligned with counts) */}
          <div className='terms__alphabet-grid' style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 }}>
            {ALPHABET.map(L => {
              const cnt = (groups[L] || []).length
              return (
                <div key={L} className='flex flex-col items-center'>
                      <button
                        onClick={() => toggleLetter(L)}
                        aria-label={`${L} (${cnt}) terms`}
                        className={`terms__alpha-button ${openLetter===L ? 'open' : ''}`}
                        style={{ minWidth: 48 }}
                      >
                        <span className='terms__alpha-letter'>{L}</span>
                        <span className='terms__alpha-count badge'>{cnt}</span>
                      </button>
                    </div>
              )
            })}
            <div className='flex flex-col items-center'>
              <button onClick={() => toggleLetter('#')} aria-label={`# (${(groups['#']||[]).length}) terms`} className={`terms__alpha-button ${openLetter==='#' ? 'open' : ''}`} style={{ minWidth: 48 }}>
                <span className='terms__alpha-letter'>#</span>
                <span className='terms__alpha-count badge'>{(groups['#']||[]).length}</span>
              </button>
            </div>
          </div>

            <div className='text-sm text-gray-600 mb-2'>Total: <b>{search ? filtered.length : terms.length}</b> terms</div>

          {/* If there is an active search, show matching terms (ignores accordion) */}
          {search ? (
            <div className='terms__list'>
              {filtered.length === 0 ? <div className='text-sm text-gray-500'>No terms found</div> : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {filtered.map((t, i) => (
                    <li key={`${t}-${i}`} style={{ padding: '6px 0' }}>
                      <button className='terms__name text-left' style={{ background: 'transparent', border: 'none', padding: 0 }} onClick={() => onPickTerm?.(t)}>{t}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div>
              {ALPHABET.concat(['#']).map(L => {
                const items = groups[L] || []
                const isOpen = openLetter === L
                return (
                  <div key={L} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => toggleLetter(L)} className='px-2 py-1 rounded border text-sm' aria-expanded={isOpen}>{L}</button>
                      <div className='text-sm text-gray-500'>{items.length} items</div>
                    </div>
                    <div className={`terms__panel ${isOpen ? 'open' : ''}`}>
                      {items.length > 0 && (
                        <ul style={{ listStyle: 'none', paddingLeft: 8, marginTop: 6 }}>
                          {items.map((t, i) => (
                            <li key={`${L}-${i}`} style={{ padding: '4px 0' }}>
                              <button className='terms__name text-left' style={{ background: 'transparent', border: 'none', padding: 0 }} onClick={() => onPickTerm?.(t)}>{t}</button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

