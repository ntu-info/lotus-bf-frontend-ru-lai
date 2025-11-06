import { useEffect, useState } from 'react'

export function QueryBuilder({ query, setQuery }) {
  const [history, setHistory] = useState([])

  // load history from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('lotusbf.searchHistory')
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) setHistory(arr)
      }
    } catch (_) { /* ignore */ }
  }, [])

  const persistHistory = (arr) => {
    setHistory(arr)
    try { localStorage.setItem('lotusbf.searchHistory', JSON.stringify(arr)) } catch (_) { /* ignore */ }
  }

  const saveToHistory = (val) => {
    const v = String(val || '').trim()
    if (!v) return
    // dedupe and cap at 15 items; newest first
    const next = [v, ...history.filter(h => h !== v)].slice(0, 15)
    persistHistory(next)
  }

  const clearHistory = () => persistHistory([])

  const append = (token) => setQuery((q) => (q ? `${q} ${token}` : token));

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = e.currentTarget.value
      setQuery(v)
      saveToHistory(v)
    }
  };

  return (
    <div className="flex flex-col gap-3 qb">
      <style>{`
        /* Scoped override for Clear history button (stronger than .card button !important) */
        .app .card .qb .history-clear-btn {
          background: #b91c1c !important; /* red-700 */
          color: #fff !important;
          border: 1px solid #ef4444 !important; /* red-500 */
        }
        .app .card .qb .history-clear-btn:hover,
        .app .card .qb .history-clear-btn:active {
          background: #991b1b !important; /* red-800 */
          border-color: #f87171 !important; /* red-400 */
          color: #fff !important;
        }
        .app .card .qb .history-clear-btn:disabled { opacity: .6; }
      `}</style>
  {/* Header removed per request (no "Query Builder" text) */}

      {/* Input */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Create a query here, e.g.: [-22,-4,18] NOT emotion"
        className="qb__input"
        style={{ width: "100%" }}
      />

      {/* Operators + Reset (single row) */}
      <div className="flex gap-3 flex-nowrap overflow-x-auto">
        {[
          { label: 'AND', onClick: () => append('AND') },
          { label: 'OR', onClick: () => append('OR') },
          { label: 'NOT', onClick: () => append('NOT') },
          { label: '(', onClick: () => append('(') },
          { label: ')', onClick: () => append(')') },
          // Reset moved here after ')' per requirement
          { label: 'Reset', onClick: () => setQuery('') },
        ].map((b) => (
          <button
            key={b.label}
            onClick={b.onClick}
              className="operator-btn btn-deepblue rounded-xl px-3 py-2 text-sm"
            style={{ minWidth: 64 }}
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* Search history (click to load) */}
      {history.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 4 }}>
          <span className="text-xs text-gray-600" style={{ whiteSpace: 'nowrap' }}>History:</span>
          <div className="flex gap-2 flex-wrap">
            {history.map((h, i) => (
              <button
                key={`${h}-${i}`}
                className="btn-deepblue text-xs rounded-full"
                style={{ padding: '4px 8px', lineHeight: 1.1 }}
                title={h}
                onClick={() => setQuery(h)}
              >
                {h}
              </button>
            ))}
          </div>
          <button
            onClick={clearHistory}
            className="history-clear-btn text-xs"
            style={{ marginLeft: 'auto', padding: '4px 8px', lineHeight: 1.1 }}
            title="Clear history"
          >
            Clear
          </button>
        </div>
      )}

      {/* Tip (English) */}
      {/*<div className="text-xs text-gray-600">
        Tip: You can mix MNI locations in the query string, such as "[-22,-4,-18] NOT emotion" (without the quotes).
      </div>*/}

      {/* The "Current Query" row was removed per requirement #3. */}
    </div>
  );
}
