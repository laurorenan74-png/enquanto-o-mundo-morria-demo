import Phaser from "phaser";
import type { RoomId, RoomSpec } from "../types";

export const ROOM_ART_TEXTURE_PREFIX = "proc_room_";
const CONDITIONAL_PROP_PREFIX = "prop_";

interface ConditionalPropDef {
  width: number;
  height: number;
  roomId: RoomId;
  painter: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

// 4x4 ordered Bayer dithering matrix (values 0..15) for authentic pixel-art gradients
const BAYER_4X4: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// ---------- Deterministic Pixel-Art Drawing Primitives ----------

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
}

function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
}

function hline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  color: string
): void {
  if (len <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(len), 1);
}

function vline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  color: string
): void {
  if (len <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), 1, Math.floor(len));
}

function outlineRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  if (w <= 0 || h <= 0) return;
  hline(ctx, x, y, w, color);
  hline(ctx, x, y + h - 1, w, color);
  vline(ctx, x, y, h, color);
  vline(ctx, x + w - 1, y, h, color);
}

function pixelLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string
): void {
  let ix0 = Math.floor(x0);
  let iy0 = Math.floor(y0);
  const ix1 = Math.floor(x1);
  const iy1 = Math.floor(y1);
  const dx = Math.abs(ix1 - ix0);
  const dy = Math.abs(iy1 - iy0);
  const sx = ix0 < ix1 ? 1 : -1;
  const sy = iy0 < iy1 ? 1 : -1;
  let err = dx - dy;

  ctx.fillStyle = color;
  while (true) {
    ctx.fillRect(ix0, iy0, 1, 1);
    if (ix0 === ix1 && iy0 === iy1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      ix0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      iy0 += sy;
    }
  }
}

function pixelEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string
): void {
  const icx = Math.floor(cx);
  const icy = Math.floor(cy);
  const irx = Math.max(1, Math.floor(rx));
  const iry = Math.max(1, Math.floor(ry));
  ctx.fillStyle = color;

  for (let dy = -iry; dy <= iry; dy++) {
    const ny = dy / iry;
    const span = Math.floor(irx * Math.sqrt(Math.max(0, 1 - ny * ny)));
    if (span >= 0) {
      ctx.fillRect(icx - span, icy + dy, span * 2 + 1, 1);
    }
  }
}

function fillPixelPolygon(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<[number, number]>,
  color: string
): void {
  if (points.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, py] of points) {
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const yStart = Math.floor(minY);
  const yEnd = Math.ceil(maxY);
  ctx.fillStyle = color;

  for (let y = yStart; y <= yEnd; y++) {
    const sampleY = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= sampleY && y2 > sampleY) || (y2 <= sampleY && y1 > sampleY)) {
        const t = (sampleY - y1) / (y2 - y1);
        xs.push(x1 + t * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xStart = Math.floor(xs[i]);
      const xEnd = Math.ceil(xs[i + 1]);
      if (xEnd > xStart) {
        ctx.fillRect(xStart, y, xEnd - xStart, 1);
      }
    }
  }
}

function ditherRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  density: number
): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + Math.floor(w);
  const y1 = y0 + Math.floor(h);
  const threshold = Math.max(0, Math.min(16, Math.round(density * 16)));
  if (threshold <= 0) return;

  ctx.fillStyle = color;
  for (let py = y0; py < y1; py++) {
    const row = BAYER_4X4[((py % 4) + 4) % 4];
    for (let pxPos = x0; pxPos < x1; pxPos++) {
      if (row[((pxPos % 4) + 4) % 4] < threshold) {
        ctx.fillRect(pxPos, py, 1, 1);
      }
    }
  }
}

function ditherVerticalGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: ReadonlyArray<string>
): void {
  if (stops.length === 0 || w <= 0 || h <= 0) return;
  if (stops.length === 1) {
    rect(ctx, x, y, w, h, stops[0]);
    return;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const iw = Math.floor(w);
  const ih = Math.floor(h);
  const segCount = stops.length - 1;

  for (let row = 0; row < ih; row++) {
    const py = y0 + row;
    const t = ih <= 1 ? 0 : row / (ih - 1);
    const scaled = t * segCount;
    const segIdx = Math.min(segCount - 1, Math.floor(scaled));
    const localT = scaled - segIdx;
    const cA = stops[segIdx];
    const cB = stops[segIdx + 1];
    const bayerRow = BAYER_4X4[((py % 4) + 4) % 4];
    const thresh = localT * 16;

    // Fast path: pure color band
    if (thresh <= 0.01) {
      ctx.fillStyle = cA;
      ctx.fillRect(x0, py, iw, 1);
      continue;
    }
    if (thresh >= 15.99) {
      ctx.fillStyle = cB;
      ctx.fillRect(x0, py, iw, 1);
      continue;
    }

    ctx.fillStyle = cA;
    ctx.fillRect(x0, py, iw, 1);
    ctx.fillStyle = cB;
    for (let col = 0; col < iw; col++) {
      const pxPos = x0 + col;
      if (bayerRow[((pxPos % 4) + 4) % 4] < thresh) {
        ctx.fillRect(pxPos, py, 1, 1);
      }
    }
  }
}

function drawWoodPlanksHorizontal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  plankH: number,
  colors: { seam: string; dark: string; mid: string; light: string; nail: string },
  seed: number
): void {
  const rng = createRng(seed);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const yEnd = y0 + Math.floor(h);
  let rowIdx = 0;

  for (let py = y0; py < yEnd; py += plankH) {
    const bh = Math.min(plankH, yEnd - py);
    const baseColor = rowIdx % 2 === 0 ? colors.mid : colors.dark;
    rect(ctx, x0, py, w, bh, baseColor);
    // Top highlight bevel
    if (bh >= 3) {
      hline(ctx, x0, py + 1, w, rowIdx % 2 === 0 ? colors.light : colors.mid);
    }
    // Bottom seam
    hline(ctx, x0, py, w, colors.seam);

    // Subtle wood grain streaks
    const grainCount = Math.max(2, Math.floor(w / 26));
    for (let g = 0; g < grainCount; g++) {
      const gx = x0 + Math.floor(rng() * Math.max(1, w - 12));
      const gy = py + 1 + Math.floor(rng() * Math.max(1, bh - 2));
      const glen = 6 + Math.floor(rng() * 14);
      hline(
        ctx,
        gx,
        gy,
        Math.min(glen, x0 + w - gx),
        rng() > 0.5 ? colors.dark : colors.light
      );
    }

    // Vertical plank joints & nail dots
    const jointStep = 44 + (rowIdx % 3) * 14;
    const offset = (rowIdx * 23) % jointStep;
    for (let jx = x0 + offset; jx < x0 + w - 4; jx += jointStep) {
      if (jx <= x0 + 2) continue;
      vline(ctx, jx, py, bh, colors.seam);
      if (bh >= 4) {
        px(ctx, jx - 2, py + 2, colors.nail);
        px(ctx, jx + 2, py + 2, colors.nail);
        if (bh >= 6) {
          px(ctx, jx - 2, py + bh - 2, colors.nail);
          px(ctx, jx + 2, py + bh - 2, colors.nail);
        }
      }
    }
    rowIdx++;
  }
}

function drawWoodPlanksVertical(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  plankW: number,
  colors: { seam: string; dark: string; mid: string; light: string },
  seed: number
): void {
  const rng = createRng(seed);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xEnd = x0 + Math.floor(w);
  let colIdx = 0;

  for (let pxPos = x0; pxPos < xEnd; pxPos += plankW) {
    const bw = Math.min(plankW, xEnd - pxPos);
    rect(ctx, pxPos, y0, bw, h, colIdx % 2 === 0 ? colors.mid : colors.dark);
    if (bw >= 3) {
      vline(ctx, pxPos + 1, y0, h, colIdx % 2 === 0 ? colors.light : colors.mid);
    }
    vline(ctx, pxPos, y0, h, colors.seam);

    // Occasional subtle vertical grain / knot
    const grainY = y0 + Math.floor(rng() * Math.max(1, h - 10));
    vline(ctx, pxPos + Math.min(bw - 1, 2), grainY, 5 + Math.floor(rng() * 8), colors.dark);
    colIdx++;
  }
}

function drawPixelCloud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  cLight: string,
  cMid: string,
  cShadow: string
): void {
  const puffs = [
    { dx: -w * 0.28, dy: 2, rx: w * 0.24, ry: h * 0.42 },
    { dx: 0, dy: -1, rx: w * 0.34, ry: h * 0.56 },
    { dx: w * 0.28, dy: 1, rx: w * 0.25, ry: h * 0.44 },
    { dx: -w * 0.12, dy: 2, rx: w * 0.28, ry: h * 0.4 },
    { dx: w * 0.14, dy: 2, rx: w * 0.26, ry: h * 0.38 },
  ];
  for (const p of puffs) {
    pixelEllipse(ctx, cx + p.dx, cy + p.dy + 1, p.rx, p.ry, cShadow);
  }
  for (const p of puffs) {
    pixelEllipse(ctx, cx + p.dx, cy + p.dy, p.rx, p.ry, cMid);
  }
  for (const p of puffs) {
    pixelEllipse(ctx, cx + p.dx, cy + p.dy - 1, Math.max(1, p.rx - 2), Math.max(1, p.ry - 1), cLight);
  }
}

function drawPineTree(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  height: number,
  maxHalfW: number,
  colors: { trunk: string; dark: string; mid: string; light: string }
): void {
  // Trunk
  const trunkH = Math.max(5, Math.floor(height * 0.18));
  rect(ctx, cx - 2, baseY - trunkH, 4, trunkH, colors.trunk);

  // Layered conifer tiers from bottom to top
  const tiers = Math.max(4, Math.floor(height / 8));
  const foliageH = height - trunkH + 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const tierY = baseY - trunkH - Math.floor(t * foliageH);
    const tierH = Math.max(6, Math.floor(foliageH / tiers) + 5);
    const halfW = Math.max(2, Math.floor(maxHalfW * (1 - t * 0.82)));

    // Dark base silhouette
    fillPixelPolygon(
      ctx,
      [
        [cx, tierY - tierH],
        [cx + halfW, tierY],
        [cx - halfW, tierY],
      ],
      colors.dark
    );
    // Mid canopy slightly shifted up-left
    fillPixelPolygon(
      ctx,
      [
        [cx, tierY - tierH],
        [cx + Math.max(1, halfW - 2), tierY - 2],
        [cx - Math.max(1, halfW - 1), tierY - 1],
      ],
      colors.mid
    );
    // Crisp highlight fronds on top-left slope
    if (halfW >= 4) {
      pixelLine(ctx, cx, tierY - tierH + 1, cx - halfW + 2, tierY - 2, colors.light);
      pixelLine(ctx, cx - 1, tierY - tierH + 2, cx - Math.floor(halfW * 0.45), tierY - 2, colors.light);
    }
  }
}

function drawGroundTexture(
  ctx: CanvasRenderingContext2D,
  yTop: number,
  w: number,
  h: number,
  colors: { base: string; dark: string; light: string; pebble: string; accent: string },
  seed: number
): void {
  const rng = createRng(seed);
  rect(ctx, 0, yTop, w, h - yTop, colors.base);

  // Organic horizontal tonal strata
  for (let band = 0; band < 18; band++) {
    const bx = Math.floor(rng() * w);
    const by = yTop + Math.floor(rng() * (h - yTop));
    const bw = 12 + Math.floor(rng() * 36);
    const bh = 2 + Math.floor(rng() * 5);
    ditherRect(ctx, bx, by, bw, bh, rng() > 0.5 ? colors.dark : colors.light, 0.35);
  }

  // Subtle pebbles & soil flecks
  const dotCount = Math.floor((w * (h - yTop)) / 42);
  for (let i = 0; i < dotCount; i++) {
    const dx = Math.floor(rng() * w);
    const dy = yTop + 1 + Math.floor(rng() * Math.max(1, h - yTop - 2));
    const pick = rng();
    if (pick < 0.42) {
      px(ctx, dx, dy, colors.dark);
    } else if (pick < 0.78) {
      px(ctx, dx, dy, colors.light);
    } else if (pick < 0.93) {
      rect(ctx, dx, dy, 2, 1, colors.pebble);
    } else {
      px(ctx, dx, dy, colors.accent);
    }
  }
}

function bindTweenLifecycle(
  target: Phaser.GameObjects.GameObject,
  tween: Phaser.Tweens.Tween
): void {
  target.once("destroy", () => {
    if (tween && tween.isPlaying()) {
      tween.stop();
    }
    tween.remove();
  });
}

// ---------- Room 1: R01_BARRACA (320x180) ----------

function paintRoomR01Barraca(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rng = createRng(101);

  // Outer tent darkness
  rect(ctx, 0, 0, w, h, "#181614");

  // Back sloped canvas wall (warm weathered khaki-beige)
  ditherVerticalGradient(ctx, 0, 0, w, 134, ["#2B2620", "#4A4338", "#6B6354", "#827866"]);

  // Pitched A-frame canvas roof shadows at left and right slopes
  fillPixelPolygon(
    ctx,
    [
      [0, 0],
      [156, 18],
      [26, 62],
      [0, 56],
    ],
    "#474036"
  );
  fillPixelPolygon(
    ctx,
    [
      [320, 0],
      [158, 18],
      [278, 54],
      [320, 48],
    ],
    "#3E3830"
  );

  // Canvas fabric fold lines & vertical stitched seams
  for (let sx = 34; sx <= 250; sx += 36) {
    pixelLine(ctx, sx, 22, sx - 6, 132, "#544C40");
    pixelLine(ctx, sx + 1, 22, sx - 5, 132, "#7C7261");
    // Tiny stitch marks along seam
    for (let sy = 30; sy < 126; sy += 7) {
      px(ctx, sx - Math.floor(((sy - 22) / 110) * 6), sy, "#332E27");
    }
  }

  // Horizontal sewn reinforcement band
  rect(ctx, 22, 62, 252, 4, "#4C453A");
  hline(ctx, 22, 62, 252, "#353028");
  hline(ctx, 22, 65, 252, "#7B7261");

  // Subtle fabric wear & dithered shadows in corners
  ditherRect(ctx, 0, 0, 46, 132, "#1C1B1A", 0.5);
  ditherRect(ctx, 0, 0, 22, 132, "#141210", 0.7);
  ditherRect(ctx, 18, 108, 256, 24, "#383530", 0.35);

  // Heavy wooden ridge pole along ceiling
  rect(ctx, 0, 16, w, 7, "#4A3728");
  hline(ctx, 0, 16, w, "#291E15");
  hline(ctx, 0, 17, w, "#73573E");
  hline(ctx, 0, 22, w, "#291E15");
  // Ridge pole central vertical wooden support stake
  rect(ctx, 152, 18, 9, 114, "#4A3728");
  vline(ctx, 152, 18, 114, "#261B13");
  vline(ctx, 154, 18, 114, "#75583F");
  vline(ctx, 155, 18, 114, "#8A6A4E");
  vline(ctx, 160, 18, 114, "#261B13");
  // Hemp lashing where post meets ridge pole
  for (let ly = 16; ly <= 25; ly += 2) {
    hline(ctx, 151, ly, 11, "#9E835C");
    hline(ctx, 151, ly + 1, 11, "#665238");
  }

  // Left wooden corner stake & taut rope
  rect(ctx, 26, 56, 6, 78, "#4A3728");
  vline(ctx, 28, 56, 78, "#75583F");
  vline(ctx, 26, 56, 78, "#261B13");
  pixelLine(ctx, 26, 64, 6, 98, "#9E835C");

  // Small fabric tears in upper canvas roof letting harsh daylight through
  fillPixelPolygon(
    ctx,
    [
      [134, 24],
      [143, 21],
      [146, 25],
      [139, 28],
    ],
    "#EAE3CE"
  );
  outlineRect(ctx, 136, 23, 8, 3, "#F7F3E6");
  fillPixelPolygon(
    ctx,
    [
      [168, 28],
      [175, 26],
      [177, 30],
      [170, 31],
    ],
    "#EAE3CE"
  );

  // Warm-earthy textured dirt floor (y: 126..180)
  drawGroundTexture(
    ctx,
    126,
    w,
    h,
    {
      base: "#544739",
      dark: "#3B3127",
      light: "#6E5E4B",
      pebble: "#8A7A65",
      accent: "#9E8C72",
    },
    102
  );
  // Crisp dirt wall-floor shadow skirt
  ditherRect(ctx, 0, 126, w, 7, "#241E19", 0.55);
  // Walkable path slightly lighter worn packed soil in center
  fillPixelPolygon(
    ctx,
    [
      [52, 132],
      [268, 132],
      [292, 164],
      [28, 164],
    ],
    "#5E5040"
  );
  // Re-texture over walkable floor so it feels natural and organic
  for (let i = 0; i < 180; i++) {
    const fx = 36 + Math.floor(rng() * 244);
    const fy = 133 + Math.floor(rng() * 31);
    px(ctx, fx, fy, rng() > 0.45 ? "#6E5E4B" : "#4A3E32");
  }
  // Soft floor edge darkening near foreground bottom
  ditherRect(ctx, 0, 166, w, 14, "#1C1814", 0.45);

  // Cozy non-interactive dressing: rolled canvas bedroll & small wooden crate far-left (x: 12..54)
  rect(ctx, 14, 114, 24, 18, "#473527");
  outlineRect(ctx, 14, 114, 24, 18, "#261B13");
  hline(ctx, 15, 119, 22, "#302319");
  hline(ctx, 15, 125, 22, "#302319");
  hline(ctx, 15, 115, 22, "#6E543E");
  // Rolled blanket atop crate
  pixelEllipse(ctx, 28, 111, 10, 4, "#6B4D3B");
  pixelEllipse(ctx, 28, 110, 8, 3, "#8A654E");
  vline(ctx, 23, 108, 7, "#3B291E");
  vline(ctx, 32, 108, 7, "#3B291E");

  // Soft diagonal sunbeams from roof tears onto floor (baked dithered glow)
  for (let step = 0; step < 118; step++) {
    const sy = 26 + step;
    const xStart = Math.floor(134 + step * 0.28);
    const beamW = Math.floor(12 + step * 0.24);
    if (sy < 156) {
      ditherRect(ctx, xStart, sy, beamW, 1, "#D6CFB8", 0.14);
    }
  }
  // Sunlit bright oval on the dirt floor
  pixelEllipse(ctx, 178, 144, 24, 8, "#7D6D58");
  ditherRect(ctx, 156, 138, 44, 12, "#B8B09C", 0.22);

  // --- HOTSPOT 1: HS_VIDRO_QUEBRADO [64, 108, 28, 22] ---
  // Shadow underneath shard & flat stone
  pixelEllipse(ctx, 78, 127, 12, 3, "#2B241D");
  // Small dark wooden frame remnant behind broken mirror
  fillPixelPolygon(
    ctx,
    [
      [67, 124],
      [75, 111],
      [88, 116],
      [86, 126],
    ],
    "#3B2B1F"
  );
  // Jagged gleaming broken mirror shard
  fillPixelPolygon(
    ctx,
    [
      [69, 123],
      [76, 112],
      [87, 117],
      [84, 125],
    ],
    "#8FA8B2"
  );
  // Bright reflective upper-left bevel
  fillPixelPolygon(
    ctx,
    [
      [71, 121],
      [76, 113],
      [83, 116],
      [78, 121],
    ],
    "#CBE0E6"
  );
  // Specular white slash & crack lines
  pixelLine(ctx, 74, 115, 81, 118, "#F7FCFF");
  pixelLine(ctx, 72, 119, 77, 116, "#FFFFFF");
  pixelLine(ctx, 76, 113, 79, 124, "#2F3D42");
  pixelLine(ctx, 79, 119, 85, 119, "#2F3D42");
  // Two tiny scattered glass splinters beside it inside bounds
  rect(ctx, 66, 125, 2, 2, "#CBE0E6");
  px(ctx, 67, 125, "#FFFFFF");
  rect(ctx, 89, 124, 2, 1, "#D6ECEF");

  // --- HOTSPOT 2: HS_MOCHILA_VELHA [196, 118, 34, 24] (conditional prop!) ---
  // Paint subtle ground imprint & dry grass wisps so floor looks natural after pickup
  pixelEllipse(ctx, 213, 137, 13, 4, "#4A3E32");
  ditherRect(ctx, 202, 134, 22, 6, "#3D3329", 0.35);
  px(ctx, 200, 138, "#8A7B5E");
  px(ctx, 224, 136, "#8A7B5E");

  // --- HOTSPOT 3: HS_AMARRAS_BARRACA [238, 68, 36, 58] ---
  // Vertical timber flap pole inside bounds
  rect(ctx, 244, 66, 7, 62, "#4F3B2B");
  vline(ctx, 244, 66, 62, "#261B13");
  vline(ctx, 246, 66, 62, "#7A5D44");
  vline(ctx, 250, 66, 62, "#261B13");
  // Folded canvas flap edge with brass grommets
  rect(ctx, 260, 66, 14, 60, "#756C5B");
  vline(ctx, 260, 66, 60, "#423C32");
  vline(ctx, 262, 66, 60, "#9E937E");
  // Three heavy hemp rope knots tying flap grommets to pole
  for (const ry of [78, 96, 114]) {
    // Metal eyelet
    rect(ctx, 263, ry - 1, 3, 3, "#38322B");
    px(ctx, 264, ry, "#B8A67A");
    // Crisscross taut ropes from pole to eyelet
    pixelLine(ctx, 244, ry - 2, 263, ry, "#B89B6E");
    pixelLine(ctx, 244, ry - 1, 263, ry + 1, "#786140");
    pixelLine(ctx, 244, ry + 2, 263, ry, "#C7AE83");
    // Coiled rope wrap around pole
    rect(ctx, 243, ry - 2, 9, 4, "#9E835C");
    hline(ctx, 243, ry - 1, 9, "#C7AE83");
    hline(ctx, 243, ry + 1, 9, "#614D31");
    // Short dangling knot tail
    pixelLine(ctx, 251, ry + 1, 255, ry + 6, "#8F744E");
  }

  // --- HOTSPOT 4: HS_SAIDA_LESTE [274, 52, 42, 92] ---
  // Open tent flap cutout revealing moody pale wasteland horizon
  const flapPoly: Array<[number, number]> = [
    [276, 54],
    [318, 52],
    [318, 142],
    [275, 134],
  ];
  // Pale overcast wasteland sky inside opening
  fillPixelPolygon(ctx, flapPoly, "#9EA39C");
  ditherVerticalGradient(ctx, 277, 54, 40, 48, ["#7D8580", "#9EA39C", "#C7CBC2"]);
  // Distant hazy ridge & dead scrub silhouette outside
  fillPixelPolygon(
    ctx,
    [
      [276, 102],
      [292, 95],
      [308, 98],
      [318, 92],
      [318, 114],
      [276, 114],
    ],
    "#6B7068"
  );
  // Dusty path outside leading east
  fillPixelPolygon(
    ctx,
    [
      [276, 112],
      [318, 110],
      [318, 142],
      [275, 134],
    ],
    "#7D7462"
  );
  ditherRect(ctx, 278, 118, 36, 18, "#9E947E", 0.3);
  // Drawn-back draped canvas flap framing top and left of opening
  fillPixelPolygon(
    ctx,
    [
      [272, 50],
      [320, 48],
      [320, 58],
      [276, 62],
    ],
    "#595144"
  );
  pixelLine(ctx, 274, 54, 274, 136, "#2E2922");
  pixelLine(ctx, 275, 54, 275, 135, "#B8B09C");
  // Subtle warm outdoor glow spilling onto tent threshold dirt
  ditherRect(ctx, 264, 130, 32, 16, "#B8B09C", 0.25);
}

// ---------- Room 2: R02_FLORES (320x180) ----------

function paintRoomR02Flores(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rng = createRng(202);

  // Folk-horror overcast dithered sky (y: 0..78)
  ditherVerticalGradient(ctx, 0, 0, w, 80, [
    "#4B524E",
    "#666C66",
    "#858A83",
    "#A6ABA3",
    "#C4C7BE",
  ]);

  // Somber overcast pixel clouds
  drawPixelCloud(ctx, 56, 26, 72, 18, "#C7CBC2", "#9EA39B", "#7A8079");
  drawPixelCloud(ctx, 168, 20, 88, 20, "#CFD3CA", "#A4A8A0", "#828780");
  drawPixelCloud(ctx, 272, 28, 66, 16, "#BFC3BA", "#949991", "#717670");

  // Distant misty valley hills (layered depth)
  fillPixelPolygon(
    ctx,
    [
      [0, 74],
      [48, 64],
      [110, 72],
      [176, 60],
      [246, 70],
      [320, 62],
      [320, 94],
      [0, 94],
    ],
    "#737872"
  );
  fillPixelPolygon(
    ctx,
    [
      [0, 82],
      [68, 76],
      [134, 84],
      [208, 75],
      [272, 82],
      [320, 78],
      [320, 108],
      [0, 108],
    ],
    "#555B55"
  );

  // Distant sparse dead pines on left horizon
  drawPineTree(ctx, 22, 92, 28, 8, {
    trunk: "#2B2D2A",
    dark: "#353B36",
    mid: "#464D47",
    light: "#5C635D",
  });
  drawPineTree(ctx, 44, 96, 22, 7, {
    trunk: "#2B2D2A",
    dark: "#3B423C",
    mid: "#4D544E",
    light: "#636B64",
  });

  // Midground chalky clearing slope (y: 92..126)
  ditherVerticalGradient(ctx, 0, 92, w, 36, ["#5C615B", "#71756E", "#8A8E86"]);
  // Chalky limestone streaks on slope
  for (let i = 0; i < 24; i++) {
    const cx = Math.floor(rng() * 240);
    const cy = 96 + Math.floor(rng() * 28);
    rect(ctx, cx, cy, 4 + Math.floor(rng() * 12), 1, "#A8ACA4");
  }

  // Walkable muddy/chalky clearing ground (y: 124..180)
  drawGroundTexture(
    ctx,
    124,
    w,
    h,
    {
      base: "#6B6E68",
      dark: "#494D48",
      light: "#8A8E86",
      pebble: "#B3B6AD",
      accent: "#3D423E",
    },
    203
  );
  // Subtle damp muddy puddles reflecting overcast sky
  pixelEllipse(ctx, 56, 148, 16, 4, "#4A504D");
  pixelEllipse(ctx, 55, 147, 12, 2, "#8D9694");
  pixelEllipse(ctx, 134, 158, 14, 3, "#4A504D");
  pixelEllipse(ctx, 134, 157, 9, 1, "#8D9694");
  // Chalky trail dust from west entrance
  ditherRect(ctx, 8, 136, 92, 16, "#9EA198", 0.25);

  // --- HOTSPOT 1: HS_BARRIS_CORROIDOS [78, 92, 48, 36] ---
  // Muddy stain & dark shadow underneath barrels
  pixelEllipse(ctx, 102, 125, 22, 5, "#333734");
  pixelEllipse(ctx, 106, 126, 14, 3, "#4A3124");

  // Left upright corroded steel drum (x: 82..100, y: 94..124)
  rect(ctx, 82, 96, 18, 27, "#4F5652");
  vline(ctx, 82, 96, 27, "#272B29");
  vline(ctx, 99, 96, 27, "#272B29");
  // Barrel top oval rim
  pixelEllipse(ctx, 91, 96, 9, 3, "#3D423F");
  pixelEllipse(ctx, 91, 96, 7, 2, "#242826");
  // Horizontal stamped barrel ribs
  for (const ry of [104, 114]) {
    hline(ctx, 82, ry, 18, "#7D8580");
    hline(ctx, 82, ry + 1, 18, "#2F3431");
  }
  // Mottled orange-brown corrosion patches eating through steel
  rect(ctx, 84, 99, 7, 6, "#7A452C");
  rect(ctx, 86, 101, 4, 3, "#A86640");
  rect(ctx, 92, 107, 6, 8, "#6E3B25");
  rect(ctx, 93, 109, 4, 4, "#9E5C38");
  rect(ctx, 84, 117, 9, 5, "#5C311E");
  px(ctx, 88, 119, "#B87852");
  // Dark rusted hole
  rect(ctx, 94, 110, 2, 2, "#1F1713");

  // Right half-buried tilted barrel (x: 100..124, y: 106..125)
  fillPixelPolygon(
    ctx,
    [
      [101, 112],
      [121, 107],
      [124, 120],
      [104, 125],
    ],
    "#633A26"
  );
  // Metal sheen & rust ribs
  pixelLine(ctx, 103, 113, 120, 109, "#A86A44");
  pixelLine(ctx, 109, 110, 112, 123, "#3D2418");
  pixelLine(ctx, 116, 109, 119, 121, "#3D2418");
  // Dark sunken end opening
  pixelEllipse(ctx, 103, 118, 3, 6, "#291B14");
  pixelEllipse(ctx, 103, 118, 2, 4, "#171210");
  // Mud clumping over buried bottom edge
  pixelEllipse(ctx, 114, 124, 10, 3, "#595D57");
  rect(ctx, 81, 122, 19, 3, "#595D57");

  // --- HOTSPOT 3: HS_MATA_DENSA [244, 42, 74, 86] ---
  // Dense looming multi-layered dark scrub & pine forest wall
  // Deepest woodland shadow backdrop
  fillPixelPolygon(
    ctx,
    [
      [246, 126],
      [252, 62],
      [272, 42],
      [320, 40],
      [320, 128],
    ],
    "#18211E"
  );
  // Back canopy conifers
  drawPineTree(ctx, 266, 116, 72, 18, {
    trunk: "#1E1A16",
    dark: "#1A2420",
    mid: "#26362F",
    light: "#374D43",
  });
  drawPineTree(ctx, 294, 114, 78, 22, {
    trunk: "#1E1A16",
    dark: "#16201C",
    mid: "#23332C",
    light: "#344A40",
  });
  drawPineTree(ctx, 314, 122, 74, 20, {
    trunk: "#1E1A16",
    dark: "#141C19",
    mid: "#1F2E28",
    light: "#2E4239",
  });
  // Foreground scrub trees & tangled dark bramble edge
  drawPineTree(ctx, 255, 126, 54, 14, {
    trunk: "#26201B",
    dark: "#1F2B26",
    mid: "#2D3F37",
    light: "#41594D",
  });
  drawPineTree(ctx, 282, 128, 62, 17, {
    trunk: "#26201B",
    dark: "#1B2621",
    mid: "#293A32",
    light: "#3D5448",
  });
  // Tangled undergrowth bushes at base of forest (x: 244..318, y: 112..129)
  for (let bx = 248; bx <= 314; bx += 11) {
    pixelEllipse(ctx, bx, 123, 8, 6, "#1C2621");
    pixelEllipse(ctx, bx - 1, 121, 6, 4, "#2C3D34");
    px(ctx, bx - 2, 119, "#465E51");
  }

  // --- HOTSPOT 2: HS_FLORES_VALE [168, 122, 46, 26] ---
  // Uncanny, startlingly lush mound of vibrant white & purple wildflowers
  // Rich mossy soil ring contrasting against gray chalky mud
  pixelEllipse(ctx, 191, 142, 22, 6, "#394A34");
  pixelEllipse(ctx, 191, 140, 20, 6, "#2E542B");
  // Lush layered Stardew-style green leaf clumps
  const leafClumps = [
    [176, 138, 7, 5],
    [186, 136, 9, 6],
    [197, 137, 8, 6],
    [206, 139, 7, 5],
    [191, 141, 12, 5],
  ];
  for (const [lx, ly, rx, ry] of leafClumps) {
    pixelEllipse(ctx, lx, ly, rx, ry, "#356330");
    pixelEllipse(ctx, lx, ly - 1, Math.max(2, rx - 2), Math.max(2, ry - 1), "#4F8A44");
  }
  // Crisp grass blades & stems rising up to y: 124
  for (let sx = 172; sx <= 210; sx += 3) {
    const sh = 6 + Math.floor(rng() * 8);
    const lean = rng() > 0.5 ? 1 : -1;
    pixelLine(ctx, sx, 141, sx + lean, 141 - sh, rng() > 0.4 ? "#5EA14F" : "#7AC268");
  }
  // Vivid white & purple wildflowers baked into patch (supplemented by animated swaying blooms in DynamicDecor)
  const staticBlooms: Array<[number, number, "white" | "purple"]> = [
    [174, 134, "white"],
    [181, 129, "purple"],
    [188, 133, "white"],
    [194, 127, "purple"],
    [201, 132, "white"],
    [208, 135, "purple"],
    [184, 139, "white"],
    [197, 139, "purple"],
    [178, 140, "purple"],
    [204, 140, "white"],
  ];
  for (const [fx, fy, kind] of staticBlooms) {
    if (kind === "white") {
      rect(ctx, fx - 1, fy - 1, 3, 3, "#E6E4DC");
      px(ctx, fx, fy - 2, "#FFFFFF");
      px(ctx, fx, fy + 2, "#FFFFFF");
      px(ctx, fx - 2, fy, "#FFFFFF");
      px(ctx, fx + 2, fy, "#FFFFFF");
      px(ctx, fx, fy, "#E8C958");
    } else {
      rect(ctx, fx - 1, fy - 1, 3, 3, "#7C4D8B");
      px(ctx, fx, fy - 2, "#B478CC");
      px(ctx, fx - 2, fy, "#9B61B3");
      px(ctx, fx + 2, fy, "#9B61B3");
      px(ctx, fx, fy + 1, "#593166");
      px(ctx, fx, fy, "#EED8F7");
    }
  }
}

// ---------- Room 3: R03_CABANA (320x180) ----------

function paintRoomR03Cabana(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Rustic horizontal log/plank cabin walls (y: 0..124)
  drawWoodPlanksHorizontal(
    ctx,
    0,
    0,
    w,
    124,
    11,
    {
      seam: "#1A130E",
      dark: "#36291F",
      mid: "#4A3829",
      light: "#614A36",
      nail: "#1C1510",
    },
    301
  );

  // Exposed dark timber ceiling beam & vertical support posts
  rect(ctx, 0, 0, w, 17, "#241B14");
  hline(ctx, 0, 16, w, "#14110E");
  hline(ctx, 0, 15, w, "#3D2E22");
  // Corner timber posts
  rect(ctx, 0, 16, 18, 112, "#291F17");
  vline(ctx, 17, 16, 112, "#14110E");
  vline(ctx, 15, 16, 112, "#453427");
  rect(ctx, 304, 16, 16, 112, "#291F17");
  vline(ctx, 304, 16, 112, "#14110E");
  // Baseboard trim
  rect(ctx, 0, 120, w, 5, "#261D16");
  hline(ctx, 0, 120, w, "#594433");

  // Cozy wall shelf on upper left (x: 24..78, y: 50..56) with lantern & tin cans
  rect(ctx, 24, 54, 54, 4, "#30231A");
  hline(ctx, 24, 54, 54, "#6E553E");
  rect(ctx, 29, 58, 3, 6, "#241A13");
  rect(ctx, 70, 58, 3, 6, "#241A13");
  // Oil lantern on shelf
  rect(ctx, 34, 42, 8, 12, "#38322B");
  rect(ctx, 36, 45, 4, 6, "#B59A72");
  px(ctx, 37, 47, "#F5DF8C");
  hline(ctx, 33, 42, 10, "#595045");
  // Ration tins
  rect(ctx, 50, 47, 7, 7, "#6E685C");
  hline(ctx, 50, 47, 7, "#9E9787");
  rect(ctx, 60, 48, 6, 6, "#5C4738");
  hline(ctx, 60, 48, 6, "#8C705B");

  // Pinned faded patrol sector map on center-left wall (x: 92..136, y: 44..72)
  rect(ctx, 92, 44, 44, 28, "#8F7D5E");
  outlineRect(ctx, 92, 44, 44, 28, "#2E241C");
  rect(ctx, 94, 46, 40, 24, "#B5A17D");
  pixelLine(ctx, 98, 64, 112, 54, "#594836");
  pixelLine(ctx, 112, 54, 128, 58, "#594836");
  rect(ctx, 114, 52, 4, 4, "#8A3A2E");
  px(ctx, 94, 46, "#C9A832");
  px(ctx, 133, 46, "#C9A832");

  // Late-afternoon golden window on upper-right wall (x: 204..246, y: 24..60 — above Dilan!)
  rect(ctx, 202, 22, 48, 42, "#241B14");
  rect(ctx, 204, 24, 44, 38, "#54402E");
  // Warm golden exterior light panes
  ditherVerticalGradient(ctx, 207, 27, 38, 32, ["#B59035", "#D9B64E", "#F2DA82"]);
  // Distant tree silhouette outside window
  fillPixelPolygon(
    ctx,
    [
      [207, 59],
      [216, 45],
      [226, 52],
      [237, 42],
      [245, 59],
    ],
    "#5E4A29"
  );
  // Window muntin crossbars
  rect(ctx, 225, 25, 3, 36, "#36291E");
  rect(ctx, 205, 42, 42, 3, "#36291E");
  // Sill highlight
  rect(ctx, 201, 61, 50, 3, "#7D6247");
  hline(ctx, 201, 61, 50, "#C9A832");

  // Warm floorboards (y: 124..180)
  drawWoodPlanksHorizontal(
    ctx,
    0,
    124,
    w,
    h - 124,
    8,
    {
      seam: "#1A140F",
      dark: "#473729",
      mid: "#5C4735",
      light: "#785E47",
      nail: "#211912",
    },
    302
  );

  // Warm golden sunlight pool cast across right cabin floorboards from window
  fillPixelPolygon(
    ctx,
    [
      [182, 128],
      [246, 128],
      [228, 160],
      [158, 160],
    ],
    "#7D6443"
  );
  ditherRect(ctx, 168, 130, 68, 28, "#C9A832", 0.24);

  // Subtle corner shadow vignette baked into room edges
  ditherRect(ctx, 0, 16, 28, 164, "#14110E", 0.45);
  ditherRect(ctx, 296, 16, 24, 164, "#14110E", 0.35);

  // --- CENTRAL TIMBER PATROL TABLE (supporting HS_MOCHILA_MESA, HS_CONTADOR_GEIGER, HS_COLDRE_MESA) ---
  // Table floor shadow
  pixelEllipse(ctx, 148, 133, 52, 5, "#241B14");
  // Back legs
  rect(ctx, 108, 120, 4, 12, "#2B2017");
  rect(ctx, 184, 120, 4, 12, "#2B2017");
  // Tabletop perspective surface (x: 98..198, y: 110..122)
  fillPixelPolygon(
    ctx,
    [
      [104, 110],
      [192, 110],
      [198, 121],
      [98, 121],
    ],
    "#7D634A"
  );
  // Tabletop plank seams & warm edge highlight
  hline(ctx, 103, 113, 90, "#594533");
  hline(ctx, 101, 117, 94, "#594533");
  hline(ctx, 104, 110, 88, "#A38564");
  hline(ctx, 98, 120, 100, "#A38564");
  // Thick front table apron
  rect(ctx, 98, 121, 100, 5, "#4A3829");
  hline(ctx, 98, 125, 100, "#241A13");
  // Front heavy timber legs
  rect(ctx, 101, 121, 6, 14, "#3B2C20");
  vline(ctx, 102, 121, 14, "#614A36");
  rect(ctx, 189, 121, 6, 14, "#3B2C20");
  vline(ctx, 190, 121, 14, "#614A36");

  // --- HOTSPOT 1: HS_MOCHILA_MESA [108, 102, 28, 20] ---
  // Contact shadow on tabletop
  pixelEllipse(ctx, 122, 119, 12, 2, "#423325");
  // Worn survival canvas backpack resting on left of table
  rect(ctx, 111, 105, 22, 14, "#6B6148");
  outlineRect(ctx, 111, 105, 22, 14, "#2B241B");
  // Slouched top flap
  rect(ctx, 112, 104, 20, 6, "#857A5C");
  hline(ctx, 113, 104, 18, "#A39674");
  hline(ctx, 112, 110, 20, "#3D3628");
  // Two warm leather straps & brass buckles
  rect(ctx, 115, 105, 3, 12, "#5E3F27");
  rect(ctx, 126, 105, 3, 12, "#5E3F27");
  rect(ctx, 115, 111, 3, 2, "#D9B44A");
  rect(ctx, 126, 111, 3, 2, "#D9B44A");
  // Side pouch
  rect(ctx, 109, 109, 3, 8, "#544C38");

  // --- HOTSPOT 2: HS_CONTADOR_GEIGER [140, 104, 22, 16] ---
  // Contact shadow
  rect(ctx, 141, 118, 20, 2, "#423325");
  // Black carrying handle arching over box
  hline(ctx, 146, 104, 10, "#242220");
  vline(ctx, 145, 105, 3, "#242220");
  vline(ctx, 156, 105, 3, "#242220");
  hline(ctx, 147, 105, 8, "#4A4642");
  // Yellow Geiger counter body
  rect(ctx, 142, 107, 18, 11, "#D6B238");
  outlineRect(ctx, 142, 107, 18, 11, "#3B2E12");
  hline(ctx, 143, 108, 16, "#F0D260");
  rect(ctx, 143, 115, 16, 2, "#A68524");
  // Analog meter display window
  rect(ctx, 144, 109, 9, 5, "#262420");
  rect(ctx, 145, 110, 7, 3, "#E6E2CC");
  pixelLine(ctx, 148, 112, 150, 110, "#B83025");
  // Control dial & LED housing (blinking LED sits at 157, 110 in DynamicDecor!)
  rect(ctx, 155, 113, 3, 3, "#2E2B26");
  px(ctx, 156, 114, "#8C867A");
  rect(ctx, 156, 109, 2, 2, "#591A16");
  // Coiled black probe wire tucked on left
  pixelLine(ctx, 140, 113, 142, 112, "#242220");
  pixelLine(ctx, 140, 114, 141, 117, "#242220");

  // --- HOTSPOT 3: HS_COLDRE_MESA [166, 104, 24, 16] (conditional prop!) ---
  // Subtle worn leather scuff ring on clean tabletop underneath
  pixelEllipse(ctx, 178, 116, 8, 2, "#6B543E");

  // --- HOTSPOT 4: HS_PORTA_CABANA [264, 58, 36, 78] ---
  // Outer heavy wooden doorframe
  rect(ctx, 263, 56, 38, 80, "#241B14");
  rect(ctx, 265, 58, 34, 77, "#3B2C20");
  // Vertical heavy door planks
  drawWoodPlanksVertical(
    ctx,
    267,
    60,
    30,
    73,
    6,
    {
      seam: "#1F1610",
      dark: "#473527",
      mid: "#5C4633",
      light: "#735942",
    },
    303
  );
  // Horizontal reinforcement Z-braces on cabin door
  rect(ctx, 268, 72, 28, 5, "#3D2E22");
  hline(ctx, 268, 72, 28, "#6E553E");
  rect(ctx, 268, 114, 28, 5, "#3D2E22");
  hline(ctx, 268, 114, 28, "#6E553E");
  // Iron strap hinges on right
  rect(ctx, 288, 73, 8, 3, "#262424");
  px(ctx, 290, 74, "#6E6A66");
  rect(ctx, 288, 115, 8, 3, "#262424");
  px(ctx, 290, 116, "#6E6A66");
  // Heavy iron latch & deadbolt on left
  rect(ctx, 270, 94, 6, 4, "#2B2928");
  rect(ctx, 268, 95, 5, 2, "#75706B");
  rect(ctx, 270, 88, 7, 3, "#2B2928");
  hline(ctx, 271, 89, 5, "#8F887E");
  // Subtle warm vertical light crack along door seam
  vline(ctx, 266, 61, 71, "#B8973E");
}

// ---------- Room 4: R04_QUARTO (320x180) ----------

function paintRoomR04Quarto(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Upper cozy cream-parchment farmhouse wall (y: 14..84)
  ditherVerticalGradient(ctx, 0, 14, w, 72, ["#B5A284", "#C9B796", "#D9C7A3", "#E3D3B3"]);

  // Soft golden sunlight bloom on wall around window (x: 112..196)
  ditherRect(ctx, 112, 24, 84, 62, "#F2E6C9", 0.35);

  // Dark honey-oak ceiling beam (y: 0..16)
  rect(ctx, 0, 0, w, 16, "#3B2B20");
  hline(ctx, 0, 14, w, "#634A37");
  hline(ctx, 0, 15, w, "#241913");

  // Warm honey-oak vertical wainscoting (y: 84..125)
  drawWoodPlanksVertical(
    ctx,
    0,
    84,
    w,
    41,
    8,
    {
      seam: "#3D2C20",
      dark: "#694D39",
      mid: "#7D5E46",
      light: "#967458",
    },
    401
  );
  // Chair rail molding & baseboard trim
  rect(ctx, 0, 82, w, 4, "#543D2C");
  hline(ctx, 0, 82, w, "#A88A6B");
  hline(ctx, 0, 85, w, "#2E2118");
  rect(ctx, 0, 121, w, 4, "#473529");
  hline(ctx, 0, 121, w, "#8F7054");

  // Small framed botanical wall art left of window (x: 74..98, y: 46..68)
  rect(ctx, 74, 46, 24, 22, "#4A3628");
  outlineRect(ctx, 74, 46, 24, 22, "#291D15");
  rect(ctx, 77, 49, 18, 16, "#EAE0C8");
  pixelLine(ctx, 86, 62, 86, 53, "#4E7043");
  pixelLine(ctx, 86, 58, 82, 55, "#4E7043");
  pixelLine(ctx, 86, 56, 90, 54, "#4E7043");
  rect(ctx, 85, 51, 3, 2, "#C97A63");

  // Cozy honey-oak floorboards (y: 125..180)
  drawWoodPlanksHorizontal(
    ctx,
    0,
    125,
    w,
    h - 125,
    7,
    {
      seam: "#473529",
      dark: "#85654B",
      mid: "#9C7A5C",
      light: "#B59372",
      nail: "#543D2C",
    },
    402
  );

  // Sunlit bright morning rectangle cast on floorboards below window
  fillPixelPolygon(
    ctx,
    [
      [126, 126],
      [184, 126],
      [196, 158],
      [114, 158],
    ],
    "#C7A882"
  );
  ditherRect(ctx, 120, 128, 70, 28, "#F2E4C2", 0.25);

  // Hand-woven Stardew farmhouse braided rug in center foreground (x: 92..196, y: 138..162)
  pixelEllipse(ctx, 144, 150, 52, 12, "#59362C");
  pixelEllipse(ctx, 144, 150, 48, 10, "#8C4E3E");
  pixelEllipse(ctx, 144, 150, 40, 8, "#C9AE82");
  pixelEllipse(ctx, 144, 150, 31, 6, "#5C7352");
  pixelEllipse(ctx, 144, 150, 20, 4, "#B56A52");
  pixelEllipse(ctx, 144, 150, 11, 2, "#DEC79E");

  // --- HOTSPOT 1: HS_ARMARIO_ROUPAS [18, 66, 34, 68] ---
  // Floor shadow
  pixelEllipse(ctx, 35, 134, 16, 3, "#4A3628");
  // Crown cornice
  rect(ctx, 17, 66, 36, 5, "#4A3526");
  hline(ctx, 17, 66, 36, "#8C6C51");
  hline(ctx, 17, 70, 36, "#261A12");
  // Main oak body
  rect(ctx, 19, 71, 32, 60, "#6E513B");
  outlineRect(ctx, 19, 71, 32, 60, "#2B1E15");
  // Twin recessed wooden doors
  rect(ctx, 21, 74, 13, 52, "#7D5E46");
  outlineRect(ctx, 21, 74, 13, 52, "#473325");
  rect(ctx, 36, 74, 13, 52, "#7D5E46");
  outlineRect(ctx, 36, 74, 13, 52, "#473325");
  // Inner recessed panel highlights
  outlineRect(ctx, 23, 77, 9, 20, "#9C7B5E");
  outlineRect(ctx, 23, 100, 9, 22, "#9C7B5E");
  outlineRect(ctx, 38, 77, 9, 20, "#9C7B5E");
  outlineRect(ctx, 38, 100, 9, 22, "#9C7B5E");
  // Brass round knobs
  rect(ctx, 32, 99, 2, 2, "#E8B948");
  rect(ctx, 36, 99, 2, 2, "#E8B948");
  // Carved wardrobe feet
  rect(ctx, 20, 131, 5, 3, "#3D2B1E");
  rect(ctx, 45, 131, 5, 3, "#3D2B1E");

  // --- HOTSPOT 2: HS_CAMA_MADEIRA [54, 102, 78, 36] ---
  // Under-bed shadow
  rect(ctx, 56, 134, 74, 4, "#4A3628");
  // Wooden headboard (left)
  rect(ctx, 54, 98, 9, 38, "#5C4230");
  outlineRect(ctx, 54, 98, 9, 38, "#291D15");
  rect(ctx, 56, 102, 5, 16, "#7D5D45");
  hline(ctx, 54, 98, 9, "#9C7A5C");
  // Plump cream pillow
  pixelEllipse(ctx, 70, 111, 8, 5, "#D9CEB8");
  pixelEllipse(ctx, 69, 110, 6, 3, "#F5EFE0");
  // Sheet fold
  rect(ctx, 76, 108, 7, 16, "#EAE0CC");
  vline(ctx, 82, 108, 16, "#B8AD96");
  // Cozy Stardew patchwork quilted blanket (x: 82..125, y: 108..128)
  rect(ctx, 82, 108, 44, 20, "#9C5243");
  outlineRect(ctx, 82, 108, 44, 20, "#4A2720");
  // Patchwork squares
  const patchColors = ["#B86B58", "#E8B948", "#658259", "#D9C398"];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const pc = patchColors[(row * 3 + col) % patchColors.length];
      rect(ctx, 84 + col * 7, 110 + row * 6, 6, 5, pc);
    }
  }
  // Quilt drape highlight along top edge & lower shadow fold
  hline(ctx, 83, 109, 42, "#E8D7B7");
  ditherRect(ctx, 83, 122, 42, 5, "#4A2720", 0.35);
  // Timber bed side rail & footboard
  rect(ctx, 62, 126, 64, 6, "#5C4230");
  hline(ctx, 62, 126, 64, "#8C6C51");
  hline(ctx, 62, 131, 64, "#2B1E15");
  rect(ctx, 124, 108, 8, 28, "#5C4230");
  outlineRect(ctx, 124, 108, 8, 28, "#291D15");
  hline(ctx, 124, 108, 8, "#9C7A5C");

  // --- HOTSPOT 3: HS_JANELA_QUARTO [126, 36, 56, 48] ---
  // Outer wooden window casing
  rect(ctx, 126, 36, 56, 48, "#543D2C");
  outlineRect(ctx, 126, 36, 56, 48, "#2B1E15");
  // Exterior sunlit farmhouse view inside panes (x: 131..177, y: 40..79)
  ditherVerticalGradient(ctx, 131, 40, 46, 22, ["#B5C9C4", "#DCE3CE", "#F5ECD0"]);
  // Sunlit dry fields & distant hill
  fillPixelPolygon(
    ctx,
    [
      [131, 62],
      [148, 57],
      [164, 60],
      [177, 56],
      [177, 79],
      [131, 79],
    ],
    "#C9AE79"
  );
  // Green irrigated crop strip & tiny red barn on horizon
  rect(ctx, 131, 68, 46, 11, "#9E8458");
  hline(ctx, 134, 71, 20, "#5B784E");
  hline(ctx, 136, 74, 24, "#5B784E");
  // Tiny barn silhouette in distance
  rect(ctx, 161, 56, 10, 7, "#8C3A32");
  fillPixelPolygon(
    ctx,
    [
      [160, 56],
      [166, 52],
      [172, 56],
    ],
    "#592722"
  );
  // Window muntin crossbars
  rect(ctx, 153, 39, 3, 41, "#694D39");
  rect(ctx, 130, 58, 48, 3, "#694D39");
  // Cozy tucked cream curtains flanking window panes
  rect(ctx, 130, 39, 6, 38, "#EDE2C7");
  vline(ctx, 135, 39, 38, "#C4B493");
  rect(ctx, 172, 39, 6, 38, "#EDE2C7");
  vline(ctx, 172, 39, 38, "#C4B493");
  // Window sill
  rect(ctx, 124, 80, 60, 4, "#7D5E46");
  hline(ctx, 124, 80, 60, "#B89774");
  hline(ctx, 124, 83, 60, "#332419");

  // --- HOTSPOT 4: HS_BANDEJA_SERINGA [218, 108, 32, 26] (conditional prop!) ---
  // Wall & floor are already cleanly painted here so cart appears/disappears seamlessly.

  // --- HOTSPOT 5: HS_PORTA_QUARTO [266, 58, 34, 78] ---
  // Molded timber doorframe
  rect(ctx, 265, 56, 36, 80, "#473325");
  outlineRect(ctx, 265, 56, 36, 80, "#241913");
  // Door leaf
  rect(ctx, 268, 59, 30, 75, "#755842");
  outlineRect(ctx, 268, 59, 30, 75, "#33241A");
  // Recessed upper and lower classic panels
  rect(ctx, 272, 64, 22, 26, "#634937");
  outlineRect(ctx, 272, 64, 22, 26, "#453225");
  hline(ctx, 273, 65, 20, "#8F7054");
  rect(ctx, 272, 95, 22, 32, "#634937");
  outlineRect(ctx, 272, 95, 22, 32, "#453225");
  hline(ctx, 273, 96, 20, "#8F7054");
  // Gleaming brass doorknob & keyhole plate
  rect(ctx, 270, 91, 3, 7, "#9C7B32");
  rect(ctx, 270, 93, 3, 3, "#E8B948");
  px(ctx, 271, 93, "#FFF1B5");
}

// ---------- Room 5: R05_CORREDOR (320x180) ----------

function paintRoomR05Corredor(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Dim, symmetrical gothic-rural manor hallway walls (y: 0..128)
  ditherVerticalGradient(ctx, 0, 0, w, 80, ["#1A1410", "#29201A", "#3B2E25"]);

  // Coffered dark timber ceiling beam
  rect(ctx, 0, 0, w, 20, "#14100D");
  hline(ctx, 0, 18, w, "#3B2D24");
  hline(ctx, 0, 19, w, "#0E0B09");

  // Formal vertical wallpaper/timber wall bays
  for (let wx = 8; wx < w; wx += 32) {
    vline(ctx, wx, 20, 62, "#241B16");
    vline(ctx, wx + 1, 20, 62, "#4A3A2E");
  }

  // Lower dark walnut wainscoting (y: 80..126)
  drawWoodPlanksVertical(
    ctx,
    0,
    80,
    w,
    46,
    9,
    {
      seam: "#17120E",
      dark: "#2E231C",
      mid: "#403127",
      light: "#544134",
    },
    501
  );
  // Chair rail & heavy baseboard
  rect(ctx, 0, 78, w, 4, "#241B15");
  hline(ctx, 0, 78, w, "#634E3F");
  rect(ctx, 0, 123, w, 4, "#1C1511");
  hline(ctx, 0, 123, w, "#524033");

  // Symmetrical wall sconces flanking central front door (x: 131 & x: 188, y: 66..76)
  for (const sx of [131, 188]) {
    rect(ctx, sx - 2, 68, 5, 9, "#241C16");
    rect(ctx, sx - 1, 64, 3, 5, "#8C7856");
    px(ctx, sx, 62, "#E8C36B");
  }

  // Framed dark portrait on right wall balancing staircase (x: 208..236, y: 40..68)
  rect(ctx, 208, 40, 28, 28, "#3B2C21");
  outlineRect(ctx, 208, 40, 28, 28, "#17120E");
  outlineRect(ctx, 210, 42, 24, 24, "#78604D");
  rect(ctx, 212, 44, 20, 20, "#241D18");
  // Vague shadowed landscape inside painting
  fillPixelPolygon(
    ctx,
    [
      [212, 64],
      [220, 56],
      [232, 58],
      [232, 64],
    ],
    "#3B3228"
  );

  // Dark walnut hallway floorboards (y: 126..180)
  drawWoodPlanksHorizontal(
    ctx,
    0,
    126,
    w,
    h - 126,
    8,
    {
      seam: "#14100D",
      dark: "#2E231C",
      mid: "#3D2F26",
      light: "#544235",
      nail: "#17120E",
    },
    502
  );

  // Symmetrical crimson & gold patterned central runner rug leading to front door
  fillPixelPolygon(
    ctx,
    [
      [135, 128],
      [187, 128],
      [204, 180],
      [118, 180],
    ],
    "#5E2520"
  );
  // Gold border trim along runner edges
  pixelLine(ctx, 138, 129, 122, 179, "#9E824F");
  pixelLine(ctx, 184, 129, 200, 179, "#9E824F");
  // Subtle geometric diamond motifs down the runner
  for (let ry = 136; ry <= 172; ry += 12) {
    fillPixelPolygon(
      ctx,
      [
        [161, ry - 4],
        [169, ry],
        [161, ry + 4],
        [153, ry],
      ],
      "#7D342C"
    );
    px(ctx, 161, ry, "#B89A63");
  }

  // --- HOTSPOT 1: HS_ESCADA_QUARTO [78, 32, 48, 92] ---
  // Recessed dark upper stairwell cavity
  rect(ctx, 78, 32, 48, 92, "#17120E");
  outlineRect(ctx, 78, 32, 48, 92, "#3B2D24");
  // Ascending wooden stairs (11 crisp steps climbing up toward 2nd floor)
  const stepCount = 11;
  for (let i = 0; i < stepCount; i++) {
    const sy = 118 - i * 7;
    const inset = Math.floor(i * 0.6);
    const sx = 80 + inset;
    const sw = 42 - inset * 2;
    // Riser shadow
    rect(ctx, sx, sy + 2, sw, 5, "#261D17");
    // Step tread
    rect(ctx, sx, sy, sw, 2, "#634E3F");
    hline(ctx, sx, sy, sw, "#826854");
    // Runner strip up stairs
    const rW = Math.max(10, Math.floor(sw * 0.45));
    const rX = sx + Math.floor((sw - rW) / 2);
    rect(ctx, rX, sy, rW, 7, "#4F201C");
    hline(ctx, rX, sy, rW, "#6E2E28");
  }
  // Sturdy walnut banister rail & spindles on right edge of staircase
  pixelLine(ctx, 121, 96, 114, 38, "#6E5542");
  pixelLine(ctx, 122, 96, 115, 38, "#4A382B");
  for (let b = 0; b < 6; b++) {
    const bx = 120 - b;
    const topY = 95 - b * 9;
    vline(ctx, bx, topY, 20, "#4F3D31");
  }
  // Carved newel post at foot of stairs
  rect(ctx, 119, 98, 7, 26, "#4F3D31");
  outlineRect(ctx, 119, 98, 7, 26, "#1C1511");
  rect(ctx, 118, 96, 9, 4, "#78604D");

  // --- HOTSPOT 2: HS_PORTA_ALA_OESTE [16, 62, 34, 76] ---
  drawLockedWingDoor(ctx, 16, 62, 34, 76, "left");

  // --- HOTSPOT 3: HS_PORTA_ALA_LESTE [270, 62, 34, 76] ---
  drawLockedWingDoor(ctx, 270, 62, 34, 76, "right");

  // --- HOTSPOT 4: HS_PORTA_PRINCIPAL [140, 56, 42, 74] ---
  // Grand architrave pediment header
  rect(ctx, 136, 51, 50, 6, "#2E231B");
  hline(ctx, 136, 51, 50, "#6E5846");
  hline(ctx, 138, 56, 46, "#14100D");
  // Heavy doorframe
  rect(ctx, 139, 56, 44, 74, "#241B15");
  outlineRect(ctx, 139, 56, 44, 74, "#120E0B");
  // Heavy solid timber front door leaf
  rect(ctx, 142, 59, 38, 69, "#4F3D31");
  // Twin tall recessed gothic-rural panels
  rect(ctx, 146, 64, 13, 25, "#3B2D24");
  outlineRect(ctx, 146, 64, 13, 25, "#241B15");
  hline(ctx, 147, 65, 11, "#6E5846");
  rect(ctx, 163, 64, 13, 25, "#3B2D24");
  outlineRect(ctx, 163, 64, 13, 25, "#241B15");
  hline(ctx, 164, 65, 11, "#6E5846");
  rect(ctx, 146, 94, 13, 28, "#3B2D24");
  outlineRect(ctx, 146, 94, 13, 28, "#241B15");
  rect(ctx, 163, 94, 13, 28, "#3B2D24");
  outlineRect(ctx, 163, 94, 13, 28, "#241B15");
  // Heavy iron deadbolt & brass handle on right
  rect(ctx, 173, 92, 4, 8, "#241F1C");
  rect(ctx, 174, 94, 3, 3, "#D4B35B");
  rect(ctx, 171, 86, 7, 3, "#1C1816");
  hline(ctx, 172, 87, 5, "#8A8278");

  // BRIGHT WARM SUNLIGHT SHAFT BLEEDING UNDER THRESHOLD onto floorboards & runner!
  rect(ctx, 142, 127, 38, 3, "#FFF9E8");
  hline(ctx, 143, 128, 36, "#FFFFFF");
  fillPixelPolygon(
    ctx,
    [
      [142, 130],
      [180, 130],
      [198, 162],
      [124, 162],
    ],
    "#C4AF89"
  );
  // Crisp dithered bright core near the threshold fading down the runner
  ditherRect(ctx, 140, 130, 42, 10, "#FFF9E8", 0.65);
  ditherRect(ctx, 134, 138, 54, 12, "#F2E5C4", 0.35);
  ditherRect(ctx, 126, 148, 70, 14, "#C4AF89", 0.18);

  // Deep atmospheric edge shadows
  ditherRect(ctx, 0, 20, 14, 160, "#120F0D", 0.55);
  ditherRect(ctx, 306, 20, 14, 160, "#120F0D", 0.55);
}

function drawLockedWingDoor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  side: "left" | "right"
): void {
  // Heavy casing
  rect(ctx, x, y, w, h, "#211914");
  outlineRect(ctx, x, y, w, h, "#120E0B");
  // Dark timber door
  rect(ctx, x + 3, y + 3, w - 6, h - 5, "#423328");
  // Recessed panels
  rect(ctx, x + 6, y + 8, w - 12, 24, "#30241C");
  outlineRect(ctx, x + 6, y + 8, w - 12, 24, "#1C1510");
  rect(ctx, x + 6, y + 37, w - 12, 30, "#30241C");
  outlineRect(ctx, x + 6, y + 37, w - 12, 30, "#1C1510");
  // Brass nameplate plaque (no text!)
  rect(ctx, x + 10, y + 16, w - 20, 5, "#8C7038");
  hline(ctx, x + 10, y + 16, w - 20, "#D9B962");
  hline(ctx, x + 12, y + 18, w - 24, "#4A391B");
  // Heavy iron padlock & hasp on inner edge
  const lockX = side === "left" ? x + w - 10 : x + 4;
  rect(ctx, lockX, y + 38, 6, 3, "#262424");
  // Padlock shackle
  outlineRect(ctx, lockX + 1, y + 39, 4, 4, "#8F8A82");
  // Padlock body
  rect(ctx, lockX, y + 42, 6, 6, "#9E7E36");
  outlineRect(ctx, lockX, y + 42, 6, 6, "#2E2310");
  hline(ctx, lockX + 1, y + 43, 4, "#E0BE63");
  px(ctx, lockX + 2, y + 45, "#1C1510");
}

// ---------- Room 6: R06_PATIO (480x180 scrolling) ----------

function paintRoomR06Patio(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rng = createRng(606);

  // Scorching sunlit post-apocalyptic sky (y: 0..76)
  ditherVerticalGradient(ctx, 0, 0, w, 78, [
    "#96ACA8",
    "#BAC7BC",
    "#DEDBC4",
    "#F2E6C4",
    "#F7EED2",
  ]);

  // Subtle warm sun halo high center
  pixelEllipse(ctx, 242, 16, 26, 12, "#FAF3DA");
  pixelEllipse(ctx, 242, 16, 14, 7, "#FFFCEE");

  // Soft Stardew-style warm sky clouds across 480px panorama
  drawPixelCloud(ctx, 132, 22, 64, 15, "#FFFDF2", "#EFE8D2", "#D4CBB3");
  drawPixelCloud(ctx, 296, 26, 74, 16, "#FFFDF2", "#EFE8D2", "#D4CBB3");
  drawPixelCloud(ctx, 412, 18, 58, 14, "#FAF5E3", "#E8DFC5", "#CFC5AA");

  // Distant dry foothills across horizon (y: 62..88)
  fillPixelPolygon(
    ctx,
    [
      [60, 78],
      [126, 65],
      [196, 72],
      [274, 62],
      [350, 70],
      [420, 64],
      [480, 72],
      [480, 96],
      [60, 96],
    ],
    "#B3A182"
  );
  fillPixelPolygon(
    ctx,
    [
      [60, 84],
      [148, 74],
      [226, 80],
      [318, 72],
      [410, 80],
      [480, 76],
      [480, 102],
      [60, 102],
    ],
    "#968162"
  );

  // Distant fortified wooden watchtowers along the perimeter
  drawWatchtower(ctx, 118, 86);
  drawWatchtower(ctx, 296, 86);

  // Continuous fortified barbed-wire perimeter fence (x: 74..400, y: 74..92)
  for (let fx = 78; fx <= 398; fx += 12) {
    // Tall tilted wooden post
    rect(ctx, fx, 74, 2, 18, "#4A3829");
    px(ctx, fx, 74, "#6E5640");
    // Angled barbed-wire arm at top
    pixelLine(ctx, fx, 74, fx - 2, 70, "#382C22");
  }
  // Horizontal fence rails & taut wire lines
  hline(ctx, 74, 80, 326, "#5C4735");
  hline(ctx, 74, 86, 326, "#4A3829");
  hline(ctx, 74, 71, 326, "#474A48");
  hline(ctx, 74, 74, 326, "#5C5F5C");
  // Crisp barbed-wire coils/twists
  for (let bx = 76; bx <= 396; bx += 7) {
    px(ctx, bx, 70, "#2E302F");
    px(ctx, bx + 2, 72, "#2E302F");
    px(ctx, bx + 4, 73, "#6E7370");
  }

  // Sun-baked farm yard & crop field base (y: 88..180)
  ditherVerticalGradient(ctx, 0, 88, w, 40, ["#A88E68", "#BA9C72", "#C9AB80"]);
  // Walkable sun-baked gravel courtyard (y: 124..180)
  drawGroundTexture(
    ctx,
    124,
    w,
    h,
    {
      base: "#BD9B73",
      dark: "#8C6F52",
      light: "#DFC69B",
      pebble: "#6E5740",
      accent: "#EFE0BE",
    },
    607
  );
  // Subtle wheel tracks across the sunlit gravel path
  for (let tx = 70; tx < 440; tx += 2) {
    if (rng() > 0.2) {
      px(ctx, tx, 146, "#9C7E5C");
      px(ctx, tx, 155, "#9C7E5C");
    }
  }

  // --- VERDANT IRRIGATED CROP ROWS (center-left: x: 96..226, y: 94..128) ---
  // Tilled rich farm soil bed
  rect(ctx, 96, 94, 130, 34, "#6E523B");
  outlineRect(ctx, 96, 94, 130, 34, "#4A3626");
  // Alternating dark furrows, thin gleaming irrigation water channels & lush crop rows
  for (let row = 0; row < 4; row++) {
    const ry = 97 + row * 8;
    // Narrow gleaming irrigation trench
    hline(ctx, 98, ry, 126, "#5C7D87");
    hline(ctx, 100, ry, 42, "#8BB0BA");
    hline(ctx, 162, ry, 36, "#8BB0BA");
    // Raised crop mound
    rect(ctx, 98, ry + 2, 126, 4, "#543D2C");
    // Lush leafy green crop clusters (Stardew style)
    for (let cx = 102; cx <= 218; cx += 9) {
      pixelEllipse(ctx, cx, ry + 2, 4, 2, "#35522E");
      pixelEllipse(ctx, cx, ry + 1, 3, 2, "#4B6E40");
      px(ctx, cx - 1, ry, "#78A35E");
      if ((cx + row) % 3 === 0) {
        px(ctx, cx + 1, ry + 2, "#D98E43");
      }
    }
  }
  // Small wooden shade trellis/awning behind HS_NPC_JOSEPH [196, 102, 22, 30] ("Menino na sombra")
  rect(ctx, 193, 95, 29, 3, "#543D2C");
  hline(ctx, 193, 95, 29, "#8C6C51");
  vline(ctx, 194, 98, 28, "#4A3626");
  vline(ctx, 220, 98, 28, "#4A3626");
  ditherRect(ctx, 195, 98, 25, 30, "#241C16", 0.35);

  // --- HOTSPOT 1 & 2: MANOR FACADE, HS_SAIDA_CASARAO [14, 58, 56, 74] & HS_JANELA_SUPERIOR [28, 18, 30, 26] ---
  // Stone foundation & warm porch paving
  rect(ctx, 0, 126, 86, 12, "#8C7D68");
  hline(ctx, 0, 126, 86, "#B5A58E");
  // Main 2-story clapboard manor wall (x: 0..80, y: 0..128)
  drawWoodPlanksHorizontal(
    ctx,
    0,
    12,
    80,
    116,
    6,
    {
      seam: "#38291E",
      dark: "#634A37",
      mid: "#7D6048",
      light: "#99775B",
      nail: "#38291E",
    },
    608
  );
  // Corner vertical trim board
  rect(ctx, 76, 12, 5, 116, "#4A3628");
  vline(ctx, 80, 12, 116, "#241A13");
  // Upper roof overhang eave (y: 0..14)
  rect(ctx, 0, 0, 86, 13, "#3B2820");
  hline(ctx, 0, 12, 86, "#241813");
  hline(ctx, 0, 10, 86, "#5C4033");

  // HS_JANELA_SUPERIOR [28, 18, 30, 26] — 2nd-floor farmhouse window (clean base, Dilan eyes in conditional prop!)
  // Side wooden shutters
  rect(ctx, 22, 19, 6, 23, "#4A3628");
  outlineRect(ctx, 22, 19, 6, 23, "#241913");
  rect(ctx, 58, 19, 6, 23, "#4A3628");
  outlineRect(ctx, 58, 19, 6, 23, "#241913");
  // Window frame
  rect(ctx, 28, 18, 30, 26, "#D6C5A5");
  outlineRect(ctx, 28, 18, 30, 26, "#2E2219");
  // Dark interior glass
  rect(ctx, 31, 21, 24, 19, "#1E1A18");
  // Subtle pale curtains inside
  rect(ctx, 31, 21, 5, 19, "#9C927E");
  rect(ctx, 50, 21, 5, 19, "#9C927E");
  // Muntin bars
  rect(ctx, 42, 21, 2, 19, "#B8A688");
  rect(ctx, 31, 30, 24, 2, "#B8A688");
  // Window sill
  rect(ctx, 27, 41, 32, 3, "#A88A6B");

  // HS_SAIDA_CASARAO [14, 58, 56, 74] — Wooden manor porch, doorway & steps
  // Sloped porch roof awning (y: 56..68)
  fillPixelPolygon(
    ctx,
    [
      [6, 56],
      [78, 56],
      [84, 67],
      [6, 67],
    ],
    "#4A3227"
  );
  hline(ctx, 6, 66, 78, "#261913");
  hline(ctx, 6, 56, 72, "#755240");
  // Shaded recessed porch interior
  rect(ctx, 16, 67, 54, 55, "#36281F");
  // Manor front doorway centered inside porch
  rect(ctx, 32, 74, 24, 48, "#241A13");
  rect(ctx, 34, 76, 20, 45, "#594130");
  rect(ctx, 37, 80, 14, 16, "#453124");
  rect(ctx, 37, 99, 14, 18, "#453124");
  px(ctx, 50, 99, "#E8B948");
  // Porch support columns
  rect(ctx, 16, 67, 5, 55, "#C7B495");
  vline(ctx, 20, 67, 55, "#78664E");
  rect(ctx, 65, 67, 5, 55, "#C7B495");
  vline(ctx, 69, 67, 55, "#78664E");
  // Porch balustrade railing left and right of steps
  rect(ctx, 16, 102, 16, 3, "#C7B495");
  rect(ctx, 56, 102, 14, 3, "#C7B495");
  for (const bx of [21, 26, 30, 58, 62]) {
    rect(ctx, bx, 105, 2, 15, "#A89578");
  }
  // Wooden porch floor & 3 descending steps
  rect(ctx, 14, 120, 58, 4, "#755942");
  rect(ctx, 30, 124, 28, 3, "#8F7054");
  rect(ctx, 28, 127, 32, 3, "#785D45");
  rect(ctx, 26, 130, 36, 3, "#634C38");

  // --- HOTSPOT 3: HS_CERCADO_ANIMAIS [236, 92, 62, 38] ---
  // Dusty paddock soil & scattered straw
  rect(ctx, 238, 98, 58, 30, "#9E805B");
  ditherRect(ctx, 240, 102, 54, 22, "#7D6244", 0.3);
  for (let s = 0; s < 18; s++) {
    rect(ctx, 242 + Math.floor(rng() * 48), 106 + Math.floor(rng() * 18), 3, 1, "#DFC682");
  }
  // Back fence posts & horizontal rails (y: 92..106)
  for (let pxPos = 237; pxPos <= 296; pxPos += 14) {
    rect(ctx, pxPos, 92, 3, 16, "#543D2B");
    vline(ctx, pxPos + 1, 92, 16, "#7A5B42");
  }
  rect(ctx, 237, 95, 60, 2, "#7A5B42");
  rect(ctx, 237, 101, 60, 2, "#694D37");

  // Small wooden water trough left inside pen
  rect(ctx, 241, 113, 13, 7, "#543D2C");
  outlineRect(ctx, 241, 113, 13, 7, "#2B1E15");
  rect(ctx, 243, 114, 9, 2, "#6E9AA8");
  hline(ctx, 244, 114, 5, "#A6CFD9");

  // Animal 1: Cozy Stardew-style spotted dairy cow (x: 254..274, y: 103..119)
  pixelEllipse(ctx, 264, 118, 9, 2, "#6B543C");
  // Legs
  rect(ctx, 257, 113, 2, 6, "#DED9CC");
  rect(ctx, 261, 113, 2, 6, "#C4BEB0");
  rect(ctx, 267, 113, 2, 6, "#DED9CC");
  rect(ctx, 270, 113, 2, 6, "#C4BEB0");
  // Plump body
  rect(ctx, 256, 105, 16, 9, "#F0ECE1");
  outlineRect(ctx, 256, 105, 16, 9, "#4A3C31");
  // Warm brown cow spots
  rect(ctx, 260, 106, 5, 4, "#63432E");
  rect(ctx, 266, 109, 4, 4, "#63432E");
  // Cow head & horns (facing left toward trough)
  rect(ctx, 252, 104, 6, 6, "#F0ECE1");
  outlineRect(ctx, 252, 104, 6, 6, "#4A3C31");
  rect(ctx, 252, 108, 4, 2, "#D9A79C"); // pink snout
  px(ctx, 254, 106, "#1F1916"); // eye
  px(ctx, 253, 103, "#C4B493"); // tiny horn
  px(ctx, 256, 103, "#C4B493");

  // Animal 2: Woolly cream sheep/goat (x: 277..292, y: 107..120)
  pixelEllipse(ctx, 284, 119, 6, 2, "#6B543C");
  rect(ctx, 280, 115, 2, 5, "#4A3F38");
  rect(ctx, 287, 115, 2, 5, "#4A3F38");
  // Fluffy wool body
  pixelEllipse(ctx, 284, 112, 6, 4, "#EAE4D3");
  pixelEllipse(ctx, 284, 111, 5, 3, "#FAF6EB");
  // Dark face facing right
  rect(ctx, 288, 109, 4, 4, "#4A3F38");
  px(ctx, 290, 110, "#FAF6EB"); // eye glint
  px(ctx, 287, 109, "#695A50"); // ear

  // Front fence posts & rails (drawn in front of animals for 2.5D depth!)
  for (let pxPos = 236; pxPos <= 295; pxPos += 14) {
    rect(ctx, pxPos, 115, 3, 15, "#4A3626");
    vline(ctx, pxPos + 1, 115, 15, "#785A41");
  }
  rect(ctx, 236, 118, 62, 2, "#87664B");
  hline(ctx, 236, 120, 62, "#38281C");
  rect(ctx, 236, 124, 62, 2, "#785A41");
  hline(ctx, 236, 126, 62, "#38281C");

  // --- HOTSPOT 4: HS_LATERAL_TRIAGEM [314, 78, 66, 52] ---
  // Ground shadow
  pixelEllipse(ctx, 347, 129, 32, 4, "#755C44");
  // Peaked white medical triage tent canvas
  fillPixelPolygon(
    ctx,
    [
      [347, 78],
      [379, 94],
      [378, 128],
      [315, 128],
      [316, 94],
    ],
    "#DED9CC"
  );
  // Bright sunlit left roof slope
  fillPixelPolygon(
    ctx,
    [
      [347, 78],
      [347, 95],
      [316, 95],
    ],
    "#F5F2E9"
  );
  // Slightly shaded right roof slope
  fillPixelPolygon(
    ctx,
    [
      [347, 78],
      [379, 95],
      [347, 95],
    ],
    "#CFC9BA"
  );
  // Crisp roof ridge overhang & vertical tent seams
  hline(ctx, 315, 95, 64, "#9E988B");
  hline(ctx, 315, 94, 64, "#FAF8F0");
  vline(ctx, 315, 94, 34, "#635E54");
  vline(ctx, 378, 94, 34, "#635E54");
  pixelLine(ctx, 347, 78, 315, 94, "#635E54");
  pixelLine(ctx, 347, 78, 379, 94, "#635E54");
  // Guy-ropes anchoring tent corners
  pixelLine(ctx, 315, 95, 310, 126, "#857C6B");
  pixelLine(ctx, 379, 95, 384, 126, "#857C6B");
  // Shadowed tent entrance opening on left-center
  fillPixelPolygon(
    ctx,
    [
      [324, 96],
      [342, 96],
      [346, 128],
      [321, 128],
    ],
    "#2E2B27"
  );
  // Folded-back doorway flap edges
  pixelLine(ctx, 324, 96, 321, 128, "#F2EFE6");
  pixelLine(ctx, 342, 96, 346, 128, "#B8B2A4");
  // Red medical cross emblem on right panel (x: 353..369, y: 102..118)
  rect(ctx, 358, 102, 6, 16, "#9E3B33");
  rect(ctx, 353, 107, 16, 6, "#9E3B33");
  rect(ctx, 359, 103, 4, 14, "#C44D43");
  rect(ctx, 354, 108, 14, 4, "#C44D43");
  // Discarded white medical triage papers scattered along lower right edge
  rect(ctx, 355, 125, 6, 4, "#F7F5EE");
  hline(ctx, 356, 126, 4, "#8A8478");
  rect(ctx, 364, 124, 7, 5, "#FFFFFF");
  hline(ctx, 365, 126, 4, "#9E3B33");
  rect(ctx, 373, 126, 5, 3, "#EDE9DC");

  // --- HOTSPOT 5: HS_FACHADA_GALPAO [392, 46, 82, 86] ---
  // Ground shadow extending from imposing barn
  rect(ctx, 388, 128, 92, 7, "#6E563F");
  // Weathered dark barn-red vertical planks (x: 394..476, y: 72..132)
  drawWoodPlanksVertical(
    ctx,
    394,
    72,
    82,
    60,
    7,
    {
      seam: "#2B1412",
      dark: "#59241F",
      mid: "#732F28",
      light: "#8C3B32",
    },
    609
  );
  // Steep gabled barn roof (y: 46..74)
  fillPixelPolygon(
    ctx,
    [
      [435, 46],
      [478, 72],
      [391, 72],
    ],
    "#3B2E28"
  );
  // Corrugated dark metal roof ridges
  for (let rx = 398; rx <= 472; rx += 6) {
    const roofTopY = 46 + Math.floor((Math.abs(rx - 435) / 44) * 26);
    vline(ctx, rx, roofTopY, 72 - roofTopY, "#241B17");
    vline(ctx, rx + 1, roofTopY + 1, Math.max(1, 71 - roofTopY), "#54443C");
  }
  // White/cream weathered gable fascia trim
  pixelLine(ctx, 435, 46, 391, 72, "#C4B69C");
  pixelLine(ctx, 435, 46, 478, 72, "#9E917A");
  // Upper hayloft louvered vent window
  rect(ctx, 428, 56, 14, 11, "#241A16");
  outlineRect(ctx, 428, 56, 14, 11, "#8A7B64");
  for (let vy = 58; vy <= 65; vy += 2) {
    hline(ctx, 430, vy, 10, "#4F4036");
  }
  // Heavy double sliding barn doors (x: 404..464, y: 80..131)
  // Left doorway shadowed recessed batente where Jaden stands ([404, 82, 26, 52])
  rect(ctx, 404, 80, 60, 52, "#1F1512");
  // Left door leaf slightly ajar / dark framing behind Jaden
  rect(ctx, 406, 82, 27, 49, "#421C18");
  outlineRect(ctx, 406, 82, 27, 49, "#24100E");
  // Right door leaf with bold timber X-brace
  rect(ctx, 435, 82, 27, 49, "#5E2620");
  outlineRect(ctx, 435, 82, 27, 49, "#24100E");
  pixelLine(ctx, 437, 84, 460, 128, "#8C4238");
  pixelLine(ctx, 460, 84, 437, 128, "#8C4238");
  pixelLine(ctx, 408, 84, 431, 128, "#6E2E27");
  // Heavy iron overhead sliding door track
  rect(ctx, 396, 78, 76, 3, "#262322");
  hline(ctx, 396, 78, 76, "#5C5652");
  // Heavy padlock & iron bar across center seam
  rect(ctx, 430, 105, 9, 4, "#242120");
  rect(ctx, 433, 107, 4, 5, "#8C7038");
}

function drawWatchtower(ctx: CanvasRenderingContext2D, cx: number, groundY: number): void {
  // Stilted diagonal legs
  pixelLine(ctx, cx - 7, groundY, cx - 5, groundY - 26, "#4A3829");
  pixelLine(ctx, cx + 7, groundY, cx + 5, groundY - 26, "#4A3829");
  // Cross bracing
  pixelLine(ctx, cx - 6, groundY - 4, cx + 6, groundY - 18, "#3B2D21");
  pixelLine(ctx, cx + 6, groundY - 4, cx - 6, groundY - 18, "#3B2D21");
  // Lookout cab platform
  rect(ctx, cx - 8, groundY - 34, 16, 9, "#5E4735");
  outlineRect(ctx, cx - 8, groundY - 34, 16, 9, "#2E2219");
  // Dark shadowed lookout opening
  rect(ctx, cx - 6, groundY - 32, 12, 4, "#241B15");
  // Sloped tower roof
  fillPixelPolygon(
    ctx,
    [
      [cx, groundY - 41],
      [cx + 11, groundY - 34],
      [cx - 11, groundY - 34],
    ],
    "#3B2B20"
  );
}

// ---------- Conditional Props (Exact Hotspot Bounds, Transparent BG) ----------

function paintPropMochilaVelha(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  // Ground shadow
  pixelEllipse(ctx, 17, 20, 14, 3, "rgba(20, 16, 12, 0.55)");
  // Main worn olive-khaki survival backpack (34x24)
  rect(ctx, 6, 6, 22, 14, "#6B6349");
  outlineRect(ctx, 6, 6, 22, 14, "#241E17");
  // Rounded slouchy top lid flap
  rect(ctx, 7, 3, 20, 7, "#857B5C");
  outlineRect(ctx, 7, 3, 20, 7, "#2B241B");
  hline(ctx, 9, 4, 16, "#A69B77");
  // Side pocket & metal canteen cap peeking out
  rect(ctx, 2, 9, 5, 9, "#57503B");
  outlineRect(ctx, 2, 9, 5, 9, "#241E17");
  rect(ctx, 3, 7, 3, 2, "#9EA6A8");
  rect(ctx, 27, 10, 5, 8, "#57503B");
  outlineRect(ctx, 27, 10, 5, 8, "#241E17");
  // Twin warm leather straps & gleaming brass buckles
  rect(ctx, 10, 4, 3, 14, "#5E3D24");
  rect(ctx, 21, 4, 3, 14, "#5E3D24");
  vline(ctx, 11, 5, 12, "#855938");
  vline(ctx, 22, 5, 12, "#855938");
  rect(ctx, 10, 11, 3, 3, "#E0BC53");
  px(ctx, 11, 12, "#5E3D24");
  rect(ctx, 21, 11, 3, 3, "#E0BC53");
  px(ctx, 22, 12, "#5E3D24");
  // Front stitched compass pocket
  rect(ctx, 14, 12, 6, 6, "#7A7053");
  hline(ctx, 14, 12, 6, "#3D3729");
}

function paintPropColdreMesa(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  // Subtle tabletop shadow (24x16)
  pixelEllipse(ctx, 12, 13, 10, 2, "rgba(24, 18, 12, 0.5)");
  // Gleaming chrome-silver pistol grip & slide protruding upper-left
  fillPixelPolygon(
    ctx,
    [
      [3, 5],
      [13, 3],
      [15, 7],
      [5, 9],
    ],
    "#B8C4CC"
  );
  pixelLine(ctx, 4, 5, 12, 3, "#FFFFFF");
  pixelLine(ctx, 5, 6, 13, 4, "#E6F0F5");
  // Dark pistol grip butt
  rect(ctx, 3, 7, 4, 5, "#2B2624");
  px(ctx, 4, 8, "#544C47");
  // Rich stitched leather belt holster sheathing barrel (right)
  fillPixelPolygon(
    ctx,
    [
      [9, 5],
      [21, 7],
      [20, 13],
      [8, 12],
    ],
    "#6B4226"
  );
  pixelLine(ctx, 9, 5, 21, 7, "#96633E");
  pixelLine(ctx, 8, 12, 20, 13, "#2E1B0F");
  // Retaining strap & gleaming brass snap stud
  rect(ctx, 10, 6, 3, 6, "#4D2E1A");
  rect(ctx, 11, 8, 2, 2, "#E8C358");
}

function paintPropBandejaSeringa(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  // Floor shadow under rolling medical cart (32x26)
  pixelEllipse(ctx, 16, 24, 13, 2, "rgba(38, 28, 20, 0.45)");
  // Slender stainless steel cart legs & push handle
  vline(ctx, 4, 5, 18, "#6E7B85");
  vline(ctx, 5, 5, 18, "#C7D3DB");
  vline(ctx, 26, 7, 16, "#6E7B85");
  vline(ctx, 27, 7, 16, "#C7D3DB");
  hline(ctx, 2, 5, 4, "#DCE6EC");
  // Caster wheels
  rect(ctx, 3, 22, 3, 3, "#242629");
  px(ctx, 4, 23, "#78828A");
  rect(ctx, 25, 22, 3, 3, "#242629");
  px(ctx, 26, 23, "#78828A");
  // Lower shelf
  rect(ctx, 4, 17, 24, 3, "#8A98A3");
  hline(ctx, 4, 17, 24, "#DCE6EC");
  hline(ctx, 4, 19, 24, "#4A545C");
  // Upper stainless tray shelf
  rect(ctx, 4, 9, 25, 3, "#9BA9B3");
  hline(ctx, 4, 9, 25, "#F2F7FA");
  hline(ctx, 4, 11, 25, "#4A545C");
  // White linen cloth & breakfast mug on left
  rect(ctx, 7, 8, 9, 2, "#FAF6EB");
  rect(ctx, 8, 4, 5, 5, "#D9C9AE");
  outlineRect(ctx, 8, 4, 5, 5, "#6E5D48");
  px(ctx, 13, 5, "#D9C9AE");
  // Unsettling amber medical vial & glinting glass syringe on right
  rect(ctx, 17, 5, 3, 4, "#D99E32");
  hline(ctx, 17, 4, 3, "#DCE6EC");
  // Glass syringe lying horizontally on tray
  hline(ctx, 21, 7, 6, "#DCE6EC");
  hline(ctx, 22, 6, 4, "#FFFFFF");
  px(ctx, 21, 6, "#A6C8D9");
  hline(ctx, 27, 7, 3, "#8A98A3"); // fine steel needle
  vline(ctx, 20, 6, 3, "#6E7B85"); // plunger end
}

function paintPropJanelaSuperior(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  // Parted curtain & Dilan's dark shadowy silhouette watching from 2nd-floor window (30x26)
  // Dark interior contrast inside panes (x: 3..26, y: 3..21)
  rect(ctx, 4, 4, 22, 17, "rgba(18, 14, 12, 0.72)");
  // Pulled-back pale curtain edge on left
  fillPixelPolygon(
    ctx,
    [
      [3, 3],
      [10, 3],
      [7, 13],
      [9, 21],
      [3, 21],
    ],
    "#CFC5AE"
  );
  // Dilan's shadowy head & shoulders silhouette peering through right-center panes
  pixelEllipse(ctx, 17, 11, 4, 5, "#171311");
  fillPixelPolygon(
    ctx,
    [
      [10, 21],
      [12, 15],
      [22, 15],
      [25, 21],
    ],
    "#171311"
  );
  // Faint pale rim light on shoulder/cheek
  px(ctx, 14, 10, "#4A4038");
  px(ctx, 20, 10, "#4A4038");
  // Two eerie bright pale watching eyes glinting in the dark glass!
  rect(ctx, 15, 10, 2, 1, "#F5EBD0");
  rect(ctx, 18, 10, 2, 1, "#F5EBD0");
  px(ctx, 16, 10, "#FFFFFF");
  px(ctx, 19, 10, "#FFFFFF");
  // Re-draw crisp window muntin bars cleanly over the silhouette so he is BEHIND the glass
  rect(ctx, 14, 3, 2, 19, "#B8A688");
  rect(ctx, 3, 12, 24, 2, "#B8A688");
  // Subtle diagonal glass specular reflection
  pixelLine(ctx, 17, 5, 21, 9, "rgba(255, 250, 232, 0.35)");
}

const CONDITIONAL_PROPS: Record<string, ConditionalPropDef> = {
  HS_MOCHILA_VELHA: {
    width: 34,
    height: 24,
    roomId: "R01_BARRACA",
    painter: paintPropMochilaVelha,
  },
  HS_COLDRE_MESA: {
    width: 24,
    height: 16,
    roomId: "R03_CABANA",
    painter: paintPropColdreMesa,
  },
  HS_BANDEJA_SERINGA: {
    width: 32,
    height: 26,
    roomId: "R04_QUARTO",
    painter: paintPropBandejaSeringa,
  },
  HS_JANELA_SUPERIOR: {
    width: 30,
    height: 26,
    roomId: "R06_PATIO",
    painter: paintPropJanelaSuperior,
  },
};

function ensureConditionalPropTexture(scene: Phaser.Scene, hotspotId: string): void {
  const def = CONDITIONAL_PROPS[hotspotId];
  if (!def) return;
  const key = `${CONDITIONAL_PROP_PREFIX}${hotspotId}`;
  if (scene.textures.exists(key)) return;

  const canvasTex = scene.textures.createCanvas(key, def.width, def.height);
  if (!canvasTex) return;

  const ctx = canvasTex.context;
  ctx.imageSmoothingEnabled = false;
  def.painter(ctx, def.width, def.height);
  canvasTex.refresh();
  canvasTex.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

function ensureAllConditionalPropTextures(scene: Phaser.Scene): void {
  for (const hotspotId of Object.keys(CONDITIONAL_PROPS)) {
    ensureConditionalPropTexture(scene, hotspotId);
  }
}

// ---------- Public API Exports ----------

export function getProceduralRoomTextureKey(roomId: RoomId): string {
  return `${ROOM_ART_TEXTURE_PREFIX}${roomId}`;
}

export function getConditionalPropTextureKey(hotspotId: string): string | null {
  if (Object.prototype.hasOwnProperty.call(CONDITIONAL_PROPS, hotspotId)) {
    return `${CONDITIONAL_PROP_PREFIX}${hotspotId}`;
  }
  return null;
}

export function generateRoomTexture(scene: Phaser.Scene, room: RoomSpec): string {
  const key = getProceduralRoomTextureKey(room.id);
  ensureAllConditionalPropTextures(scene);

  if (scene.textures.exists(key)) {
    return key;
  }

  const width = room.world_size.width;
  const height = room.world_size.height;
  const canvasTex = scene.textures.createCanvas(key, width, height);
  if (!canvasTex) {
    return key;
  }

  const ctx = canvasTex.context;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  switch (room.id) {
    case "R01_BARRACA":
      paintRoomR01Barraca(ctx, width, height);
      break;
    case "R02_FLORES":
      paintRoomR02Flores(ctx, width, height);
      break;
    case "R03_CABANA":
      paintRoomR03Cabana(ctx, width, height);
      break;
    case "R04_QUARTO":
      paintRoomR04Quarto(ctx, width, height);
      break;
    case "R05_CORREDOR":
      paintRoomR05Corredor(ctx, width, height);
      break;
    case "R06_PATIO":
      paintRoomR06Patio(ctx, width, height);
      break;
  }

  canvasTex.refresh();
  canvasTex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return key;
}

export function generateAllRoomTextures(scene: Phaser.Scene, rooms: RoomSpec[]): void {
  ensureAllConditionalPropTextures(scene);
  for (const room of rooms) {
    generateRoomTexture(scene, room);
  }
}

// ---------- Dynamic Room Ambient Decor ----------

export function createRoomDynamicDecor(
  scene: Phaser.Scene,
  room: RoomSpec
): Phaser.GameObjects.GameObject[] {
  const objects: Phaser.GameObjects.GameObject[] = [];

  if (room.id === "R01_BARRACA") {
    // Gleaming specular pulse on broken mirror shard at HS_VIDRO_QUEBRADO [64, 108, 28, 22]
    const glintV = scene.add.rectangle(77, 116, 1, 5, 0xffffff, 0.85);
    const glintH = scene.add.rectangle(77, 116, 5, 1, 0xffffff, 0.85);
    const glintCore = scene.add.rectangle(77, 116, 2, 2, 0xf2fbff, 0.9);
    objects.push(glintV, glintH, glintCore);

    const glintTween = scene.tweens.add({
      targets: [glintV, glintH, glintCore],
      alpha: { from: 0.12, to: 0.95 },
      duration: 1350,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    bindTweenLifecycle(glintCore, glintTween);

    // Floating warm dust specks drifting down the tent sunbeams
    const moteCoords: ReadonlyArray<[number, number, number]> = [
      [142, 46, 2600],
      [152, 68, 3100],
      [164, 88, 2800],
      [172, 108, 3400],
      [182, 126, 2900],
    ];
    for (const [mx, my, dur] of moteCoords) {
      const mote = scene.add.rectangle(mx, my, 1, 1, 0xf2ebd4, 0.55);
      objects.push(mote);
      const t = scene.tweens.add({
        targets: mote,
        x: mx + 10,
        y: my + 14,
        alpha: { from: 0.15, to: 0.65 },
        duration: dur,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      bindTweenLifecycle(mote, t);
    }
  } else if (room.id === "R02_FLORES") {
    // Gentle swaying vivid white & purple wildflower heads over HS_FLORES_VALE [168, 122, 46, 26]
    const swayBlooms: ReadonlyArray<{
      x: number;
      y: number;
      color: number;
      center: number;
      amp: number;
      dur: number;
    }> = [
      { x: 175, y: 129, color: 0xffffff, center: 0xe8c958, amp: 1.5, dur: 1450 },
      { x: 183, y: 126, color: 0xb478cc, center: 0xf2e3fa, amp: 2.0, dur: 1650 },
      { x: 190, y: 128, color: 0xf5f4ee, center: 0xe8c958, amp: 1.5, dur: 1500 },
      { x: 196, y: 125, color: 0x9b5cb5, center: 0xf2e3fa, amp: 2.0, dur: 1720 },
      { x: 204, y: 129, color: 0xffffff, center: 0xe8c958, amp: 1.5, dur: 1580 },
      { x: 210, y: 132, color: 0xa86cc2, center: 0xf2e3fa, amp: 1.2, dur: 1400 },
    ];

    for (const b of swayBlooms) {
      const container = scene.add.container(b.x, b.y);
      const stem = scene.add.rectangle(0, 3, 1, 5, 0x5ea14f, 0.9);
      const petals = scene.add.rectangle(0, 0, 3, 3, b.color, 1);
      const core = scene.add.rectangle(0, 0, 1, 1, b.center, 1);
      container.add([stem, petals, core]);
      objects.push(container);

      const swayTween = scene.tweens.add({
        targets: container,
        x: { from: b.x - b.amp, to: b.x + b.amp },
        duration: b.dur,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      bindTweenLifecycle(container, swayTween);
    }

    // Subtle uncanny pollen specks rising gently above the flower cluster
    for (let i = 0; i < 4; i++) {
      const pxPos = 176 + i * 10;
      const pyPos = 126 + (i % 2) * 4;
      const pollen = scene.add.rectangle(pxPos, pyPos, 1, 1, 0xe8d9f5, 0.5);
      objects.push(pollen);
      const pTween = scene.tweens.add({
        targets: pollen,
        x: pxPos + 6,
        y: pyPos - 7,
        alpha: { from: 0.1, to: 0.65 },
        duration: 2100 + i * 320,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      bindTweenLifecycle(pollen, pTween);
    }
  } else if (room.id === "R03_CABANA") {
    // Blinking red/amber Geiger counter LED on HS_CONTADOR_GEIGER [140, 104, 22, 16]
    const ledHalo = scene.add.rectangle(157, 110, 4, 4, 0xff5a36, 0.35);
    const ledCore = scene.add.rectangle(157, 110, 2, 2, 0xff3b2f, 1);
    objects.push(ledHalo, ledCore);

    const ledTween = scene.tweens.add({
      targets: [ledHalo, ledCore],
      alpha: { from: 0.08, to: 1 },
      duration: 580,
      hold: 160,
      repeatDelay: 380,
      yoyo: true,
      repeat: -1,
      ease: "Stepped",
    });
    bindTweenLifecycle(ledCore, ledTween);

    // Subtle late-afternoon golden dust motes near cabin window shaft
    const motes: ReadonlyArray<[number, number]> = [
      [212, 48],
      [226, 62],
      [218, 86],
      [232, 108],
    ];
    for (let i = 0; i < motes.length; i++) {
      const [mx, my] = motes[i];
      const dot = scene.add.rectangle(mx, my, 1, 1, 0xf5df8c, 0.45);
      objects.push(dot);
      const t = scene.tweens.add({
        targets: dot,
        x: mx - 8,
        y: my + 9,
        alpha: { from: 0.12, to: 0.58 },
        duration: 2700 + i * 350,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      bindTweenLifecycle(dot, t);
    }
  } else if (room.id === "R04_QUARTO") {
    // Gentle morning sunlight dust motes floating beneath HS_JANELA_QUARTO [126, 36, 56, 48]
    const motes: ReadonlyArray<[number, number]> = [
      [136, 66],
      [152, 82],
      [168, 72],
      [146, 104],
      [162, 118],
    ];
    for (let i = 0; i < motes.length; i++) {
      const [mx, my] = motes[i];
      const dot = scene.add.rectangle(mx, my, 1, 1, 0xfff6dc, 0.55);
      objects.push(dot);
      const t = scene.tweens.add({
        targets: dot,
        x: mx + (i % 2 === 0 ? 5 : -5),
        y: my + 8,
        alpha: { from: 0.15, to: 0.65 },
        duration: 2800 + i * 280,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      bindTweenLifecycle(dot, t);
    }
  } else if (room.id === "R05_CORREDOR") {
    // Soft flickering amber glow on the two hallway wall sconces (x: 131 & 188, y: 62)
    for (const sx of [131, 188]) {
      const glow = scene.add.circle(sx, 62, 5, 0xe8b948, 0.14);
      const flame = scene.add.rectangle(sx, 62, 1, 2, 0xfff0b8, 0.85);
      objects.push(glow, flame);
      const glowTween = scene.tweens.add({
        targets: glow,
        alpha: { from: 0.08, to: 0.24 },
        duration: 920 + (sx % 11) * 35,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      const flameTween = scene.tweens.add({
        targets: flame,
        alpha: { from: 0.65, to: 1 },
        duration: 640 + (sx % 7) * 40,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      bindTweenLifecycle(glow, glowTween);
      bindTweenLifecycle(flame, flameTween);
    }

    // Subtle pulsing shimmer along the bright sunlight slit under HS_PORTA_PRINCIPAL
    const slitGlow = scene.add
      .rectangle(161, 129, 38, 2, 0xfffbe8, 0.65)
      .setOrigin(0.5, 0.5);
    objects.push(slitGlow);
    const sTween = scene.tweens.add({
      targets: slitGlow,
      alpha: { from: 0.4, to: 0.85 },
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    bindTweenLifecycle(slitGlow, sTween);
  } else if (room.id === "R06_PATIO") {
    // Gentle warm sunlight heat flecks drifting across the 480px farm courtyard
    const flecks: ReadonlyArray<[number, number]> = [
      [112, 108],
      [174, 114],
      [256, 104],
      [338, 112],
      [412, 106],
    ];
    for (let i = 0; i < flecks.length; i++) {
      const [fx, fy] = flecks[i];
      const speck = scene.add.rectangle(fx, fy, 1, 1, 0xfff7dc, 0.45);
      objects.push(speck);
      const fTween = scene.tweens.add({
        targets: speck,
        x: fx + 12,
        y: fy - 5,
        alpha: { from: 0.1, to: 0.55 },
        duration: 2400 + i * 310,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      bindTweenLifecycle(speck, fTween);
    }

    // Subtle fluttering white paper corner near triage tent (HS_LATERAL_TRIAGEM)
    const paperCorner = scene.add.rectangle(368, 125, 2, 1, 0xffffff, 0.9);
    objects.push(paperCorner);
    const pTween = scene.tweens.add({
      targets: paperCorner,
      y: { from: 124, to: 126 },
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    bindTweenLifecycle(paperCorner, pTween);
  }

  return objects;
}
