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

  // Group terms by first letter A-Z; skip non-alpha (do not use '#')
  const groups = useMemo(() => {
    const g = {}
    for (const { raw, key } of normalized) {
      if (!key) continue
      const first = key[0]
      if (!(first >= 'A' && first <= 'Z')) continue
      const L = first
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
        <div className='terms__controls' style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search terms…'
          className='qb__input'
          style={{ flex: '1 1 140px', minWidth: 0 }}
        />
  <button onClick={() => setSearch('')} className='btn btn-deepblue' style={{ padding: '4px 8px', fontSize: '12px' }}>Clear</button>
      </div>

      {loading && <div>Loading terms…</div>}
      {err && <div className='text-sm text-red-600'>{err}</div>}

      {!loading && !err && (
        <div>
          {/* Alphabet buttons (responsive grid, shrinks very narrow) */}
          <div className='terms__alphabet-grid' style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(26px, 1fr))', gap: 4, marginBottom: 6 }}>
            {ALPHABET.map(L => {
              const cnt = (groups[L] || []).length
              return (
    <div key={L} className='flex flex-col items-center' style={{ fontSize: '11px' }}>
                      <button
                        onClick={() => toggleLetter(L)}
                        aria-label={`${L} (${cnt}) terms`}
      className={`terms__alpha-button ${openLetter===L ? 'open' : ''}`}
      style={{ width: '100%', minWidth: 0, padding: '3px 0', fontSize: '12px', lineHeight: '1.1' }}
                      >
      <span className='terms__alpha-letter' style={{ fontWeight: 600 }}>{L}</span>
      <span className='terms__alpha-count badge' style={{ fontSize: '10px', marginTop: 2 }}>{cnt}</span>
                      </button>
                    </div>
              )
            })}
            {/* Non-alpha bucket removed — do not render '#' */}
          </div>

            <div className='text-xs text-gray-500 mb-2'>Total: <b>{search ? filtered.length : terms.length}</b></div>

          {/* If there is an active search, show matching terms (ignores letter selection) */}
          {search ? (
      <div className='terms__list'>
              {filtered.length === 0 ? <div className='text-sm text-gray-500'>No terms found</div> : (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '12px', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                  {filtered.map((t, i) => (
          <li key={`${t}-${i}`} style={{ padding: '4px 0' }}>
                      <button className='terms__name text-left' style={{ background: 'transparent', border: 'none', padding: 0 }} onClick={() => onPickTerm?.(t)}>{t}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className='terms__selected'>
              {openLetter != null && (() => {
                const items = groups[openLetter] || []
                return items.length === 0 ? (
                  <div className='text-sm text-gray-500'>No terms for this letter</div>
                ) : (
          <ul style={{ listStyle: 'none', paddingLeft: 4, marginTop: 4, fontSize: '12px', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                    {items.map((t, i) => (
                      <li key={`${openLetter}-${i}`} style={{ padding: '3px 0' }}>
                        <button className='terms__name text-left' style={{ background: 'transparent', border: 'none', padding: 0 }} onClick={() => onPickTerm?.(t)}>{t}</button>
                      </li>
                    ))}
                  </ul>
                )
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

