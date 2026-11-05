import { useEffect, useRef } from 'react'

// Procedural sci-fi scene: an orbital city under a planet's limb.
// Static layers are rendered once per resize into offscreen canvases; the
// animation loop only composites them and draws the moving lights.

type Star = { x: number; y: number; r: number; phase: number; speed: number; tint: string }
type Light = { x: number; y: number; phase: number; layer: number }
type Ship = { x: number; y: number; vx: number; vy: number; depth: number; hue: string; trail: number }
type Cloud = { sprite: HTMLCanvasElement; x: number; y: number; speed: number; alpha: number; layer: number }

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function offscreen(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}

function createScene(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let w = 0, h = 0, dpr = 1
  let raf = 0
  let mx = 0, my = 0, tx = 0, ty = 0

  let sky: HTMLCanvasElement
  let planet: HTMLCanvasElement
  let cityLayers: HTMLCanvasElement[] = []
  let elevator: HTMLCanvasElement
  let stars: Star[] = []
  let beacons: Light[] = []
  let ships: Ship[] = []
  let clouds: Cloud[] = []
  let limb = { cx: 0, cy: 0, r: 0 }
  let sun = { x: 0, y: 0 }
  let towerX = 0
  const PAR = [6, 14, 26, 44] // parallax px per layer depth

  const limbY = (x: number) => limb.cy - Math.sqrt(Math.max(0, limb.r * limb.r - (x - limb.cx) ** 2))

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    w = window.innerWidth
    h = window.innerHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    const R = rng(7)
    const S = Math.max(w, h)

    // --- sky ---
    sky = offscreen(w * dpr, h * dpr)
    {
      const g = sky.getContext('2d')!
      g.scale(dpr, dpr)
      const grad = g.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, '#01030a')
      grad.addColorStop(0.35, '#040a1c')
      grad.addColorStop(0.6, '#0b1a36')
      grad.addColorStop(1, '#0a1426')
      g.fillStyle = grad
      g.fillRect(0, 0, w, h)
      // nebula wisps
      for (const [x, y, r, c] of [
        [0.18, 0.12, 0.35, 'rgba(110,80,200,0.10)'],
        [0.7, 0.08, 0.3, 'rgba(40,140,200,0.08)'],
        [0.45, 0.2, 0.25, 'rgba(200,90,160,0.05)'],
      ] as const) {
        const ng = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * S)
        ng.addColorStop(0, c)
        ng.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = ng
        g.fillRect(0, 0, w, h)
      }
    }

    // --- planet limb (top edge ~38% down, gently curved) ---
    limb = { r: S * 2.2, cx: w * 0.42, cy: h * 0.38 + S * 2.2 }
    sun = { x: w * 0.8, y: limbY(w * 0.8) - 4 }
    planet = offscreen(w * dpr, h * dpr)
    {
      const g = planet.getContext('2d')!
      g.scale(dpr, dpr)
      g.save()
      g.beginPath()
      g.arc(limb.cx, limb.cy, limb.r, 0, Math.PI * 2)
      g.clip()
      const pg = g.createLinearGradient(0, h * 0.3, 0, h * 0.75)
      pg.addColorStop(0, '#3f86d6')
      pg.addColorStop(0.06, '#1f5ca6')
      pg.addColorStop(0.25, '#0f3366')
      pg.addColorStop(0.6, '#081d3c')
      pg.addColorStop(1, '#050d1c')
      g.fillStyle = pg
      g.fillRect(0, 0, w, h)
      // sunlit side
      const sg = g.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, w * 0.6)
      sg.addColorStop(0, 'rgba(140,200,255,0.55)')
      sg.addColorStop(0.3, 'rgba(70,140,220,0.18)')
      sg.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = sg
      g.fillRect(0, 0, w, h)
      // cloud bands, flattened toward the limb for perspective
      for (let i = 0; i < 520; i++) {
        const x = R() * w
        const depth = R()
        const y = limbY(x) + 4 + depth * depth * h * 0.4
        const rx = 20 + R() * 90 * (0.4 + depth)
        const ry = rx * (0.08 + depth * 0.18)
        g.fillStyle = `rgba(230,240,255,${0.05 + R() * 0.12})`
        g.beginPath()
        g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
        g.fill()
      }
      // night-side city lights on the planet
      for (let i = 0; i < 500; i++) {
        const x = R() * w * 0.6
        const y = limbY(x) + 10 + R() * R() * h * 0.35
        g.fillStyle = `rgba(255,${180 + R() * 50},120,${0.15 + R() * 0.4})`
        g.fillRect(x, y, 1, 1)
      }
      g.restore()
      // atmosphere glow
      for (const [lw, a, c] of [
        [70, 0.04, '80,160,255'],
        [36, 0.08, '90,170,255'],
        [14, 0.16, '110,190,255'],
        [6, 0.25, '150,215,255'],
        [2, 0.7, '200,235,255'],
      ] as const) {
        g.strokeStyle = `rgba(${c},${a})`
        g.lineWidth = lw
        g.beginPath()
        g.arc(limb.cx, limb.cy, limb.r + lw / 3, Math.PI * 1.05, Math.PI * 1.95)
        g.stroke()
      }
    }

    // horizon glow where the city meets the atmosphere
    {
      const g = planet.getContext('2d')!
      const hg = g.createLinearGradient(0, h * 0.5, 0, h * 0.78)
      hg.addColorStop(0, 'rgba(80,150,230,0)')
      hg.addColorStop(0.6, 'rgba(90,160,235,0.22)')
      hg.addColorStop(1, 'rgba(255,170,110,0.18)')
      g.fillStyle = hg
      g.fillRect(0, h * 0.5, w, h * 0.3)
    }

    // --- stars (above the limb only) ---
    stars = []
    const count = Math.round((w * h) / 2600)
    for (let i = 0; i < count; i++) {
      const x = R() * w
      const y = R() * h * 0.6
      if (y > limbY(x) - 2) continue
      const big = R() > 0.96
      stars.push({
        x,
        y,
        r: big ? 1 + R() * 0.9 : 0.3 + R() * 0.7,
        phase: R() * Math.PI * 2,
        speed: 0.5 + R() * 2,
        tint: R() > 0.85 ? '190,210,255' : R() > 0.9 ? '255,220,190' : '255,255,255',
      })
    }

    // --- city layers ---
    beacons = []
    towerX = w * 0.63
    const layerDefs = [
      { base: 0.7, maxH: 0.2, minW: 10, maxW: 34, fill: '#253a5e', edge: 'rgba(160,210,255,0.22)', win: 0.22, winSize: 1, haze: 'rgba(110,160,220,0.4)' },
      { base: 0.8, maxH: 0.3, minW: 16, maxW: 52, fill: '#13223d', edge: 'rgba(140,200,255,0.25)', win: 0.3, winSize: 1.5, haze: 'rgba(255,160,100,0.16)' },
      { base: 0.93, maxH: 0.42, minW: 26, maxW: 80, fill: '#070f1f', edge: 'rgba(130,210,255,0.3)', win: 0.34, winSize: 2, haze: 'rgba(255,140,80,0.12)' },
    ]
    cityLayers = layerDefs.map((L, li) => {
      const lw = w + PAR[li + 1] * 2 + 40
      const c = offscreen(lw * dpr, h * dpr)
      const g = c.getContext('2d')!
      g.scale(dpr, dpr)
      const baseY = h * L.base
      let x = -20
      while (x < lw) {
        const bw = L.minW + R() * (L.maxW - L.minW)
        // taller buildings cluster around the tower
        const near = 1 - Math.min(1, Math.abs(x - towerX - PAR[li + 1]) / (w * 0.35))
        const bh = h * L.maxH * (0.25 + R() * 0.55 + near * 0.45 * R())
        const top = baseY - bh
        const grad = g.createLinearGradient(x, top, x + bw, top)
        grad.addColorStop(0, L.fill)
        grad.addColorStop(0.7, L.fill)
        grad.addColorStop(1, shade(L.fill, 18))
        g.fillStyle = grad
        const kind = R()
        g.beginPath()
        if (kind < 0.18) {
          // spire
          g.moveTo(x, h)
          g.lineTo(x, top + bw * 0.6)
          g.lineTo(x + bw / 2, top - bh * 0.25)
          g.lineTo(x + bw, top + bw * 0.6)
          g.lineTo(x + bw, h)
        } else if (kind < 0.32) {
          // dome
          g.moveTo(x, h)
          g.lineTo(x, top + bw / 2)
          g.arc(x + bw / 2, top + bw / 2, bw / 2, Math.PI, 0)
          g.lineTo(x + bw, h)
        } else if (kind < 0.55) {
          // stepped
          const s = bw * 0.2
          g.moveTo(x, h)
          g.lineTo(x, top + bh * 0.25)
          g.lineTo(x + s, top + bh * 0.25)
          g.lineTo(x + s, top)
          g.lineTo(x + bw - s, top)
          g.lineTo(x + bw - s, top + bh * 0.15)
          g.lineTo(x + bw, top + bh * 0.15)
          g.lineTo(x + bw, h)
        } else {
          g.rect(x, top, bw, h - top)
        }
        g.fill()
        // rim light from the sun side
        g.strokeStyle = L.edge
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(x + bw - 0.5, top + 2)
        g.lineTo(x + bw - 0.5, h)
        g.stroke()
        // windows
        const sp = L.winSize * 3.2
        for (let wy = top + 6; wy < h - 4; wy += sp * 1.4) {
          for (let wx = x + 3; wx < x + bw - 3; wx += sp) {
            if (R() > L.win) continue
            const warm = R() > 0.45
            g.fillStyle = warm ? `rgba(255,${190 + R() * 40},${120 + R() * 40},${0.45 + R() * 0.5})` : `rgba(150,${220 + R() * 30},255,${0.4 + R() * 0.5})`
            g.fillRect(wx, wy, L.winSize, L.winSize * 0.8)
          }
        }
        // antenna beacons
        if (bh > h * L.maxH * 0.55 && R() > 0.4) {
          const ax = x + bw / 2
          const atop = top - 6 - R() * 18
          g.strokeStyle = shade(L.fill, 30)
          g.beginPath()
          g.moveTo(ax, top)
          g.lineTo(ax, atop)
          g.stroke()
          beacons.push({ x: ax, y: atop, phase: R() * Math.PI * 2, layer: li })
        }
        x += bw + (R() > 0.7 ? R() * 14 : 1)
      }
      // ground haze on the layer's base
      const hz = g.createLinearGradient(0, baseY - h * 0.12, 0, baseY + 10)
      hz.addColorStop(0, 'rgba(0,0,0,0)')
      hz.addColorStop(1, L.haze)
      g.fillStyle = hz
      g.fillRect(0, baseY - h * 0.12, lw, h * 0.12 + 10)
      return c
    })

    // --- space elevator: tapered tower into orbit ---
    elevator = offscreen(w * dpr, h * dpr)
    {
      const g = elevator.getContext('2d')!
      g.scale(dpr, dpr)
      const baseW = Math.max(56, w * 0.07)
      const baseY = h * 0.85
      const tg = g.createLinearGradient(towerX - baseW, 0, towerX + baseW, 0)
      tg.addColorStop(0, '#0e1a32')
      tg.addColorStop(0.5, '#2a4470')
      tg.addColorStop(0.68, '#a9c9f0')
      tg.addColorStop(0.78, '#4a6fa3')
      tg.addColorStop(1, '#0e1a32')
      g.fillStyle = tg
      g.beginPath()
      g.moveTo(towerX - baseW / 2, baseY)
      g.bezierCurveTo(towerX - baseW * 0.18, baseY - h * 0.35, towerX - 3, h * 0.2, towerX - 2, -10)
      g.lineTo(towerX + 2, -10)
      g.bezierCurveTo(towerX + 3, h * 0.2, towerX + baseW * 0.18, baseY - h * 0.35, towerX + baseW / 2, baseY)
      g.fill()
      // glowing core line
      g.save()
      g.shadowColor = 'rgba(150,220,255,0.9)'
      g.shadowBlur = 16
      g.strokeStyle = 'rgba(190,235,255,0.65)'
      g.lineWidth = 1.2
      g.beginPath()
      g.moveTo(towerX + 0.5, baseY - 20)
      g.lineTo(towerX + 0.5, -10)
      g.stroke()
      g.restore()
      // ring platforms
      for (let i = 0; i < 9; i++) {
        const y = baseY - (i + 1) * (baseY / 10) * (0.6 + i * 0.05)
        if (y < 0) break
        const ww = baseW * (0.55 - i * 0.05)
        g.fillStyle = 'rgba(180,225,255,0.5)'
        g.fillRect(towerX - ww / 2, y, ww, 2)
      }
      // orbital ring arc around the planet, crossing the tower
      g.lineCap = 'round'
      for (const [lw, a] of [[10, 0.05], [3, 0.18], [1.2, 0.5]] as const) {
        g.strokeStyle = `rgba(170,215,255,${a})`
        g.lineWidth = lw
        g.beginPath()
        g.ellipse(w * 0.5, h * 0.42, w * 0.78, h * 0.22, -0.06, Math.PI * 1.04, Math.PI * 1.96)
        g.stroke()
      }
    }

    // --- clouds drifting between layers ---
    clouds = []
    const sprites = [0, 1, 2].map((i) => cloudSprite(rng(100 + i), 260 + i * 80))
    for (let i = 0; i < 9; i++) {
      const layer = i % 3
      clouds.push({
        sprite: sprites[i % 3],
        x: R() * (w + 400) - 200,
        y: h * (0.62 + layer * 0.09 + R() * 0.05),
        speed: (4 + R() * 6) * (layer + 1),
        alpha: 0.18 + R() * 0.2,
        layer,
      })
    }

    // --- traffic ---
    ships = Array.from({ length: 14 }, () => newShip(R, true))
  }

  function newShip(R: () => number, anywhere = false): Ship {
    const depth = R()
    const shuttle = R() > 0.82
    const dir = R() > 0.5 ? 1 : -1
    if (shuttle) {
      return { x: w * (0.2 + R() * 0.6), y: h * (0.75 + R() * 0.1), vx: dir * 8, vy: -(18 + R() * 16), depth: 0.6, hue: '255,190,120', trail: 60 }
    }
    return {
      x: anywhere ? R() * w : dir > 0 ? -40 : w + 40,
      y: h * (0.5 + depth * 0.3) + R() * 30,
      vx: dir * (20 + depth * 70 + R() * 30),
      vy: (R() - 0.5) * 3,
      depth,
      hue: R() > 0.5 ? '160,230,255' : '255,240,220',
      trail: 18 + depth * 30,
    }
  }

  function cloudSprite(R: () => number, size: number) {
    const c = offscreen(size * 2, size * 0.7)
    const g = c.getContext('2d')!
    for (let i = 0; i < 40; i++) {
      const x = size * 0.3 + R() * size * 1.4
      const y = size * 0.25 + (R() - 0.5) * size * 0.2
      const r = size * (0.08 + R() * 0.14)
      const cg = g.createRadialGradient(x, y - r * 0.3, 0, x, y, r)
      cg.addColorStop(0, 'rgba(225,238,255,0.55)')
      cg.addColorStop(0.6, 'rgba(160,190,230,0.25)')
      cg.addColorStop(1, 'rgba(120,150,200,0)')
      g.fillStyle = cg
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
    return c
  }

  let last = performance.now()
  const R = rng(99)
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const t = now / 1000
    mx += (tx - mx) * 0.04
    my += (ty - my) * 0.04

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.drawImage(sky, 0, 0, w, h)

    // stars
    for (const s of stars) {
      const a = reduced ? 0.8 : 0.45 + 0.55 * Math.sin(t * s.speed + s.phase) ** 2
      ctx.fillStyle = `rgba(${s.tint},${a})`
      ctx.beginPath()
      ctx.arc(s.x - mx * PAR[0] * 0.5, s.y - my * 3, s.r, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.drawImage(planet, -mx * PAR[0], -my * 4, w, h)

    // sun + flare
    const sx = sun.x - mx * PAR[0], sy = sun.y - my * 4
    const pulse = reduced ? 1 : 1 + Math.sin(t * 0.8) * 0.04
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 160 * pulse)
    glow.addColorStop(0, 'rgba(255,255,255,1)')
    glow.addColorStop(0.05, 'rgba(255,245,225,0.9)')
    glow.addColorStop(0.2, 'rgba(255,210,150,0.25)')
    glow.addColorStop(1, 'rgba(255,200,140,0)')
    ctx.fillStyle = glow
    ctx.fillRect(sx - 200, sy - 200, 400, 400)
    ctx.save()
    ctx.translate(sx, sy)
    ctx.rotate(reduced ? 0 : t * 0.03)
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3)
      const rg = ctx.createLinearGradient(0, 0, 120 * pulse, 0)
      rg.addColorStop(0, 'rgba(255,240,220,0.45)')
      rg.addColorStop(1, 'rgba(255,240,220,0)')
      ctx.fillStyle = rg
      ctx.fillRect(0, -0.8, 120 * pulse, 1.6)
    }
    ctx.restore()
    // horizontal anamorphic streak
    const st = ctx.createLinearGradient(sx - w * 0.3, 0, sx + w * 0.3, 0)
    st.addColorStop(0, 'rgba(150,200,255,0)')
    st.addColorStop(0.5, 'rgba(200,230,255,0.35)')
    st.addColorStop(1, 'rgba(150,200,255,0)')
    ctx.fillStyle = st
    ctx.fillRect(sx - w * 0.3, sy - 0.75, w * 0.6, 1.5)

    // elevator + orbital ring
    const ex = -mx * PAR[1], ey = -my * 6
    ctx.drawImage(elevator, ex, ey, w, h)
    // climbers going up the tower
    if (!reduced) {
      for (let i = 0; i < 4; i++) {
        const p = ((t * 0.035 + i / 4) % 1)
        const y = h * 0.85 * (1 - p)
        const a = Math.min(1, p * 6) * Math.min(1, (1 - p) * 6)
        dot(towerX + ex, y + ey, 2.2, `rgba(255,220,170,${a})`, 10)
      }
      // trains along the orbital ring
      for (let i = 0; i < 3; i++) {
        const ang = Math.PI * (1.04 + 0.92 * ((t * 0.02 + i / 3) % 1))
        const rx = w * 0.78, ry = h * 0.22, rot = -0.06
        const px = rx * Math.cos(ang), py = ry * Math.sin(ang)
        const x = w * 0.5 + px * Math.cos(rot) - py * Math.sin(rot)
        const y = h * 0.42 + px * Math.sin(rot) + py * Math.cos(rot)
        dot(x + ex, y + ey, 1.8, 'rgba(180,240,255,0.95)', 12)
      }
    }

    // city layers with clouds and traffic between them
    for (let li = 0; li < 3; li++) {
      const off = PAR[li + 1]
      ctx.drawImage(cityLayers[li], -off - 20 - mx * off, -my * off * 0.25, cityLayers[li].width / dpr, h)
      for (const c of clouds) {
        if (c.layer !== li) continue
        if (!reduced) {
          c.x += c.speed * dt
          if (c.x > w + 100) c.x = -c.sprite.width - 100
        }
        ctx.globalAlpha = c.alpha
        ctx.drawImage(c.sprite, c.x - mx * off, c.y - c.sprite.height / 2)
        ctx.globalAlpha = 1
      }
      for (const b of beacons) {
        if (b.layer !== li) continue
        const on = reduced ? 0.8 : Math.max(0, Math.sin(t * 2 + b.phase)) ** 6
        if (on > 0.02) dot(b.x - off - 20 - mx * off, b.y - my * off * 0.25, 1.6, `rgba(255,70,70,${on})`, 8)
      }
      if (li === 1 && !reduced) drawShips(dt)
    }

    // vignette + bottom fade so UI text stays readable
    const vg = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.3, w / 2, h * 0.45, Math.max(w, h) * 0.85)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(0,0,0,0.55)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, w, h)

    if (!reduced) raf = requestAnimationFrame(frame)
  }

  function drawShips(dt: number) {
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i]
      s.x += s.vx * dt
      s.y += s.vy * dt
      const len = Math.hypot(s.vx, s.vy)
      const ux = s.vx / len, uy = s.vy / len
      const px = s.x - mx * PAR[2] * s.depth
      const tg = ctx.createLinearGradient(px, s.y, px - ux * s.trail, s.y - uy * s.trail)
      tg.addColorStop(0, `rgba(${s.hue},0.9)`)
      tg.addColorStop(1, `rgba(${s.hue},0)`)
      ctx.strokeStyle = tg
      ctx.lineWidth = 0.6 + s.depth
      ctx.beginPath()
      ctx.moveTo(px, s.y)
      ctx.lineTo(px - ux * s.trail, s.y - uy * s.trail)
      ctx.stroke()
      dot(px, s.y, 0.8 + s.depth, `rgba(${s.hue},1)`, 6)
      if (s.x < -80 || s.x > w + 80 || s.y < -80) ships[i] = newShip(R)
    }
  }

  function dot(x: number, y: number, r: number, color: string, blur: number) {
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = blur
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  function start() {
    cancelAnimationFrame(raf)
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }

  const onResize = () => {
    build()
    start()
  }
  const onMove = (e: PointerEvent) => {
    tx = (e.clientX / w) * 2 - 1
    ty = (e.clientY / h) * 2 - 1
  }
  const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start())

  build()
  start()
  window.addEventListener('resize', onResize)
  window.addEventListener('pointermove', onMove)
  document.addEventListener('visibilitychange', onVis)
  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('pointermove', onMove)
    document.removeEventListener('visibilitychange', onVis)
  }
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16)
  const c = (s: number) => Math.min(255, ((n >> s) & 255) + amt)
  return `rgb(${c(16)},${c(8)},${c(0)})`
}

export function CityBackground() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => (ref.current ? createScene(ref.current) : undefined), [])
  return <canvas ref={ref} className="city-bg" aria-hidden="true" />
}
