import type { Map as MLMap } from 'maplibre-gl'

/**
 * Aircraft icons are drawn once onto a canvas and registered with MapLibre
 * as images, so the WebGL symbol layer can stamp them for every aircraft.
 * Shapes point north (up); the layer rotates them by track.
 */

const PX = 2 // draw at 2x for sharp icons on retina screens
const SIZE = 32 // logical px

type Shape = 'jet' | 'heli'

function jetPath(ctx: CanvasRenderingContext2D) {
  // Half-outline from nose to tail on the right side, then mirrored.
  const half: [number, number][] = [
    [16, 1.5], [17.2, 3.2], [17.6, 6], [17.6, 11.5], [30, 18.2], [30, 20.6], [17.6, 17.4],
    [17.1, 24.5], [21.8, 28.4], [21.8, 30.2], [16.6, 28.9], [16, 30.5],
  ]
  ctx.beginPath()
  ctx.moveTo(half[0][0], half[0][1])
  for (const [x, y] of half) ctx.lineTo(x, y)
  for (let i = half.length - 2; i >= 1; i--) ctx.lineTo(32 - half[i][0], half[i][1])
  ctx.closePath()
}

function heliPath(ctx: CanvasRenderingContext2D) {
  ctx.beginPath()
  ctx.ellipse(16, 13, 4.2, 6.5, 0, 0, Math.PI * 2) // cabin
  ctx.rect(15.2, 18, 1.6, 11) // tail boom
  ctx.rect(12.5, 27, 7, 1.6) // tail rotor
  ctx.moveTo(4, 5.5)
  ctx.lineTo(5.2, 4.3)
  ctx.lineTo(28, 20.5)
  ctx.lineTo(26.8, 21.7)
  ctx.closePath() // rotor blade 1
  ctx.moveTo(28, 5.5)
  ctx.lineTo(26.8, 4.3)
  ctx.lineTo(4, 20.5)
  ctx.lineTo(5.2, 21.7)
  ctx.closePath() // rotor blade 2
}

function draw(shape: Shape, fill: string, stroke: string, strokeWidth: number, glow?: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE * PX
  const ctx = canvas.getContext('2d')!
  ctx.scale(PX, PX)
  ctx.lineJoin = 'round'
  if (shape === 'jet') jetPath(ctx)
  else heliPath(ctx)
  if (glow) {
    ctx.shadowColor = glow
    ctx.shadowBlur = 6
  }
  ctx.fillStyle = fill
  ctx.fill('nonzero')
  ctx.shadowBlur = 0
  ctx.strokeStyle = stroke
  ctx.lineWidth = strokeWidth
  ctx.stroke()
  return ctx.getImageData(0, 0, SIZE * PX, SIZE * PX)
}

export const ICON = {
  air: 'ac-air',
  ground: 'ac-ground',
  heliAir: 'ac-heli',
  heliGround: 'ac-heli-ground',
  selected: 'ac-selected',
  heliSelected: 'ac-heli-selected',
} as const

export function addAircraftIcons(map: MLMap) {
  const outline = 'rgba(10, 6, 14, 0.85)'
  const add = (name: string, img: ImageData) => {
    if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: PX })
  }
  add(ICON.air, draw('jet', '#f7b2c6', outline, 1.1))
  add(ICON.ground, draw('jet', '#8d8494', outline, 1.1))
  add(ICON.heliAir, draw('heli', '#f7b2c6', outline, 0.9))
  add(ICON.heliGround, draw('heli', '#8d8494', outline, 0.9))
  add(ICON.selected, draw('jet', '#ffffff', '#c8456b', 1.6, 'rgba(200, 69, 107, 0.9)'))
  add(ICON.heliSelected, draw('heli', '#ffffff', '#c8456b', 1.3, 'rgba(200, 69, 107, 0.9)'))
}
