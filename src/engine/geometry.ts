import type { RoomSpec } from "../types";

export interface Point2D {
  x: number;
  y: number;
}

export function clamp(val: number, min: number, max: number): number {
  if (val < min) return min;
  if (val > max) return max;
  return val;
}

/**
 * Exact depth scale formula mandated by AGENTS.md:
 * scale(y) = scale_min + ((clamp(y, y_min, y_max) - y_min) / (y_max - y_min)) * (scale_max - scale_min)
 */
export function computeDepthScale(y: number, depthSpec: RoomSpec["depth_scale"]): number {
  const { y_min, y_max, scale_min, scale_max } = depthSpec;
  const span = y_max - y_min;
  if (span <= 0) return scale_min;
  const clampedY = clamp(y, y_min, y_max);
  return scale_min + ((clampedY - y_min) / span) * (scale_max - scale_min);
}

/**
 * Ray-casting point-in-polygon check.
 */
export function isPointInPolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): Point2D {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 0.0001) return { x: ax, y: ay };
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / lenSq, 0, 1);
  return { x: ax + t * abx, y: ay + t * aby };
}

/**
 * Ensures any walk target remains inside or on the boundary of walkable_polygon.
 */
export function clampPointToPolygon(
  x: number,
  y: number,
  polygon: Array<[number, number]>
): Point2D {
  if (polygon.length < 3 || isPointInPolygon(x, y, polygon)) {
    return { x, y };
  }

  let best: Point2D = { x: polygon[0][0], y: polygon[0][1] };
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const candidate = closestPointOnSegment(x, y, a[0], a[1], b[0], b[1]);
    const dx = candidate.x - x;
    const dy = candidate.y - y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = candidate;
    }
  }

  return best;
}

export function hexToNumber(hex: string, fallback = 0x222222): number {
  const cleaned = hex.replace(/^#/, "");
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isNaN(parsed) ? fallback : parsed;
}
