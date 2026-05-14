import { useEffect, useRef } from 'react'
import { sampleCubePatterns } from '@/components/ui/cube-patterns'

const GAP = 2
const TARGET_CELL = 12
const MAX_CELLS_DEFAULT = 5500
const MAX_CELLS_REDUCED_MOTION = 1800
/** Draw field larger than viewport so edges fade softly instead of hard clip. */
const VIEW_BLEED = 1.18

function computeGrid(w: number, h: number, maxCells: number) {
  const idealCols = Math.max(18, Math.floor(w / TARGET_CELL))
  const idealRows = Math.max(14, Math.floor(h / TARGET_CELL))
  let cols = idealCols
  let rows = idealRows
  if (cols * rows > maxCells) {
    const scale = Math.sqrt((cols * rows) / maxCells)
    cols = Math.max(22, Math.floor(cols / scale))
    rows = Math.max(18, Math.floor(rows / scale))
  }
  const cell = Math.min((w - (cols - 1) * GAP) / cols, (h - (rows - 1) * GAP) / rows)
  const offsetX = (w - (cols * cell + (cols - 1) * GAP)) / 2
  const offsetY = (h - (rows * cell + (rows - 1) * GAP)) / 2
  return { cols, rows, cell, offsetX, offsetY }
}

export function CubesBackground() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef({ cols: 0, rows: 0, cell: 10, offsetX: 0, offsetY: 0, w: 0, h: 0 })
  const mountRef = useRef(0)
  const reducedMotionRef = useRef(false)
  const timeAccRef = useRef({ lastFrame: 0, simTime: 0 })

  useEffect(() => {
    mountRef.current = performance.now()
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const ctx = canvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
    } as Record<string, boolean>) as CanvasRenderingContext2D | null
    if (!ctx) return

    let raf = 0
    let active = true

    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotionRef.current = mqReduce.matches

    const layout = () => {
      const rect = container.getBoundingClientRect()
      const vw = Math.max(1, Math.floor(rect.width))
      const vh = Math.max(1, Math.floor(rect.height))
      const w = Math.max(1, Math.floor(vw * VIEW_BLEED))
      const h = Math.max(1, Math.floor(vh * VIEW_BLEED))
      const maxCells = reducedMotionRef.current ? MAX_CELLS_REDUCED_MOTION : MAX_CELLS_DEFAULT
      const g = computeGrid(w, h, maxCells)
      gridRef.current = { ...g, w, h }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const syncReduce = () => {
      reducedMotionRef.current = mqReduce.matches
      layout()
    }
    mqReduce.addEventListener('change', syncReduce)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        layout()
      }
    }

    layout()
    const ro = new ResizeObserver(() => layout())
    ro.observe(container)
    document.addEventListener('visibilitychange', onVisibility)

    const draw = (frameTime: number) => {
      if (timeAccRef.current.lastFrame === 0) {
        timeAccRef.current.lastFrame = frameTime
      }
      
      if (!active || document.visibilityState !== 'visible') {
        timeAccRef.current.lastFrame = frameTime
        raf = requestAnimationFrame(draw)
        return
      }

      let dt = frameTime - timeAccRef.current.lastFrame
      if (dt < 0) dt = 0
      timeAccRef.current.lastFrame = frameTime
      timeAccRef.current.simTime += Math.min(dt, 50) // Cap max delta to avoid huge jumps
      
      const { cols, rows, cell, offsetX, offsetY, w, h } = gridRef.current
      if (cols < 2 || rows < 2) {
        raf = requestAnimationFrame(draw)
        return
      }

      const reduced = reducedMotionRef.current
      const timeSec = timeAccRef.current.simTime * 0.001

      ctx.clearRect(0, 0, w, h)

      const age = (frameTime - mountRef.current) * 0.001
      const intro = Math.min(1, age * 0.85)
      const radius = Math.max(0.6, Math.min(cell * 0.2, 2.4))

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const tx = offsetX + col * (cell + GAP)
          const ty = offsetY + row * (cell + GAP)

          const s = sampleCubePatterns(col, row, cols, rows, timeSec, reduced)

          const dCenter = Math.hypot(col - cols / 2, row - rows / 2)
          const stagger = Math.min(1, Math.max(0, intro * 1.15 - dCenter * 0.008))
          const pop = 0.82 + 0.18 * (1 - Math.pow(1 - stagger, 2))

          const cellDraw = cell * pop
          const off = (cell - cellDraw) / 2

          const hue = ((s.hue % 360) + 360) % 360
          const sat = Math.min(88, Math.max(8, s.sat))
          const light = Math.min(72, Math.max(16, s.light))

          const fill = `hsl(${hue.toFixed(1)},${sat.toFixed(1)}%,${light.toFixed(1)}%)`
          const liftY = ty - s.lift * 1.12

          ctx.fillStyle = fill
          const x0 = tx + off
          const y0 = liftY + off
          ctx.beginPath()
          ctx.roundRect(x0, y0, cellDraw, cellDraw, radius)
          ctx.fill()
        }
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)

    return () => {
      active = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      mqReduce.removeEventListener('change', syncReduce)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-0 z-0 min-h-[100dvh] w-full overflow-visible"
    >
      <div className="absolute left-1/2 top-1/2 h-[118%] min-h-[118dvh] w-[118%] min-w-[118vw] -translate-x-1/2 -translate-y-1/2">
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: [
              'radial-gradient(ellipse 88% 78% at 50% 48%, transparent 0%, transparent 38%, color-mix(in srgb, var(--bg) 18%, transparent) 62%, color-mix(in srgb, var(--bg) 55%, transparent) 82%, var(--bg) 100%)',
              'linear-gradient(to bottom, color-mix(in srgb, var(--bg) 35%, transparent) 0%, transparent 12%, transparent 88%, color-mix(in srgb, var(--bg) 40%, transparent) 100%)',
              'linear-gradient(to right, color-mix(in srgb, var(--bg) 28%, transparent) 0%, transparent 10%, transparent 90%, color-mix(in srgb, var(--bg) 28%, transparent) 100%)',
            ].join(', '),
          }}
        />
      </div>
    </div>
  )
}
