import { API_BASE } from '../api'
import { useEffect, useMemo, useState } from 'react'

function classNames (...xs) { return xs.filter(Boolean).join(' ') }

export function Studies ({ query }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [sortKey, setSortKey] = useState('year')
  const [sortDir, setSortDir] = useState('desc') // 'asc' | 'desc'
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [studyFavs, setStudyFavs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('studies:favs') || '{}') } catch (e) { return {} }
  })
  const [showFavOnly, setShowFavOnly] = useState(false)

  useEffect(() => { try { localStorage.setItem('studies:favs', JSON.stringify(studyFavs)) } catch (e) {} }, [studyFavs])

  useEffect(() => { setPage(1) }, [query])

  useEffect(() => {
    if (!query) return
    let alive = true
    const ac = new AbortController()
    ;(async () => {
      setLoading(true)
      setErr('')
      try {
        const url = `${API_BASE}/query/${encodeURIComponent(query)}/studies`
        const res = await fetch(url, { signal: ac.signal })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
        if (!alive) return
        const list = Array.isArray(data?.results) ? data.results : []
        setRows(list)
      } catch (e) {
        if (!alive) return
        setErr(`Unable to fetch studies: ${e?.message || e}`)
        setRows([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false; ac.abort() }
  }, [query])

  const changeSort = (key) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    const arr = [...rows]
    // Always sort primarily by year (desc) then by title (asc) for stable academic ordering.
    arr.sort((a, b) => {
      const ay = Number(a?.year || 0)
      const by = Number(b?.year || 0)
      if (ay !== by) return by - ay // descending year
      const at = String(a?.title || '').toLowerCase()
      const bt = String(b?.title || '').toLowerCase()
      return at.localeCompare(bt, 'en')
    })
    return arr
  }, [rows, sortKey, sortDir])

  // helper to create a stable key for a study (falls back to title+journal+year)
  const studyKey = (r) => `${r?.journal || ''}|${r?.year || ''}|${(r?.title || '').slice(0,200)}`

  const filteredSorted = useMemo(() => {
    if (!showFavOnly) return sorted
    return sorted.filter(r => !!studyFavs[studyKey(r)])
  }, [sorted, showFavOnly, studyFavs])

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / pageSize))
  const pageRows = filteredSorted.slice((page - 1) * pageSize, page * pageSize)

  const toggleStudyFav = (r) => {
    const k = studyKey(r)
    setStudyFavs(s => { const next = { ...s }; if (next[k]) delete next[k]; else next[k] = true; return next })
  }

  return (
    <div className='studies flex flex-col rounded-2xl border shadow-sm'>
      <style>{`
        .terms__fav-btn { background: transparent; border: none; cursor: pointer; font-size: 18px; }
        .terms__fav-btn.fav { color: #f6b93b; }
      `}</style>
      <div className='flex items-center justify-between p-3'>
        <div className='card__title'>Studies</div>
        <div className='flex items-center gap-2'>
          <div className='text-sm text-gray-500 hidden sm:block'>{/* {query ? `Query: ${query}` : 'Query: (empty)'} */}</div>
          <button title='Show favorites' onClick={() => { setShowFavOnly(s => !s); setPage(1) }} className={`px-2 py-1 rounded border ${showFavOnly ? 'bg-yellow-50 border-yellow-200' : ''}`}>
            ⭐ Favorites ({Object.keys(studyFavs).length})
          </button>
        </div>
      </div>


      {query && loading && (
        <div className='grid gap-3 p-3'>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className='h-10 animate-pulse rounded-lg bg-gray-100' />
          ))}
        </div>
      )}

      {query && err && (
        <div className='mx-3 mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700'>
          {err}
        </div>
      )}

      {query && !loading && !err && (
        <div className='p-3'>
          <div className='grid gap-3'>
            {pageRows.length === 0 ? (
              <div className='text-gray-500'>No data</div>
            ) : (
              pageRows.map((r, i) => (
                <div key={i} className='p-3 rounded-lg bg-white shadow-sm border flex flex-col md:flex-row md:items-start gap-2'>
                  <div className='w-36 text-sm text-gray-700 font-medium'>
                    <span className='font-medium'>{r.year ?? ''}</span>
                    <span className='px-2 text-xs text-gray-400' aria-hidden>•</span>
                    <span className='text-xs text-gray-500'>{r.journal || ''}</span>
                  </div>
                  <div className='flex-1'>
                    <div className='text-base md:text-xl font-extrabold leading-tight text-gray-900 mb-1' style={{ fontWeight: 900, fontSize: '1.12rem' }}>{r.title}</div>
                    <div className='text-sm text-gray-700 mt-1'>{r.authors || ''}</div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <button onClick={() => toggleStudyFav(r)} className={`terms__fav-btn ${studyFavs[studyKey(r)] ? 'fav' : ''}`} aria-label='Toggle favorite'>{studyFavs[studyKey(r)] ? '★' : '☆'}</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {query && !loading && !err && (
        <div className='flex items-center justify-between border-t p-3 text-sm'>
          <div>Total <b>{sorted.length}</b> records, page <b>{page}</b>/<b>{totalPages}</b></div>
          <div className='flex items-center gap-2'>
            <button disabled={page <= 1} onClick={() => setPage(1)} className='rounded-lg border px-2 py-1 disabled:opacity-40'>⏮</button>
            <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className='rounded-lg border px-2 py-1 disabled:opacity-40'>Previous</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className='rounded-lg border px-2 py-1 disabled:opacity-40'>Next</button>
            <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className='rounded-lg border px-2 py-1 disabled:opacity-40'>⏭</button>
          </div>
        </div>
      )}
    </div>
  )
}

