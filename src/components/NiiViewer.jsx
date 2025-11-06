
// Display convention: put x>0 (right hemisphere) on the right side of the screen
const X_RIGHT_ON_SCREEN_RIGHT = true;

import { useEffect, useMemo, useRef, useState } from 'react'
import * as nifti from 'nifti-reader-js'
import { API_BASE } from '../api'

const MNI_BG_URL = 'static/mni_2mm.nii.gz'

// Detect MNI152 2mm template dims & spacing (91x109x91, 2mm iso)
function isStandardMNI2mm(dims, voxelMM) {
  const okDims = Array.isArray(dims) && dims[0]===91 && dims[1]===109 && dims[2]===91;
  const okSp   = voxelMM && Math.abs(voxelMM[0]-2)<1e-3 && Math.abs(voxelMM[1]-2)<1e-3 && Math.abs(voxelMM[2]-2)<1e-3;
  return okDims && okSp;
}
// Standard MNI152 2mm affine (voxel i,j,k -> MNI mm):
// x = -2*i + 90;  y = 2*j - 126;  z = 2*k - 72
const MNI2MM = { x0: 90, y0: -126, z0: -72, vx: 2, vy: 2, vz: 2 };

export function NiiViewer({ query, isFocused = false, expandedHeight = 260 }) {
  const [loadingBG, setLoadingBG] = useState(false)
  const [loadingMap, setLoadingMap] = useState(false)
  const [errBG, setErrBG] = useState('')
  const [errMap, setErrMap] = useState('')

  // backend params (map generation)
  const [voxel, setVoxel] = useState(2.0)
  const [fwhm, setFwhm] = useState(10.0)
  const [kernel, setKernel] = useState('gauss')
  const [r, setR] = useState(6.0)

  // overlay controls
  const [overlayAlpha, setOverlayAlpha] = useState(0.5)
  const [posOnly, setPosOnly] = useState(true)
  const [useAbs, setUseAbs] = useState(false)
  const [thrMode, setThrMode] = useState('pctl') // default: Percentile (per request)
  const [pctl, setPctl] = useState(95)
  const [thrValue, setThrValue] = useState(0)     // used when mode === 'value'

  // snapshot history (saved images)
  const [snapshots, setSnapshots] = useState([])
  useEffect(() => {
    try {
      const raw = localStorage.getItem('niiviewer:snapshots')
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) setSnapshots(arr)
      }
    } catch (e) { /* ignore */ }
  }, [])
  const persistSnapshots = (arr) => {
    setSnapshots(arr)
    try { localStorage.setItem('niiviewer:snapshots', JSON.stringify(arr)) } catch (e) { /* ignore */ }
  }

  // volumes
  const bgRef  = useRef(null)   // { data, dims:[nx,ny,nz], voxelMM:[vx,vy,vz], min, max }
  const mapRef = useRef(null)   // { data, dims:[nx,ny,nz], voxelMM:[vx,vy,vz], min, max }
  const getVoxelMM = () => {
    const vm = bgRef.current?.voxelMM ?? mapRef.current?.voxelMM ?? [1,1,1]
    return { x: vm[0], y: vm[1], z: vm[2] }
  }
  const [dims, setDims] = useState([0,0,0]) // canvas dims (prefer BG; overlay only if same dims)

  // slice indices (voxel coordinates in [0..N-1])
  const [ix, setIx] = useState(0) // sagittal (X)
  const [iy, setIy] = useState(0) // coronal  (Y)
  const [iz, setIz] = useState(0) // axial    (Z)

  // Neurosynth-style displayed coords: signed, centered at middle voxel
  const [cx, setCx] = useState('0')
  const [cy, setCy] = useState('0')
  const [cz, setCz] = useState('0')

  const canvases = [useRef(null), useRef(null), useRef(null)]
  const [expandedSlice, setExpandedSlice] = useState(null) // 'x' | 'y' | 'z' | null
    const [toast, setToast] = useState({ msg: '', visible: false })
    const toastTimerRef = useRef(null)
  const resizeObserverRef = useRef(null)

  // keyboard shortcuts: X / Y / Z to expand, Escape to collapse
  useEffect(() => {
    const onKey = (e) => {
      if (!e || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'x' || k === 'y' || k === 'z') {
        setExpandedSlice(k)
      } else if (e.key === 'Escape') {
        setExpandedSlice(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // focus first canvas when requested
  useEffect(() => {
    if (isFocused) {
      const c = canvases[0]?.current || canvases[1]?.current || canvases[2]?.current
      try { c?.focus?.() } catch (e) {}
      // also scroll into view for small screens
      const card = c?.closest('.niiviewer') || c?.parentElement
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isFocused])

  // slider transient positions (so slider moves smoothly) and debounce timers
  const [sliderPos, setSliderPos] = useState({ x: 0, y: 0, z: 0 })
  const debounceRefs = useRef({ x: null, y: null, z: null })

  useEffect(() => {
    setSliderPos({ x: ix, y: iy, z: iz })
  }, [ix, iy, iz])

  useEffect(() => {
    return () => {
      // clear any pending debounce timers on unmount
      Object.values(debounceRefs.current).forEach(t => { if (t) clearTimeout(t) })
    }
  }, [])

  const mapUrl = useMemo(() => {
    if (!query) return ''
    const u = new URL(`${API_BASE}/query/${encodeURIComponent(query)}/nii`)
    u.searchParams.set('voxel', String(voxel))
    u.searchParams.set('fwhm', String(fwhm))
    u.searchParams.set('kernel', String(kernel))
    u.searchParams.set('r', String(r))
    return u.toString()
  }, [query, voxel, fwhm, kernel, r])

  // ---------- utils ----------
  function asTypedArray (header, buffer) {
    switch (header.datatypeCode) {
      case nifti.NIFTI1.TYPE_INT8:    return new Int8Array(buffer)
      case nifti.NIFTI1.TYPE_UINT8:   return new Uint8Array(buffer)
      case nifti.NIFTI1.TYPE_INT16:   return new Int16Array(buffer)
      case nifti.NIFTI1.TYPE_UINT16:  return new Uint16Array(buffer)
      case nifti.NIFTI1.TYPE_INT32:   return new Int32Array(buffer)
      case nifti.NIFTI1.TYPE_UINT32:  return new Uint32Array(buffer)
      case nifti.NIFTI1.TYPE_FLOAT32: return new Float32Array(buffer)
      case nifti.NIFTI1.TYPE_FLOAT64: return new Float64Array(buffer)
      default: return new Float32Array(buffer)
    }
  }
  function minmax (arr) {
    let mn =  Infinity, mx = -Infinity
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    return [mn, mx]
  }
  function percentile(arr, p, step=Math.ceil(arr.length/200000)) {
    if (!arr.length) return 0
    const samp = []
    for (let i=0; i<arr.length; i+=step) samp.push(arr[i])
    samp.sort((a,b)=>a-b)
    const k = Math.floor((p/100) * (samp.length - 1))
    return samp[Math.max(0, Math.min(samp.length-1, k))]
  }
  async function loadNifti(url) {
    const res = await fetch(url)
    if (!res.ok) {
      const t = await res.text().catch(()=> '')
      throw new Error(`GET ${url} → ${res.status} ${t}`)
    }
    let ab = await res.arrayBuffer()
    if (nifti.isCompressed(ab)) ab = nifti.decompress(ab)
    if (!nifti.isNIFTI(ab)) throw new Error('not a NIfTI file')
    const header = nifti.readHeader(ab)
    const image  = nifti.readImage(header, ab)
    const ta     = asTypedArray(header, image)
    let f32
    if (ta instanceof Float32Array) f32 = ta
    else if (ta instanceof Float64Array) f32 = Float32Array.from(ta)
    else {
      const [mn, mx] = minmax(ta)
      const range = (mx - mn) || 1
      f32 = new Float32Array(ta.length)
      for (let i=0;i<ta.length;i++) f32[i] = (ta[i] - mn) / range
    }
    const nx = header.dims[1] | 0
    const ny = header.dims[2] | 0
    const nz = header.dims[3] | 0
    if (!nx || !ny || !nz) throw new Error('invalid dims')
    const [mn, mx] = minmax(f32)
    const vx = Math.abs(header.pixDims?.[1] ?? 1)
    const vy = Math.abs(header.pixDims?.[2] ?? 1)
    const vz = Math.abs(header.pixDims?.[3] ?? 1)
    return { data: f32, dims:[nx,ny,nz], voxelMM:[vx,vy,vz], min: mn, max: mx }
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

  // helpers: convert between index [0..N-1] and neurosynth-style signed coord centered at mid voxel
  // Display conventions to match Neurosynth-like UI:
  //  - X: right-positive
  //  - Y: anterior-positive (but screen vertical is flipped), so invert sign
  //  - Z: superior-positive (also vertical), invert sign
  const AXIS_SIGN = { x: -1, y: 1, z: 1 } // X is neg for index<->coord mapping only when not using standard MNI affine
  const idx2coord = (i, n, axis) => {
    const [nx, ny, nz] = dims;
    const { x: vx, y: vy, z: vz } = getVoxelMM();
    const isStd = isStandardMNI2mm([nx, ny, nz], [vx, vy, vz]);
    if (isStd) {
      if (axis === 'x') return (-MNI2MM.vx * i + MNI2MM.x0);
      if (axis === 'y') return ( MNI2MM.vy * i + MNI2MM.y0);
      if (axis === 'z') return ( MNI2MM.vz * i + MNI2MM.z0);
    }
    const mmPerVoxel = axis === 'x' ? vx : axis === 'y' ? vy : vz;
    return AXIS_SIGN[axis] * (i - Math.floor(n/2)) * mmPerVoxel;
  }
const coord2idx = (c_mm, n, axis) => {
    const [nx, ny, nz] = dims;
    const { x: vx, y: vy, z: vz } = getVoxelMM();
    const isStd = isStandardMNI2mm([nx, ny, nz], [vx, vy, vz]);
    if (isStd) {
      let v;
      if (axis === 'x') v = ( (MNI2MM.x0 - c_mm) / MNI2MM.vx );
      else if (axis === 'y') v = ( (c_mm - MNI2MM.y0) / MNI2MM.vy );
      else v = ( (c_mm - MNI2MM.z0) / MNI2MM.vz );
      const idx = Math.round(v);
      return Math.max(0, Math.min(n-1, idx));
    }
    const mmPerVoxel = axis === 'x' ? vx : axis === 'y' ? vy : vz;
    const sign = AXIS_SIGN[axis];
    const v = (sign * (c_mm / mmPerVoxel)) + Math.floor(n/2);
    const idx = Math.round(v);
    return Math.max(0, Math.min(n-1, idx));
  }
  const formatSigned = (v) => {
    if (v == null || Number.isNaN(Number(v))) return '—'
    const n = Number(v)
    return (n >= 0 ? '+' : '') + n.toFixed(1)
  }
  // load background on mount
  useEffect(() => {
    let alive = true
    setLoadingBG(true); setErrBG('')
    ;(async () => {
      try {
        const bg = await loadNifti(MNI_BG_URL)
        if (!alive) return
        bgRef.current = bg
        // Always prefer BG dims for the canvas
        setDims(bg.dims)
        const [nx,ny,nz] = bg.dims
        const mx = Math.floor(nx/2), my = Math.floor(ny/2), mz = Math.floor(nz/2)
        setIx(mx); setIy(my); setIz(mz)
        setCx('0'); setCy('0'); setCz('0')
      } catch (e) {
        if (!alive) return
        setErrBG(e?.message || String(e))
        bgRef.current = null
      } finally {
        if (!alive) return
        setLoadingBG(false)
      }
    })()
    return () => { alive = false }
  }, [])

  
  // keep thrValue within current map range when map changes
  useEffect(() => {
    const mn = mapRef.current?.min ?? 0
    const mx = mapRef.current?.max ?? 1
    if (thrValue < mn || thrValue > mx) {
      setThrValue(Math.min(mx, Math.max(mn, thrValue)))
    }
  }, [mapRef.current, dims])

// load meta-analytic map when query/params change
  useEffect(() => {
    if (!mapUrl) { mapRef.current = null; return }
    let alive = true
    setLoadingMap(true); setErrMap('')
    ;(async () => {
      try {
        const mv = await loadNifti(mapUrl)
        if (!alive) return
        mapRef.current = mv
        if (!bgRef.current) {
          setDims(mv.dims)
          const [nx,ny,nz] = mv.dims
          const mx = Math.floor(nx/2), my = Math.floor(ny/2), mz = Math.floor(nz/2)
          setIx(mx); setIy(my); setIz(mz)
          setCx('0'); setCy('0'); setCz('0')
        }
      } catch (e) {
        if (!alive) return
        setErrMap(e?.message || String(e))
        mapRef.current = null
      } finally {
        if (!alive) return
        setLoadingMap(false)
      }
    })()
    return () => { alive = false }
  }, [mapUrl])

  const mapThreshold = useMemo(() => {
    const mv = mapRef.current
    if (!mv) return null
    if (thrMode === 'value') return Number(thrValue) || 0
    return percentile(mv.data, Math.max(0, Math.min(100, Number(pctl) || 95)))
  }, [thrMode, thrValue, pctl, mapRef.current])

  // draw one slice (upright orientation via vertical flip)
  function drawSlice (canvas, axis /* 'z' | 'y' | 'x' */, index) {
    const [nx, ny, nz] = dims

  // To show x>0 on the right side of the screen, horizontally flip X when sampling
    const sx = (x) => (X_RIGHT_ON_SCREEN_RIGHT ? (nx - 1 - x) : x);
    const bg  = bgRef.current
    const map = mapRef.current

    const dimsStr = dims.join('x')
    const bgOK  = !!(bg  && bg.dims.join('x')  === dimsStr)
    const mapOK = !!(map && map.dims.join('x') === dimsStr)

    let w=0, h=0, getBG=null, getMap=null
    if (axis === 'z') { w = nx; h = ny; if (bgOK)  getBG  = (x,y)=> bg.data[sx(x) + y*nx + index*nx*ny]; if (mapOK) getMap = (x,y)=> map.data[sx(x) + y*nx + index*nx*ny] }
    if (axis === 'y') { w = nx; h = nz; if (bgOK)  getBG  = (x,y)=> bg.data[sx(x) + index*nx + y*nx*ny]; if (mapOK) getMap = (x,y)=> map.data[sx(x) + index*nx + y*nx*ny] }
    if (axis === 'x') { w = ny; h = nz; if (bgOK)  getBG  = (x,y)=> bg.data[index + x*nx + y*nx*ny]; if (mapOK) getMap = (x,y)=> map.data[index + x*nx + y*nx*ny] }

    // HiDPI support: scale canvas by devicePixelRatio for crisp rendering
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    canvas.width = Math.max(1, Math.floor(w * dpr))
    canvas.height = Math.max(1, Math.floor(h * dpr))
    const ctx = canvas.getContext('2d', { willReadFrequently: false })
    // scale drawing so that 1 canvas pixel maps to 1 CSS pixel
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // create image buffer at native voxel size (w x h)
    const img = ctx.createImageData(w, h)

    const alpha = Math.max(0, Math.min(1, overlayAlpha))
    const R = 255, G = 0, B = 0
    const thr = mapThreshold

    // background normalization based on its own min/max
    const bgMin = bg?.min ?? 0
    const bgMax = bg?.max ?? 1
    const bgRange = (bgMax - bgMin) || 1

    let p = 0
    for (let yy=0; yy<h; yy++) {
      const srcY = h - 1 - yy // flip vertically
      for (let xx=0; xx<w; xx++) {
        // draw background
        let gray = 0
        if (getBG) {
          const vbg = getBG(xx, srcY)
          let g = (vbg - bgMin) / bgRange
          if (g < 0) g = 0
          if (g > 1) g = 1
          gray = (g * 255) | 0
        }
        img.data[p    ] = gray
        img.data[p + 1] = gray
        img.data[p + 2] = gray
        img.data[p + 3] = 255

        // overlay map
        if (getMap) {
          let mv = getMap(xx, srcY)
          const raw = mv
          if (useAbs) mv = Math.abs(mv)
          let pass = (thr == null) ? (mv > 0) : (mv >= thr)
          if (posOnly && raw <= 0) pass = false
          if (pass) {
            img.data[p    ] = ((1 - alpha) * img.data[p]     + alpha * R) | 0
            img.data[p + 1] = ((1 - alpha) * img.data[p + 1] + alpha * G) | 0
            img.data[p + 2] = ((1 - alpha) * img.data[p + 2] + alpha * B) | 0
          }
        }
        p += 4
      }
    }

  // draw into an offscreen canvas at native resolution, then scale to the visible canvas
    const off = document.createElement('canvas')
    off.width = w; off.height = h
    const offCtx = off.getContext('2d')
    offCtx.putImageData(img, 0, 0)

  // determine available size from canvas container and preserve aspect ratio with letterboxing
  const container = canvas.parentElement || canvas
  let availW = container?.clientWidth || canvas.clientWidth || w
  let availH = container?.clientHeight || canvas.clientHeight || 0
  if (!availH || availH <= 0) availH = Math.max(1, Math.round(availW * (h / w)))

  const scale = Math.max(1e-6, Math.min(availW / w, availH / h))
  const drawW = Math.max(1, Math.round(w * scale))
  const drawH = Math.max(1, Math.round(h * scale))
  const offsetX = Math.floor((availW - drawW) / 2)
  const offsetY = Math.floor((availH - drawH) / 2)

  // apply canvas CSS/backing size to the available area
  canvas.style.width = availW + 'px'
  canvas.style.height = availH + 'px'
  canvas.width = Math.max(1, Math.floor(availW * dpr))
  canvas.height = Math.max(1, Math.floor(availH * dpr))
    const ctx2 = canvas.getContext('2d', { willReadFrequently: false })
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx2.clearRect(0, 0, availW, availH)
  // draw scaled image centered with letterboxing
  ctx2.drawImage(off, 0, 0, w, h, offsetX, offsetY, drawW, drawH)

  // draw white crosshairs in display coordinates (scale from native indices)
    ctx2.save()
  ctx2.strokeStyle = '#ffffff'
    ctx2.lineWidth = 1
    let cx = 0, cy = 0
    const scaleX = drawW / w, scaleY = drawH / h
    if (axis === 'z') { // plane: X by Y
      const xi = Math.max(0, Math.min(w-1, (X_RIGHT_ON_SCREEN_RIGHT ? (w - 1 - ix) : ix)))
      const yi = Math.max(0, Math.min(h-1, iy))
      cx = Math.round(offsetX + xi * scaleX)
      cy = Math.round(offsetY + yi * scaleY)
    } else if (axis === 'y') { // plane: X by Z
      const xi = Math.max(0, Math.min(w-1, (X_RIGHT_ON_SCREEN_RIGHT ? (w - 1 - ix) : ix)))
      const zi = Math.max(0, Math.min(h-1, iz))
      cx = Math.round(offsetX + xi * scaleX)
      cy = Math.round(offsetY + zi * scaleY)
    } else { // axis === 'x' (plane: Y by Z)
      const yi = Math.max(0, Math.min(w-1, iy))
      const zi = Math.max(0, Math.min(h-1, iz))
      cx = Math.round(offsetX + yi * scaleX)
      cy = Math.round(offsetY + zi * scaleY)
    }
    const screenY = offsetY + (drawH - 1 - (cy - offsetY)) // account for vertical flip within draw area
    // vertical line within draw area
    ctx2.beginPath(); ctx2.moveTo(cx + 0.5, offsetY); ctx2.lineTo(cx + 0.5, offsetY + drawH); ctx2.stroke()
    // horizontal line within draw area
    ctx2.beginPath(); ctx2.moveTo(offsetX, screenY + 0.5); ctx2.lineTo(offsetX + drawW, screenY + 0.5); ctx2.stroke()
    ctx2.restore()
  }

  // click-to-move crosshairs
  function onCanvasClick (e, axis) {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top

    // derive plane dims
    const [nx, ny, nz] = dims
    let w=0, h=0
    if (axis === 'z') { w = nx; h = ny }
    if (axis === 'y') { w = nx; h = nz }
    if (axis === 'x') { w = ny; h = nz }

    // compute drawing geometry (must mirror drawSlice)
    const availW = rect.width
    let availH = rect.height || 0
    if (!availH || availH <= 0) availH = Math.max(1, Math.round(availW * (h / w)))
    const scale = Math.max(1e-6, Math.min(availW / w, availH / h))
    const drawW = Math.max(1, Math.round(w * scale))
    const drawH = Math.max(1, Math.round(h * scale))
    const offsetX = Math.floor((availW - drawW) / 2)
    const offsetY = Math.floor((availH - drawH) / 2)

    // ignore clicks outside the drawn image area (letterbox zones)
    if (px < offsetX || px > offsetX + drawW || py < offsetY || py > offsetY + drawH) return

    const scaleX = drawW / w
    const scaleY = drawH / h
    const imgX = Math.floor((px - offsetX) / scaleX)
    const imgY = Math.floor((py - offsetY) / scaleY)
    const srcY = h - 1 - imgY // invert because we draw with vertical flip

    const toIdxX = (screenX) => (X_RIGHT_ON_SCREEN_RIGHT ? (nx - 1 - screenX) : screenX)
    if (axis === 'z') {
      const xi = toIdxX(imgX)
      setIx(xi); setIy(srcY)
      setCx(String(idx2coord(xi, nx, 'x'))); setCy(String(idx2coord(srcY, ny, 'y')))
    } else if (axis === 'y') {
      const xi = toIdxX(imgX)
      setIx(xi); setIz(srcY)
      setCx(String(idx2coord(xi, nx, 'x'))); setCz(String(idx2coord(srcY, nz, 'z')))
    } else {
      setIy(imgX); setIz(srcY)
      setCy(String(idx2coord(imgX, ny, 'y'))); setCz(String(idx2coord(srcY, nz, 'z')))
    }
  }

  // keep display coords in sync when ix/iy/iz/dims change (e.g., after loads)
  useEffect(() => {
    const [nx,ny,nz] = dims
    if (!nx) return
    setCx(String(idx2coord(ix, nx, 'x')))
    setCy(String(idx2coord(iy, ny, 'y')))
    setCz(String(idx2coord(iz, nz, 'z')))
  }, [ix,iy,iz,dims])

  // commit handlers: parse signed integer, map to index, clamp to volume
  const commitCoord = (axis) => {
    const [nx,ny,nz] = dims
    let vStr = axis==='x' ? cx : axis==='y' ? cy : cz
    // allow empty / '-' temporary states
    if (vStr === '' || vStr === '-' ) return
    const parsed = parseFloat(vStr)
    if (Number.isNaN(parsed)) return
    if (axis==='x') setIx(coord2idx(parsed, nx, 'x'))
    if (axis==='y') setIy(coord2idx(parsed, ny, 'y'))
    if (axis==='z') setIz(coord2idx(parsed, nz, 'z'))
  }

  // redraw on state changes
  useEffect(() => {
    const [nx, ny, nz] = dims
    if (!nx) return
    const c0 = canvases[0].current, c1 = canvases[1].current, c2 = canvases[2].current
    // draw all slices that exist
    if (c0 && iz >=0 && iz < nz) drawSlice(c0, 'z', iz)
    if (c1 && iy >=0 && iy < ny) drawSlice(c1, 'y', iy)
    if (c2 && ix >=0 && ix < nx) drawSlice(c2, 'x', ix)
    // Also ensure a redraw shortly after layout changes (expand/collapse)
    // to avoid canvases appearing blank when their CSS size changes.
    const raf = requestAnimationFrame(() => {
      if (c0 && iz >=0 && iz < nz) drawSlice(c0, 'z', iz)
      if (c1 && iy >=0 && iy < ny) drawSlice(c1, 'y', iy)
      if (c2 && ix >=0 && ix < nx) drawSlice(c2, 'x', ix)
    })

    // delayed fallback for very slow layout engines
    const delayed = setTimeout(() => {
      if (c0 && iz >=0 && iz < nz) drawSlice(c0, 'z', iz)
      if (c1 && iy >=0 && iy < ny) drawSlice(c1, 'y', iy)
      if (c2 && ix >=0 && ix < nx) drawSlice(c2, 'x', ix)
    }, 250)

    // ResizeObserver: watch canvas containers and redraw on changes
    if (typeof ResizeObserver !== 'undefined') {
      // disconnect any previous observer to avoid duplicates
      try { resizeObserverRef.current?.disconnect?.() } catch (e) {}
      resizeObserverRef.current = new ResizeObserver((entries) => {
        // schedule redraw on next frame to allow layout to settle
        requestAnimationFrame(() => {
          entries.forEach(() => {
            if (c0 && iz >=0 && iz < nz) drawSlice(c0, 'z', iz)
            if (c1 && iy >=0 && iy < ny) drawSlice(c1, 'y', iy)
            if (c2 && ix >=0 && ix < nx) drawSlice(c2, 'x', ix)
          })
        })
      })
      try {
        if (c0) resizeObserverRef.current.observe(c0.parentElement || c0)
        if (c1) resizeObserverRef.current.observe(c1.parentElement || c1)
        if (c2) resizeObserverRef.current.observe(c2.parentElement || c2)
      } catch (e) {
        // ignore observation errors
      }
    }

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(delayed)
      try { resizeObserverRef.current?.disconnect?.() } catch (e) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dims, ix, iy, iz,
    overlayAlpha, posOnly, useAbs, thrMode, pctl, thrValue,
    loadingBG, loadingMap, errBG, errMap, query,
    expandedSlice, expandedHeight
  ])

  const [nx, ny, nz] = dims

  // slice configs (labels only; numbers removed) - render in X, Y, Z order
  const sliceConfigs = [
    { key: 'x', name: 'Sagittal', axisLabel: 'X', index: ix, setIndex: setIx, max: Math.max(0, nx-1), canvasRef: canvases[2] },
    { key: 'y', name: 'Coronal',  axisLabel: 'Y', index: iy, setIndex: setIy, max: Math.max(0, ny-1), canvasRef: canvases[1] },
    { key: 'z', name: 'Axial',    axisLabel: 'Z', index: iz, setIndex: setIz, max: Math.max(0, nz-1), canvasRef: canvases[0] },
  ]

  // shared small input styles to mimic Neurosynth (compact bordered boxes)
  const nsInputCls = 'w-16 rounded border border-gray-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400'
  const nsLabelCls = 'mr-1 text-sm'

  return (
    <div className='niiviewer flex flex-col gap-3'>
      <style>{`
        /* NiiViewer responsive controls */
        .niiviewer-controls .row { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
        .niiviewer-controls .coords { display: flex; gap: 0.75rem; align-items: center; flex-wrap: nowrap; }
        @media (max-width: 768px) {
          .niiviewer-controls .row { flex-direction: column; align-items: stretch; }
          .niiviewer-controls .coords { flex-direction: row; flex-wrap: wrap; }
          .niiviewer-controls .coords label { flex: 1 1 45%; min-width: 120px; }
        }
        /* Row of two thumbnails when expanded */
  .expanded-thumbs-row { display:flex; flex-direction:row; gap:16px; justify-content:center; align-items:stretch; flex-wrap:nowrap; margin-bottom:24px; }
        .expanded-thumbs-row .niiviewer-card { flex:0 0 300px; max-width:300px; width:300px; }
        @media (max-width: 680px) { /* allow wrap on very small screens */
          .expanded-thumbs-row { flex-wrap:wrap; }
          .expanded-thumbs-row .niiviewer-card { flex:1 1 100%; max-width:none; width:100%; }
        }
        /* Align threshold controls: fixed label width so inputs line up */
        .threshold-row .controls--field { display:flex; align-items:center; gap:8px; }
        .threshold-row .controls--field .niilabel { display:inline-block; min-width: 130px; }
        @media (max-width: 640px) {
          .threshold-row .controls--field .niilabel { min-width: 110px; }
        }
  /* Ensure overlay block sits below thumbnails without overlap */
  .overlay-block { margin-top: 12px; }
  /* Deep blue icon button */
  .download-btn-deepblue { background:#0b1b3f; color:#eaf2ff; border:1px solid #193065; transition:background .15s ease, color .15s ease, box-shadow .15s ease; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.4); }
  .download-btn-deepblue:hover { background:#0e2456; border-color:#25448b; }
  .download-btn-deepblue:active { background:#09142f; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); }
  .download-btn-deepblue svg { stroke: currentColor; }
  /* Overlay alpha slider (high contrast) */
  .overlay-alpha-slider { width:160px; appearance:none; height:10px; background:#ffffff; border-radius:6px; outline:none; cursor:pointer; }
  .overlay-alpha-slider:focus { box-shadow:0 0 0 3px rgba(255,255,255,0.35); }
  .overlay-alpha-slider::-webkit-slider-runnable-track { height:10px; background:#ffffff; border-radius:6px; }
  .overlay-alpha-slider::-webkit-slider-thumb { appearance:none; width:20px; height:20px; background:#ffffff; border:2px solid #ffffff; border-radius:50%; margin-top:-5px; box-shadow:0 0 0 2px rgba(0,0,0,0.25); }
  .overlay-alpha-slider:active::-webkit-slider-thumb { filter:brightness(0.9); }
  .overlay-alpha-slider::-moz-range-track { height:10px; background:#ffffff; border-radius:6px; }
  .overlay-alpha-slider::-moz-range-thumb { width:20px; height:20px; background:#ffffff; border:2px solid #ffffff; border-radius:50%; box-shadow:0 0 0 2px rgba(0,0,0,0.25); }
  .overlay-alpha-slider:active::-moz-range-thumb { filter:brightness(0.9); }
  .overlay-block .niilabel { color:#ffffff !important; }
  /* Tech-styled UI control (blue glow + subtle gradient) */
  .ui-control { 
    --uic-bg: linear-gradient(180deg, #0c1a3a 0%, #08122a 100%);
    --uic-bg-hover: linear-gradient(180deg, #102452 0%, #0a1738 100%);
    --uic-bg-active: linear-gradient(180deg, #0a1738 0%, #07102a 100%);
    --uic-border: rgba(56, 108, 217, 0.55); /* #386cd9 */
    --uic-border-hover: rgba(88, 140, 245, 0.8);
    --uic-border-focus: #5a8bff;
    --uic-text: #eaf2ff; 
    --uic-placeholder: #9ab3e6; 
    --uic-caret: #7fb0ff;
    font-size: 0.8125rem; /* 13px */
    line-height: 1.2; 
    font-weight: 500; 
    padding: 6px 10px; 
    border-radius: 8px; 
    border: 1px solid var(--uic-border); 
    background: var(--uic-bg); 
    color: var(--uic-text); 
    height: 34px; 
    display: inline-flex; 
    align-items: center; 
    gap: 4px; 
    appearance: none; 
    -webkit-appearance: none; 
    -moz-appearance: none;
    caret-color: var(--uic-caret);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03), 0 1px 1px rgba(0,0,0,0.35);
    transition: border-color .15s ease, box-shadow .15s ease, background .2s ease, filter .2s ease; 
  }
  .ui-control:hover { 
    border-color: var(--uic-border-hover); 
    background: var(--uic-bg-hover);
  }
  .ui-control:active {
    background: var(--uic-bg-active);
    filter: saturate(1.05);
  }
  .ui-control:focus { 
    outline: none; 
    border-color: var(--uic-border-focus); 
    /* Softer, tighter focus glow */
    box-shadow: 0 0 0 1.5px rgba(90,139,255,0.22), inset 0 0 0 1px rgba(255,255,255,0.05); 
  }
  .ui-control::placeholder { color: var(--uic-placeholder); opacity: .9; }
  /* Light mode (tech tint) */
  @media (prefers-color-scheme: light) { 
    .ui-control { 
      --uic-bg: linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%);
      --uic-bg-hover: linear-gradient(180deg, #eef4ff 0%, #e3edff 100%);
      --uic-bg-active: linear-gradient(180deg, #e3edff 0%, #d9e6ff 100%);
      --uic-border:#93b5ff; 
      --uic-border-hover:#7aa4ff; 
      --uic-border-focus:#4d79ff; 
      --uic-text:#132036; 
      --uic-placeholder:#5b6b80; 
      --uic-caret:#3f72ff;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.02), 0 1px 1px rgba(0,0,0,0.06);
    } 
  }
  /* Remove number input spinners */
  .ui-control[type=number]::-webkit-inner-spin-button,
  .ui-control[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .ui-control[type=number] { -moz-appearance: textfield; }
  /* Custom caret / dropdown arrow for select */
  .ui-controlselect-wrap { position: relative; display: inline-flex; }
  .ui-controlselect-wrap::after { content: "\\25BE"; position: absolute; right: 10px; top: 50%; transform: translateY(-55%); pointer-events: none; font-size: 0.65rem; color: var(--uic-placeholder); }
  .ui-control.ui-has-arrow { padding-right: 26px; }
  /* High contrast focus for keyboard navigation */
  .ui-control:focus-visible { box-shadow: 0 0 0 1.5px rgba(130,170,255,0.28); border-color: var(--uic-border-focus); }
  /* Disabled state */
  .ui-control:disabled { opacity: .55; cursor: not-allowed; }
  /* Threshold capsule width */
  .threshold-capsule { max-width: 640px; margin: 0 auto; }
  @media (max-width: 768px) { .threshold-capsule { max-width: 100%; } }
  /* Tech-styled threshold capsule */
  .threshold-capsule {
    --thr-accent: #5a8bff;
    position: relative;
    border-radius: 12px;
    border: 1px solid rgba(90,139,255,0.35);
    background: linear-gradient(180deg, #0c1530 0%, #0a1126 100%);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03), 0 6px 18px rgba(8,18,42,0.35);
  }
  .threshold-capsule::before {
    content: '';
    position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
    background-image:
      linear-gradient(rgba(90,139,255,0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(90,139,255,0.06) 1px, transparent 1px);
    background-size: 22px 22px;
    opacity: .45;
    mask-image: radial-gradient(ellipse at center, rgba(255,255,255,0.8), rgba(255,255,255,0.05) 70%);
  }
  .threshold-capsule::after {
    content: '';
    position: absolute; left: 8px; right: 8px; top: 0; height: 2px;
    background: linear-gradient(90deg, transparent, var(--thr-accent), transparent);
    opacity: .85;
  }
  .threshold-row .controls--field .niilabel {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11.5px;
    color: #9ab3e6;
  }
  .threshold-row > .flex + .flex {
    border-top: 1px solid rgba(90,139,255,0.18);
    padding-top: 10px;
  }
  /* Make Overlay alpha label match FWHM label typography */
  .overlay-block .controls--field .niilabel {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11.5px;
    color: #9ab3e6;
  }
  /* Floating download button styling */
  .nii-download-fab {
    position: absolute;
    top: -6px; right: 0;
    width: 44px; height: 44px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 12px;
    background: radial-gradient(circle at 30% 25%, #1d3a72, #0b1834 70%);
    color: #e6f1ff;
    border: 1px solid rgba(120,170,255,0.35);
    box-shadow: 0 4px 14px -2px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.05);
    backdrop-filter: blur(3px) saturate(1.4);
    -webkit-backdrop-filter: blur(3px) saturate(1.4);
    transition: background .35s ease, transform .22s cubic-bezier(.25,.8,.25,1), box-shadow .25s ease, border-color .25s ease;
  }
  .nii-download-fab:hover {
    background: radial-gradient(circle at 30% 25%, #254b90, #0f2346 75%);
    transform: translateY(-2px);
    box-shadow: 0 8px 22px -4px rgba(0,0,0,0.6), 0 0 0 1px rgba(130,180,255,0.25);
    border-color: rgba(150,200,255,0.55);
  }
  .nii-download-fab:active {
    transform: translateY(0);
    background: radial-gradient(circle at 30% 25%, #1b335f, #0d1d3b 70%);
    box-shadow: 0 4px 12px -2px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.04);
  }
  .nii-download-fab svg { stroke: currentColor; }
  /* Camera FAB */
  .nii-snapshot-fab {
    position: absolute;
    top: -6px; right: 52px;
    width: 44px; height: 44px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 12px;
    background: radial-gradient(circle at 30% 25%, #1b4d4f, #0b1f21 70%);
    color: #eafcff; border: 1px solid rgba(120,220,220,0.35);
    box-shadow: 0 4px 14px -2px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.05);
    backdrop-filter: blur(3px) saturate(1.4);
    -webkit-backdrop-filter: blur(3px) saturate(1.4);
    transition: background .3s ease, transform .22s cubic-bezier(.25,.8,.25,1);
  }
  .nii-snapshot-fab:hover { background: radial-gradient(circle at 30% 25%, #206063, #103033 75%); transform: translateY(-2px); }
  .nii-snapshot-fab:active { transform: translateY(0); }
  .nii-snapshot-fab svg { stroke: currentColor; }
  /* Snapshots grid */
  .snapshots-block .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap:10px; }
  .snapshot-card { position:relative; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; background:#fff; }
  .snapshot-card img { display:block; width:100%; height:90px; object-fit:cover; }
  .snapshot-actions { position:absolute; right:6px; bottom:6px; display:flex; gap:6px; }
  .snapshot-actions button { background:rgba(0,0,0,0.65); color:#fff; border:none; border-radius:6px; padding:4px 6px; font-size:11px; }
      `}</style>
      <div className='flex items-center justify-between w-full card__title relative'>
        <div className='text-base font-semibold tracking-wide'>NIfTI Viewer</div>
        <button
          aria-label='Download map'
          title='Download map'
          className='nii-download-fab'
          onClick={() => {
            if (mapRef.current && mapUrl) {
              window.open(mapUrl, '_blank')
            } else {
              setToast({ msg: 'Map not ready yet. Try again after the map finishes generating.', visible: true })
              if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
              toastTimerRef.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000)
            }
          }}
        >
          <svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            <path d='M12 3v12' />
            <path d='m7 11 5 5 5-5' />
            <path d='M5 21h14' />
          </svg>
        </button>
        <button
          aria-label='Save snapshot'
          title='Save snapshot'
          className='nii-snapshot-fab'
          onClick={() => {
            // capture current view (expanded slice if any; otherwise all three slices)
            const items = []
            const makeMeta = (sliceKey) => ({ slice: sliceKey, ix, iy, iz, thrMode, pctl, thrValue, overlayAlpha, ts: Date.now() })
            const cap = (sliceKey, ref) => {
              const c = ref?.current
              if (!c) return
              try {
                const url = c.toDataURL('image/png')
                items.push({ id: `${Date.now()}-${sliceKey}-${Math.random().toString(36).slice(2)}`, url, ...makeMeta(sliceKey) })
              } catch (e) { /* ignore capture errors */ }
            }
            if (expandedSlice) {
              const cfg = { x: canvases[2], y: canvases[1], z: canvases[0] }[expandedSlice]
              cap(expandedSlice, cfg)
            } else {
              cap('x', canvases[2]); cap('y', canvases[1]); cap('z', canvases[0])
            }
            if (items.length) {
              const next = [...items, ...snapshots].slice(0, 24)
              persistSnapshots(next)
            } else {
              setToast({ msg: 'Canvas not ready to capture.', visible: true })
              if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
              toastTimerRef.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 2500)
            }
          }}
        >
          <svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            <path d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z'></path>
            <circle cx='12' cy='13' r='4'></circle>
          </svg>
        </button>
      </div>

      {/* --- Threshold mode & value --- */}
  <div className='rounded-xl border p-3 text-sm niiviewer-controls controls--capsule threshold-capsule'>
        <div className='row threshold-row bar-black controls--modern' style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
          <div className='flex flex-wrap items-center gap-3'>
            <label className='controls--field'>
              <span className='niilabel'>Threshold mode</span>
              <span className='ui-controlselect-wrap'>
                <select value={thrMode} onChange={e=>setThrMode(e.target.value)} className='ui-control ui-has-arrow'>
                  <option value='value'>Value</option>
                  <option value='pctl'>Percentile</option>
                </select>
              </span>
            </label>
          </div>
          <div className='flex flex-wrap items-center gap-3'>
            {thrMode === 'value' ? (
              <label className='controls--field'>
                <span className='niilabel'>Threshold</span>
                <input type='number' step='0.01' value={thrValue} onChange={e=>setThrValue(Number(e.target.value))} className='ui-control' />
              </label>
            ) : (
              <label className='controls--field'>
                <span className='niilabel'>Percentile</span>
                <input type='number' min={50} max={99.9} step={0.5} value={pctl} onChange={e=>setPctl(Number(e.target.value)||95)} className='ui-control' />
              </label>
            )}
            <label className='controls--field'>
              <span className='niilabel'>Gaussian FWHM</span>
              <input type='number' step='0.5' value={fwhm} onChange={e=>setFwhm(Number(e.target.value)||0)} className='ui-control' />
            </label>
          </div>
        </div>

  {/* per-slice coordinate inputs are rendered below each canvas */}
      </div>

      {/* --- Brain views --- */}
      {(loadingBG || loadingMap) && (
        <div className='grid gap-3 lg:grid-cols-3'>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className='h-64 animate-pulse rounded-xl border bg-gray-100' />
          ))}
        </div>
      )}
      {(errBG || errMap) && (
        <div className='rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800'>
          {errBG && <div>Background: {errBG}</div>}
          {errMap && <div>Map: {errMap}</div>}
        </div>
      )}

      {!!nx && (
        // If a slice is expanded, show it full-width and place the other two as small thumbnails below.
        expandedSlice ? (
          <div className='flex flex-col gap-4'>
            {sliceConfigs.filter(s => s.key === expandedSlice).map(({ key, name, axisLabel, index, max, canvasRef }) => {
              const coordVal = Number(idx2coord(index, axisLabel==='X'? nx : axisLabel==='Y'? ny : nz, axisLabel.toLowerCase()))
              return (
                <div key={key} className='niiviewer-card flex flex-col gap-2 rounded-xl bg-white shadow-md p-3' style={{ transition: 'all 260ms cubic-bezier(.2,.9,.2,1)' }}>
                  <div className='flex items-center justify-between'>
                    <div className='text-sm font-bold'>{name} <span className='text-sm text-gray-500'>({axisLabel})</span></div>
                    <div className='flex items-center gap-2'>
                      <div className='text-sm text-gray-600'>
                        idx: <strong>{index}</strong> — {axisLabel} = <strong>{formatSigned(coordVal)} mm</strong>
                      </div>
                      <button className='btn-deepblue text-sm ml-2' style={{ padding: '4px 10px' }} onClick={() => setExpandedSlice(null)}>Collapse</button>
                    </div>
                  </div>

                  <div className='flex-1 flex items-center'>
                    <canvas ref={canvasRef} className='w-full h-full rounded-md border' onClick={(e)=>onCanvasClick(e, key)} style={{ cursor: 'crosshair', minHeight: expandedHeight }} tabIndex={0} />
                  </div>

                  <div className='mt-2'>
                    <input
                      type='range'
                      min={0}
                      max={max}
                      value={key==='x' ? sliderPos.x : key==='y' ? sliderPos.y : sliderPos.z}
                      onChange={e => {
                        const v = Number(e.target.value)
                        setSliderPos(p => ({ ...p, [key]: v }))
                        if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key])
                        debounceRefs.current[key] = setTimeout(() => {
                          if (key === 'x') setIx(v)
                          else if (key === 'y') setIy(v)
                          else setIz(v)
                          debounceRefs.current[key] = null
                        }, 120)
                      }}
                      className='w-full'
                    />
                  </div>

                  <div className='mt-2 flex items-center gap-2'>
                    <label className='flex items-center gap-2'>
                      <span className='text-sm text-gray-600'>{axisLabel} (mm, MNI):</span>
                      <input
                        type='text' inputMode='decimal' pattern='-?[0-9]*([.][0-9]+)?'
                        className={nsInputCls}
                        value={axisLabel === 'X' ? cx : axisLabel === 'Y' ? cy : cz}
                        onChange={e => { if (axisLabel === 'X') setCx(e.target.value); else if (axisLabel === 'Y') setCy(e.target.value); else setCz(e.target.value) }}
                        onBlur={() => { if (axisLabel === 'X') commitCoord('x'); else if (axisLabel === 'Y') commitCoord('y'); else commitCoord('z') }}
                        onKeyDown={e => { if (e.key === 'Enter') { if (axisLabel === 'X') commitCoord('x'); else if (axisLabel === 'Y') commitCoord('y'); else commitCoord('z') } }}
                        aria-label={`${axisLabel} coordinate (centered)`}
                      />
                    </label>
                  </div>
                </div>
              )
            })}

    <div className='expanded-thumbs-row'>
              {sliceConfigs.filter(s => s.key !== expandedSlice).map(({ key, name, axisLabel, index, max, canvasRef }) => {
                const coordVal = Number(idx2coord(index, axisLabel==='X'? nx : axisLabel==='Y'? ny : nz, axisLabel.toLowerCase()))
                return (
      <div key={key} className='niiviewer-card flex flex-col gap-2 rounded-lg bg-white border p-2'>
                    <div className='flex items-center justify-between'>
                      <div className='text-sm font-bold'>{name} <span className='text-sm text-gray-500'>({axisLabel})</span></div>
                      <div className='text-sm text-gray-600'>idx: <strong>{index}</strong></div>
                    </div>
                    <div className='flex-1 flex items-center' style={{ minHeight: 140 }}>
                      <canvas ref={canvasRef} className='w-full h-full rounded-sm border' onClick={(e)=>onCanvasClick(e, key)} style={{ cursor: 'crosshair' }} tabIndex={0} />
                    </div>
                    <div className='mt-2'>
                      <input
                        type='range'
                        min={0}
                        max={max}
                        value={key==='x' ? sliderPos.x : key==='y' ? sliderPos.y : sliderPos.z}
                        onChange={e => {
                          const v = Number(e.target.value)
                          setSliderPos(p => ({ ...p, [key]: v }))
                          // debounce commit
                          if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key])
                          debounceRefs.current[key] = setTimeout(() => {
                            if (key === 'x') setIx(v)
                            else if (key === 'y') setIy(v)
                            else setIz(v)
                            debounceRefs.current[key] = null
                          }, 120)
                        }}
                        className='w-full'
                      />
                    </div>
                    <div className='mt-2 flex justify-end'>
                      <button title={`Zoom ${name}`} className='operator-btn btn-deepblue text-sm' onClick={() => setExpandedSlice(key)} style={{ padding: '6px 8px' }}>🔍</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className='grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch' style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
            {sliceConfigs.map(({ key, name, axisLabel, index, setIndex, max, canvasRef }) => {
              const coordVal = Number(idx2coord(index, axisLabel==='X'? nx : axisLabel==='Y'? ny : nz, axisLabel.toLowerCase()))
              return (
                <div key={key} className='niiviewer-card flex flex-col gap-2 rounded-xl bg-white shadow-md p-3'>
                  <div className='flex items-center justify-between'>
                    <div className='text-sm font-bold'>{name} <span className='text-sm text-gray-500'>({axisLabel})</span></div>
                    <div className='text-sm text-gray-600'>
                      idx: <strong>{index}</strong> — {axisLabel} = <strong>{formatSigned(coordVal)} mm</strong>
                    </div>
                  </div>

                    <div className='flex-1 flex items-center'>
                      <canvas ref={canvasRef} className='w-full h-full rounded-md border' onClick={(e)=>onCanvasClick(e, key)} style={{ cursor: 'crosshair', minHeight: 160 }} tabIndex={0} />
                    </div>
                    <div className='mt-2 flex justify-end'>
                      <button title={`Zoom ${name}`} className='operator-btn btn-deepblue text-sm' onClick={() => setExpandedSlice(key)} style={{ padding: '6px 8px' }}>🔍</button>
                    </div>

                  <div className='mt-2'>
                    <input
                      type='range'
                      min={0}
                      max={max}
                      value={key==='x' ? sliderPos.x : key==='y' ? sliderPos.y : sliderPos.z}
                      onChange={e => {
                        const v = Number(e.target.value)
                        setSliderPos(p => ({ ...p, [key]: v }))
                        // debounce commit
                        if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key])
                        debounceRefs.current[key] = setTimeout(() => {
                          if (key === 'x') setIx(v)
                          else if (key === 'y') setIy(v)
                          else setIz(v)
                          debounceRefs.current[key] = null
                        }, 120)
                      }}
                      className='w-full'
                    />
                  </div>

                  <div className='mt-2 flex items-center gap-2'>
                    <label className='flex items-center gap-2'>
                      <span className='text-sm text-gray-600'>{axisLabel} (mm, MNI):</span>
                      <input
                        type='text' inputMode='decimal' pattern='-?[0-9]*([.][0-9]+)?'
                        className={nsInputCls}
                        value={axisLabel === 'X' ? cx : axisLabel === 'Y' ? cy : cz}
                        onChange={e => { if (axisLabel === 'X') setCx(e.target.value); else if (axisLabel === 'Y') setCy(e.target.value); else setCz(e.target.value) }}
                        onBlur={() => { if (axisLabel === 'X') commitCoord('x'); else if (axisLabel === 'Y') commitCoord('y'); else commitCoord('z') }}
                        onKeyDown={e => { if (e.key === 'Enter') { if (axisLabel === 'X') commitCoord('x'); else if (axisLabel === 'Y') commitCoord('y'); else commitCoord('z') } }}
                        aria-label={`${axisLabel} coordinate (centered)`}
                      />
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

  {/* map generation params moved into the threshold row above */}

      {/* overlay controls */}
  <div className='rounded-xl border p-3 text-sm controls--capsule overlay-block'>
        <div className='controls--field' style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className='niilabel'>Overlay alpha</span>
          <input type='range' min={0} max={1} step={0.05} value={overlayAlpha} onChange={e=>setOverlayAlpha(Number(e.target.value))} className='overlay-alpha-slider' />
        </div>
      </div>

      {/* snapshots gallery */}
      {snapshots.length > 0 && (
        <div className='rounded-xl border p-3 text-sm controls--capsule snapshots-block'>
          <div className='flex items-center justify-between mb-2'>
            <div className='font-semibold'>Snapshots <span className='text-gray-500'>({snapshots.length})</span></div>
            <div className='flex items-center gap-2'>
              <button className='btn-deepblue text-xs' onClick={() => persistSnapshots([])}>Clear</button>
            </div>
          </div>
          <div className='grid'>
            {snapshots.map(s => (
              <div key={s.id} className='snapshot-card'>
                <a href={s.url} target='_blank' rel='noopener noreferrer' title={`${s.slice.toUpperCase()} ix:${ix} iy:${iy} iz:${iz}`}>
                  <img src={s.url} alt={`snapshot ${s.slice}`} />
                </a>
                <div className='snapshot-actions'>
                  <a className='no-underline' href={s.url} download={`snapshot-${s.slice}-${s.ts}.png`}>DL</a>
                  <button onClick={() => persistSnapshots(snapshots.filter(x => x.id !== s.id))}>✖</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}