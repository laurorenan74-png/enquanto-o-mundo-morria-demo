import Phaser from "phaser";
import type { EntitiesDataFile, EntityId, EntitySpec } from "../types";

export type FacingDir = "down" | "up" | "left" | "right";
export type PortraitMood = "default" | "cold" | "warm";

export interface CharacterArtRegistry {
  getTerezaTextureKey(act: "ACT_1" | "ACT_2", facing: FacingDir, frame: 0 | 1 | 2 | 3): string;
  getNpcTextureKey(entityId: Exclude<EntityId, "SFX">, act: "ACT_1" | "ACT_2"): string | null;
  resolveHotspotNpcEntity(hotspotId: string): Exclude<EntityId, "SFX"> | null;
  getPortraitUrl(entityId: EntityId, mood?: PortraitMood): string | null;
}

const SPRITE_W = 16;
const SPRITE_H = 28;
const PORTRAIT_SRC = 32;
const PORTRAIT_OUT = 64;

const WARM_OUTLINE = "#1f1613";
const SHADOW_GROUND = "rgba(18, 12, 10, 0.34)";
const SHADOW_SHADE = "rgba(14, 18, 22, 0.44)";

const FACINGS: readonly FacingDir[] = ["down", "up", "left", "right"];
const FRAMES: readonly (0 | 1 | 2 | 3)[] = [0, 1, 2, 3];
const ACTS: readonly ("ACT_1" | "ACT_2")[] = ["ACT_1", "ACT_2"];

const ALL_NPC_IDS: readonly Exclude<EntityId, "SFX">[] = [
  "TEREZA",
  "DILAN",
  "ODELIA",
  "JADEN",
  "AMARINA",
  "MARK",
  "ROMENO",
  "CALEB",
  "JOSEPH",
];

const ALL_PORTRAIT_IDS: readonly EntityId[] = [...ALL_NPC_IDS, "SFX"];

interface BraceletStyle {
  main: string;
  light: string;
  shadow: string;
}

const BRACELET_YELLOW: BraceletStyle = {
  main: "#e8b948",
  light: "#ffe27d",
  shadow: "#b38320",
};

const BRACELET_GREEN: BraceletStyle = {
  main: "#4ca657",
  light: "#7de089",
  shadow: "#2d6e35",
};

const BRACELET_OLIVE: BraceletStyle = {
  main: "#9ca842",
  light: "#c8d468",
  shadow: "#666e26",
};

class PixelCanvas {
  private readonly ctx: CanvasRenderingContext2D;
  public readonly width: number;
  public readonly height: number;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.ctx.imageSmoothingEnabled = false;
  }

  public clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  public px(x: number, y: number, color: string): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(ix, iy, 1, 1);
  }

  public rect(x: number, y: number, w: number, h: number, color: string): void {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
  }

  public hline(x: number, y: number, len: number, color: string): void {
    this.rect(x, y, len, 1, color);
  }

  public vline(x: number, y: number, len: number, color: string): void {
    this.rect(x, y, 1, len, color);
  }

  public ellipse(cx: number, cy: number, rx: number, ry: number, color: string): void {
    this.ctx.fillStyle = color;
    const minX = Math.max(0, Math.floor(cx - rx));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + rx));
    const minY = Math.max(0, Math.floor(cy - ry));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + ry));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          this.ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  public mirrorHorizontal(): void {
    if (typeof document === "undefined") return;
    const temp = document.createElement("canvas");
    temp.width = this.width;
    temp.height = this.height;
    const tctx = temp.getContext("2d");
    if (!tctx) return;
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(this.ctx.canvas, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.save();
    this.ctx.translate(this.width, 0);
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(temp, 0, 0);
    this.ctx.restore();
  }
}

function resolveBraceletStyle(
  spec: EntitySpec | undefined,
  act: "ACT_1" | "ACT_2"
): BraceletStyle | null {
  if (!spec) return null;
  const raw =
    typeof spec.visual_spec.bracelet === "string"
      ? spec.visual_spec.bracelet
      : act === "ACT_1"
        ? spec.visual_spec.bracelet.act_1
        : spec.visual_spec.bracelet.act_2;
  const lower = raw.toLowerCase();
  if (lower === "none" || lower === "") return null;
  if (lower.includes("yellow_or_green")) return BRACELET_OLIVE;
  if (lower.includes("yellow")) return BRACELET_YELLOW;
  if (lower.includes("green")) return BRACELET_GREEN;
  return null;
}

function createSpriteTexture(
  scene: Phaser.Scene,
  key: string,
  drawFn: (p: PixelCanvas) => void
): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, SPRITE_W, SPRITE_H);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const p = new PixelCanvas(ctx, SPRITE_W, SPRITE_H);
  p.clear();
  drawFn(p);
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

// ============================================================================
// TEREZA SPRITES (16x28, 4 directions x 4 frames x 2 acts)
// ============================================================================

interface TerezaPalette {
  outline: string;
  hairDark: string;
  hairMid: string;
  hairLight: string;
  skinShadow: string;
  skinMid: string;
  skinLight: string;
  blush: string;
  eyeDark: string;
  eyeBlue: string;
  topDark: string;
  topMid: string;
  topLight: string;
  innerShirt: string;
  accentTrim: string;
  pantsDark: string;
  pantsMid: string;
  pantsLight: string;
  bootDark: string;
  bootMid: string;
  dustAccent: string | null;
}

function getTerezaPalette(act: "ACT_1" | "ACT_2"): TerezaPalette {
  if (act === "ACT_1") {
    return {
      outline: WARM_OUTLINE,
      hairDark: "#2a1a14",
      hairMid: "#472d22",
      hairLight: "#694636",
      skinShadow: "#c49272",
      skinMid: "#e0b08f",
      skinLight: "#f2ccb2",
      blush: "#d69482",
      eyeDark: "#1c4b78",
      eyeBlue: "#42a4f5",
      topDark: "#3b3830",
      topMid: "#5b5548",
      topLight: "#78705f",
      innerShirt: "#2c2825",
      accentTrim: "#4a4439",
      pantsDark: "#232120",
      pantsMid: "#383533",
      pantsLight: "#4f4a45",
      bootDark: "#2b1f18",
      bootMid: "#473428",
      dustAccent: "#8a7f6c",
    };
  }
  return {
    outline: WARM_OUTLINE,
    hairDark: "#2a1a14",
    hairMid: "#472d22",
    hairLight: "#6e4a39",
    skinShadow: "#c79778",
    skinMid: "#e3b596",
    skinLight: "#f5d3ba",
    blush: "#db9b8b",
    eyeDark: "#1c4b78",
    eyeBlue: "#45a9fa",
    topDark: "#b3a590",
    topMid: "#dcd2bf",
    topLight: "#f2ece0",
    innerShirt: "#cbbda6",
    accentTrim: "#8f7e69",
    pantsDark: "#2d3740",
    pantsMid: "#445360",
    pantsLight: "#5c6f80",
    bootDark: "#382419",
    bootMid: "#593b2a",
    dustAccent: null,
  };
}

function drawTerezaDown(
  p: PixelCanvas,
  act: "ACT_1" | "ACT_2",
  frame: 0 | 1 | 2 | 3,
  bracelet: BraceletStyle | null
): void {
  const c = getTerezaPalette(act);
  const bob = frame === 1 || frame === 3 ? -1 : 0;
  const leftStep = frame === 1;
  const rightStep = frame === 3;

  // Ground shadow
  p.ellipse(8, 26, 4.4, 1.4, SHADOW_GROUND);

  // Legs & boots (y: 19..26)
  const lFootY = leftStep ? 24 : rightStep ? 23 : 24;
  const rFootY = rightStep ? 24 : leftStep ? 23 : 24;

  // Trousers hips
  p.hline(5, 19 + bob, 6, c.pantsDark);
  p.hline(6, 19 + bob, 4, c.pantsMid);
  p.px(4, 19 + bob, c.outline);
  p.px(11, 19 + bob, c.outline);

  // Left leg (x: 5..7)
  p.rect(5, 20, 2, lFootY - 20, c.pantsMid);
  p.vline(5, 20, lFootY - 20, c.pantsDark);
  p.vline(4, 20, lFootY - 19, c.outline);
  p.vline(7, 20, 3, c.outline);
  // Left boot
  p.rect(5, lFootY, 2, 2, c.bootMid);
  p.px(5, lFootY, c.bootDark);
  p.hline(5, lFootY + 2, 2, c.outline);
  p.vline(7, lFootY, 2, c.outline);

  // Right leg (x: 8..10)
  p.rect(9, 20, 2, rFootY - 20, c.pantsMid);
  p.vline(10, 20, rFootY - 20, c.pantsLight);
  p.vline(11, 20, rFootY - 19, c.outline);
  p.vline(8, 20, 3, c.outline);
  // Right boot
  p.rect(9, rFootY, 2, 2, c.bootMid);
  p.px(10, rFootY, c.bootDark);
  p.hline(9, rFootY + 2, 2, c.outline);
  p.vline(8, rFootY, 2, c.outline);

  if (c.dustAccent) {
    p.px(6, 22, c.dustAccent);
    p.px(9, 23, c.dustAccent);
  }

  // ACT_2 yellow ankle bracelet on right ankle
  if (bracelet) {
    p.px(9, rFootY - 1, bracelet.main);
    p.px(10, rFootY - 1, bracelet.light);
    p.px(8, rFootY - 1, bracelet.shadow);
  }

  // Torso (y: 12..19 + bob)
  const ty = 12 + bob;
  p.rect(5, ty + 1, 6, 6, c.topMid);
  p.vline(5, ty + 1, 6, c.topLight);
  p.vline(10, ty + 1, 6, c.topDark);
  p.hline(5, ty, 6, c.outline);
  if (act === "ACT_1") {
    // Open survival jacket over dark inner tee
    p.rect(7, ty + 1, 2, 5, c.innerShirt);
    p.px(6, ty + 1, c.topLight);
    p.px(9, ty + 1, c.topLight);
    p.hline(5, ty + 6, 6, c.accentTrim);
    if (c.dustAccent) {
      p.px(6, ty + 5, c.dustAccent);
      p.px(10, ty + 4, c.dustAccent);
    }
  } else {
    // Clean rustic blouse with soft collar & waist cinch
    p.hline(6, ty + 1, 4, c.topLight);
    p.px(7, ty + 1, c.skinMid);
    p.px(8, ty + 1, c.skinMid);
    p.px(7, ty + 2, c.topDark);
    p.hline(5, ty + 6, 6, c.accentTrim);
  }

  // Arms swinging subtly
  const lArmY = ty + 1 + (rightStep ? 1 : 0);
  const rArmY = ty + 1 + (leftStep ? 1 : 0);
  // Left arm (x: 3..4)
  p.vline(3, lArmY, 5, c.outline);
  p.vline(4, lArmY, 4, c.topMid);
  p.px(4, lArmY, c.topLight);
  p.px(4, lArmY + 4, c.skinMid);
  p.px(4, lArmY + 5, c.outline);
  // Right arm (x: 11..12)
  p.vline(12, rArmY, 5, c.outline);
  p.vline(11, rArmY, 4, c.topDark);
  p.px(11, rArmY, c.topMid);
  p.px(11, rArmY + 4, c.skinShadow);
  p.px(11, rArmY + 5, c.outline);

  // Head & brunette hair (petite: y = 4..12 + bob)
  const hy = 4 + bob;
  // Top outline
  p.hline(5, hy, 6, c.outline);
  p.px(4, hy + 1, c.outline);
  p.px(11, hy + 1, c.outline);
  p.vline(3, hy + 2, 6, c.outline);
  p.vline(12, hy + 2, 6, c.outline);

  // Hair crown & volume
  p.hline(5, hy + 1, 6, c.hairMid);
  p.hline(6, hy + 1, 3, c.hairLight);
  p.hline(4, hy + 2, 8, c.hairMid);
  p.px(5, hy + 2, c.hairLight);
  p.px(9, hy + 2, c.hairLight);
  p.px(11, hy + 2, c.hairDark);

  // Face interior (x: 5..10, y: hy+3..hy+7)
  p.rect(5, hy + 3, 6, 4, c.skinMid);
  p.hline(6, hy + 3, 4, c.skinLight);
  p.hline(6, hy + 7, 4, c.skinShadow);
  p.hline(6, hy + 8, 4, c.outline);

  // Bangs draping forehead
  p.px(5, hy + 3, c.hairMid);
  p.px(7, hy + 3, c.hairDark);
  p.px(10, hy + 3, c.hairMid);

  // Hair cascading sides past chin
  p.vline(4, hy + 3, 6, c.hairMid);
  p.px(4, hy + 3, c.hairLight);
  p.px(4, hy + 7, c.hairDark);
  p.px(4, hy + 8, c.hairDark);
  p.px(3, hy + 8, c.outline);
  p.px(4, hy + 9, c.outline);

  p.vline(11, hy + 3, 6, c.hairDark);
  p.px(11, hy + 4, c.hairMid);
  p.px(12, hy + 8, c.outline);
  p.px(11, hy + 9, c.outline);

  // Vivid blue eyes (2px tall)
  p.px(6, hy + 4, c.eyeDark);
  p.px(6, hy + 5, c.eyeBlue);
  p.px(9, hy + 4, c.eyeDark);
  p.px(9, hy + 5, c.eyeBlue);

  // Soft cheeks & chin
  p.px(5, hy + 6, c.blush);
  p.px(10, hy + 6, c.blush);
  p.px(7, hy + 7, c.skinMid);
  p.px(8, hy + 7, c.skinMid);
}

function drawTerezaUp(
  p: PixelCanvas,
  act: "ACT_1" | "ACT_2",
  frame: 0 | 1 | 2 | 3,
  bracelet: BraceletStyle | null
): void {
  const c = getTerezaPalette(act);
  const bob = frame === 1 || frame === 3 ? -1 : 0;
  const leftStep = frame === 1;
  const rightStep = frame === 3;

  p.ellipse(8, 26, 4.4, 1.4, SHADOW_GROUND);

  const lFootY = leftStep ? 23 : 24;
  const rFootY = rightStep ? 23 : 24;

  // Legs
  p.hline(5, 19 + bob, 6, c.pantsDark);
  p.px(4, 19 + bob, c.outline);
  p.px(11, 19 + bob, c.outline);

  p.rect(5, 20, 2, lFootY - 20, c.pantsMid);
  p.vline(5, 20, lFootY - 20, c.pantsDark);
  p.vline(4, 20, lFootY - 19, c.outline);
  p.rect(5, lFootY, 2, 2, c.bootDark);
  p.hline(5, lFootY + 2, 2, c.outline);
  p.vline(7, 20, 5, c.outline);

  p.rect(9, 20, 2, rFootY - 20, c.pantsMid);
  p.vline(10, 20, rFootY - 20, c.pantsDark);
  p.vline(11, 20, rFootY - 19, c.outline);
  p.rect(9, rFootY, 2, 2, c.bootDark);
  p.hline(9, rFootY + 2, 2, c.outline);
  p.vline(8, 20, 5, c.outline);

  // Yellow ankle bracelet visible from behind on left-viewer / right-anatomical ankle
  if (bracelet) {
    p.px(9, rFootY - 1, bracelet.main);
    p.px(10, rFootY - 1, bracelet.light);
  }

  // Torso back
  const ty = 12 + bob;
  p.rect(5, ty + 1, 6, 6, c.topMid);
  p.vline(5, ty + 1, 6, c.topDark);
  p.vline(10, ty + 1, 6, c.topDark);
  p.vline(7, ty + 2, 4, c.topLight);
  p.hline(5, ty + 6, 6, c.accentTrim);

  // Arms
  const lArmY = ty + 1 + (leftStep ? 1 : 0);
  const rArmY = ty + 1 + (rightStep ? 1 : 0);
  p.vline(3, lArmY, 5, c.outline);
  p.vline(4, lArmY, 4, c.topDark);
  p.px(4, lArmY + 4, c.skinShadow);
  p.px(4, lArmY + 5, c.outline);

  p.vline(12, rArmY, 5, c.outline);
  p.vline(11, rArmY, 4, c.topDark);
  p.px(11, rArmY + 4, c.skinShadow);
  p.px(11, rArmY + 5, c.outline);

  // Back of head & long brunette hair
  const hy = 4 + bob;
  p.hline(5, hy, 6, c.outline);
  p.px(4, hy + 1, c.outline);
  p.px(11, hy + 1, c.outline);
  p.vline(3, hy + 2, 8, c.outline);
  p.vline(12, hy + 2, 8, c.outline);
  p.rect(4, hy + 2, 8, 8, c.hairMid);
  p.hline(5, hy + 1, 6, c.hairMid);
  p.hline(6, hy + 2, 4, c.hairLight);
  p.hline(5, hy + 3, 2, c.hairLight);
  p.vline(4, hy + 3, 7, c.hairDark);
  p.vline(11, hy + 3, 7, c.hairDark);
  p.hline(5, hy + 8, 6, c.hairDark);
  p.hline(4, hy + 10, 8, c.outline);
  p.px(6, hy + 9, c.hairMid);
  p.px(9, hy + 9, c.hairMid);
}

function drawTerezaLeft(
  p: PixelCanvas,
  act: "ACT_1" | "ACT_2",
  frame: 0 | 1 | 2 | 3,
  bracelet: BraceletStyle | null
): void {
  const c = getTerezaPalette(act);
  const bob = frame === 1 || frame === 3 ? -1 : 0;
  const strideA = frame === 1;
  const strideB = frame === 3;

  p.ellipse(8, 26, 4.2, 1.4, SHADOW_GROUND);

  // Legs in side profile
  if (strideA || strideB) {
    const frontDark = strideB;
    const frontPants = frontDark ? c.pantsDark : c.pantsMid;
    const backPants = frontDark ? c.pantsMid : c.pantsDark;
    // Back leg trailing right
    p.rect(8, 20, 2, 3, backPants);
    p.rect(9, 22, 2, 2, backPants);
    p.rect(10, 24, 2, 2, c.bootDark);
    p.hline(10, 26, 2, c.outline);
    p.px(12, 24, c.outline);
    p.px(12, 25, c.outline);
    // Front leg striding left
    p.rect(6, 20, 2, 3, frontPants);
    p.rect(5, 22, 2, 2, frontPants);
    p.rect(4, 24, 3, 2, c.bootMid);
    p.px(4, 24, c.bootDark);
    p.hline(4, 26, 3, c.outline);
    p.vline(3, 24, 2, c.outline);
    p.vline(7, 23, 3, c.outline);

    if (bracelet) {
      const bx = strideA ? 5 : 9;
      p.px(bx, 23, bracelet.main);
      p.px(bx + 1, 23, bracelet.light);
    }
  } else {
    // Idle profile stance
    p.rect(6, 19 + bob, 4, 5, c.pantsMid);
    p.vline(9, 19 + bob, 5, c.pantsDark);
    p.vline(5, 20, 4, c.outline);
    p.vline(10, 20, 4, c.outline);
    p.rect(5, 24, 5, 2, c.bootMid);
    p.px(5, 24, c.bootDark);
    p.px(9, 24, c.bootDark);
    p.hline(5, 26, 5, c.outline);
    p.vline(4, 24, 2, c.outline);
    p.vline(10, 24, 2, c.outline);
    if (bracelet) {
      p.px(6, 23, bracelet.main);
      p.px(7, 23, bracelet.light);
    }
  }

  // Torso profile
  const ty = 12 + bob;
  p.rect(5, ty + 1, 5, 6, c.topMid);
  p.vline(5, ty + 1, 6, c.topLight);
  p.vline(9, ty + 1, 6, c.topDark);
  p.vline(4, ty + 1, 6, c.outline);
  p.vline(10, ty + 1, 6, c.outline);
  p.hline(5, ty + 6, 5, c.accentTrim);
  if (c.dustAccent) {
    p.px(7, ty + 5, c.dustAccent);
  }

  // Swinging side arm
  const armX = strideA ? 6 : strideB ? 8 : 7;
  p.rect(armX, ty + 2, 2, 4, c.topLight);
  p.vline(armX + 1, ty + 2, 4, c.topDark);
  p.px(armX, ty + 6, c.skinMid);
  p.px(armX + 1, ty + 6, c.outline);

  // Head & brunette hair profile facing left
  const hy = 4 + bob;
  p.hline(5, hy, 5, c.outline);
  p.px(4, hy + 1, c.outline);
  p.px(10, hy + 1, c.outline);
  p.vline(3, hy + 2, 5, c.outline);
  p.vline(11, hy + 2, 8, c.outline);

  // Hair crown & back cascade
  p.hline(5, hy + 1, 5, c.hairMid);
  p.hline(6, hy + 1, 3, c.hairLight);
  p.rect(4, hy + 2, 7, 2, c.hairMid);
  p.px(5, hy + 2, c.hairLight);
  p.rect(8, hy + 4, 3, 6, c.hairMid);
  p.vline(10, hy + 4, 6, c.hairDark);
  p.px(8, hy + 5, c.hairLight);
  p.hline(8, hy + 10, 3, c.outline);

  // Face profile (x: 4..7)
  p.rect(4, hy + 3, 4, 5, c.skinMid);
  p.vline(4, hy + 4, 3, c.skinLight);
  p.px(4, hy + 3, c.hairMid); // bangs
  p.px(7, hy + 3, c.hairMid);
  p.px(7, hy + 4, c.hairDark);
  // Vivid blue eye in profile
  p.px(5, hy + 4, c.eyeDark);
  p.px(5, hy + 5, c.eyeBlue);
  // Cheek blush & chin
  p.px(6, hy + 6, c.blush);
  p.hline(5, hy + 7, 3, c.skinShadow);
  p.hline(4, hy + 8, 4, c.outline);
}

function drawTerezaSprite(
  p: PixelCanvas,
  act: "ACT_1" | "ACT_2",
  facing: FacingDir,
  frame: 0 | 1 | 2 | 3,
  bracelet: BraceletStyle | null
): void {
  if (facing === "down") {
    drawTerezaDown(p, act, frame, bracelet);
  } else if (facing === "up") {
    drawTerezaUp(p, act, frame, bracelet);
  } else if (facing === "left") {
    drawTerezaLeft(p, act, frame, bracelet);
  } else {
    drawTerezaLeft(p, act, frame, bracelet);
    p.mirrorHorizontal();
  }
}

// ============================================================================
// NPC SPRITES (16x28, Stardew Valley style)
// ============================================================================

function drawDilanSprite(
  p: PixelCanvas,
  act: "ACT_1" | "ACT_2",
  bracelet: BraceletStyle | null
): void {
  const o = WARM_OUTLINE;
  const hairDark = "#171417";
  const hairMid = "#2b262c";
  const hairLight = "#403942";
  const skinShadow = "#915f42";
  const skinMid = "#b57c59";
  const skinLight = "#cc9470";
  const scar = "#d9b29a";
  const shirtDark = act === "ACT_1" ? "#1e3754" : "#224061";
  const shirtMid = act === "ACT_1" ? "#2e527a" : "#345e8c";
  const shirtLight = act === "ACT_1" ? "#45709e" : "#4d7eb3";
  const cargoDark = "#383c2d";
  const cargoMid = "#515742";
  const cargoLight = "#676e55";
  const bootDark = "#171618";
  const bootMid = "#2e2d33";
  const tagSilver = "#d4dde6";

  p.ellipse(8, 26, 5.2, 1.5, SHADOW_GROUND);

  // Cargo pants & tactical boots (broad stance, y: 18..26)
  p.hline(4, 18, 8, "#29241e"); // belt
  p.px(7, 18, "#8c7a5b"); // buckle
  p.px(3, 18, o);
  p.px(12, 18, o);

  // Left leg
  p.rect(4, 19, 3, 5, cargoMid);
  p.vline(4, 19, 5, cargoDark);
  p.px(4, 21, cargoLight); // cargo pocket
  p.vline(3, 19, 6, o);
  p.rect(4, 24, 3, 2, bootMid);
  p.px(4, 24, bootDark);
  p.hline(4, 26, 3, o);
  p.vline(7, 20, 6, o);

  // Right leg
  p.rect(9, 19, 3, 5, cargoMid);
  p.vline(11, 19, 5, cargoDark);
  p.px(11, 21, cargoLight); // cargo pocket
  p.vline(12, 19, 6, o);
  p.rect(9, 24, 3, 2, bootMid);
  p.px(11, 24, bootDark);
  p.hline(9, 26, 3, o);
  p.vline(8, 20, 6, o);

  // Broad torso (fitted blue shirt, y: 10..17)
  p.rect(4, 11, 8, 7, shirtMid);
  p.vline(4, 11, 7, shirtLight);
  p.vline(11, 11, 7, shirtDark);
  p.hline(5, 11, 6, shirtLight);
  p.hline(4, 10, 8, o);
  p.px(7, 11, skinShadow);
  p.px(8, 11, skinShadow);
  // Subtle chest shading + ID necklace
  p.px(7, 12, "#7e8a96");
  p.px(8, 12, "#7e8a96");
  p.px(7, 13, tagSilver);
  p.px(8, 14, tagSilver);
  p.px(6, 15, shirtDark);
  p.px(9, 15, shirtDark);

  // Muscular arms (short fitted sleeves + tanned forearms)
  // Viewer-left (Dilan's right arm)
  p.vline(2, 11, 7, o);
  p.rect(3, 11, 1, 3, shirtMid);
  p.px(3, 11, shirtLight);
  p.rect(3, 14, 1, 4, skinMid);
  p.px(3, 17, skinShadow);
  p.px(3, 18, o);

  // Viewer-right (Dilan's left arm — carries green bracelet!)
  p.vline(13, 11, 7, o);
  p.rect(12, 11, 1, 3, shirtDark);
  p.rect(12, 14, 1, 4, skinMid);
  p.px(12, 17, skinShadow);
  p.px(12, 18, o);
  if (bracelet) {
    p.px(12, 16, bracelet.main);
    p.px(11, 16, bracelet.light);
  }

  // Head (y: 1..10)
  p.hline(5, 1, 6, o);
  p.px(4, 2, o);
  p.px(11, 2, o);
  p.vline(3, 3, 5, o);
  p.vline(12, 3, 5, o);

  // Black hair
  p.hline(5, 2, 6, hairMid);
  p.px(6, 2, hairLight);
  p.px(8, 2, hairLight);
  p.hline(4, 3, 8, hairMid);
  p.px(5, 3, hairLight);
  p.px(11, 3, hairDark);
  p.px(4, 4, hairDark);
  p.px(11, 4, hairDark);
  p.px(6, 4, hairDark);

  // Face
  p.rect(5, 4, 6, 5, skinMid);
  p.hline(6, 4, 4, skinLight);
  p.hline(5, 8, 6, skinShadow);
  p.hline(5, 9, 6, o);
  // Dark eyes & heavy brows
  p.px(6, 5, hairDark);
  p.px(9, 5, hairDark);
  p.px(6, 6, "#120f12");
  p.px(9, 6, "#120f12");
  // Subtle facial scar
  p.px(10, 6, scar);
  p.px(9, 7, scar);
  // Stern jaw
  p.px(7, 8, "#7d4f36");
  p.px(8, 8, "#7d4f36");
}

function drawOdeliaSprite(p: PixelCanvas): void {
  const o = WARM_OUTLINE;
  const hairDark = "#6e2415";
  const hairMid = "#a33c22";
  const hairLight = "#d4603b";
  const skinShadow = "#c99b80";
  const skinMid = "#e8bfa4";
  const skinLight = "#f7dac4";
  const eyeCaramel = "#8c4a1c";
  const cardDark = "#5e322c";
  const cardMid = "#824940";
  const cardLight = "#a66257";
  const dressDark = "#b5a68e";
  const dressMid = "#d9ccb4";
  const dressLight = "#efe6d5";
  const shoe = "#3b261d";

  p.ellipse(8, 26, 4.0, 1.3, SHADOW_GROUND);

  // Slender ankles & tidy shoes (y: 23..26)
  p.vline(6, 23, 2, skinShadow);
  p.vline(9, 23, 2, skinShadow);
  p.rect(5, 25, 2, 1, shoe);
  p.rect(9, 25, 2, 1, shoe);
  p.hline(5, 26, 2, o);
  p.hline(9, 26, 2, o);

  // Neat farmhouse skirt (y: 17..23)
  p.rect(5, 17, 6, 6, dressMid);
  p.vline(5, 17, 6, dressLight);
  p.vline(10, 17, 6, dressDark);
  p.vline(8, 18, 5, dressDark);
  p.vline(4, 18, 5, o);
  p.vline(11, 18, 5, o);
  p.hline(5, 23, 6, o);
  // Cardigan hem over skirt
  p.vline(5, 17, 3, cardMid);
  p.vline(10, 17, 3, cardDark);

  // Slender torso (tidy cardigan + cream blouse, y: 11..17)
  p.rect(5, 11, 6, 6, cardMid);
  p.vline(5, 11, 6, cardLight);
  p.vline(10, 11, 6, cardDark);
  p.rect(7, 11, 2, 5, dressLight);
  p.px(7, 11, skinMid);
  p.px(8, 11, skinMid);
  p.hline(5, 10, 6, o);

  // Slender arms folded neatly in front (no bracelet)
  p.vline(4, 12, 5, o);
  p.vline(11, 12, 5, o);
  p.px(5, 15, cardLight);
  p.px(10, 15, cardDark);
  p.hline(6, 16, 4, skinMid);
  p.px(7, 16, skinLight);
  p.px(9, 16, skinShadow);

  // Head & short red hair (y: 2..10)
  p.hline(5, 2, 6, o);
  p.px(4, 3, o);
  p.px(11, 3, o);
  p.vline(3, 4, 4, o);
  p.vline(12, 4, 4, o);

  // Short cropped red hair
  p.hline(5, 3, 6, hairMid);
  p.hline(6, 3, 3, hairLight);
  p.hline(4, 4, 8, hairMid);
  p.px(5, 4, hairLight);
  p.px(9, 4, hairLight);
  p.vline(4, 5, 3, hairMid);
  p.vline(11, 5, 3, hairDark);
  p.px(4, 8, o);
  p.px(11, 8, o);

  // Slender face
  p.rect(5, 5, 6, 4, skinMid);
  p.hline(6, 5, 4, skinLight);
  p.px(5, 5, hairMid);
  p.px(10, 5, hairDark);
  // Caramel almond eyes
  p.px(6, 6, eyeCaramel);
  p.px(9, 6, eyeCaramel);
  p.px(6, 7, "#d49880");
  p.px(9, 7, "#d49880");
  // Sweet artificial smile hint
  p.px(7, 8, "#a65b52");
  p.px(8, 8, "#a65b52");
  p.hline(6, 9, 4, skinShadow);
  p.hline(6, 10, 4, o);
}

function drawJadenSprite(
  p: PixelCanvas,
  act: "ACT_1" | "ACT_2",
  bracelet: BraceletStyle | null
): void {
  const o = WARM_OUTLINE;
  const hairDark = "#91702d";
  const hairMid = "#c9a649";
  const hairLight = "#ebd078";
  const skinShadow = "#996541";
  const skinMid = "#bd855b";
  const skinLight = "#d49d72";
  const eyeGreen = "#3d9c52";
  const shirtDark = "#2b2624";
  const shirtMid = "#453d38";
  const shirtLight = "#61564f";
  const pantsDark = "#303842";
  const pantsMid = "#475361";
  const boot = "#261d17";

  p.ellipse(8, 26, 4.5, 1.4, SHADOW_GROUND);

  // Legs (cocky leaned stance)
  p.rect(5, 19, 2, 5, pantsMid);
  p.vline(5, 19, 5, pantsDark);
  p.vline(4, 19, 6, o);
  p.rect(5, 24, 2, 2, boot);
  p.hline(5, 26, 2, o);
  p.vline(7, 20, 6, o);

  p.rect(9, 19, 2, 5, pantsMid);
  p.vline(10, 19, 5, pantsDark);
  p.vline(11, 19, 6, o);
  p.rect(9, 24, 2, 2, boot);
  p.hline(9, 26, 2, o);
  p.vline(8, 20, 6, o);

  // Torso (dark henley/vest)
  p.rect(5, 11, 6, 8, shirtMid);
  p.vline(5, 11, 8, shirtLight);
  p.vline(10, 11, 8, shirtDark);
  p.hline(5, 10, 6, o);
  p.px(7, 11, skinMid);
  p.px(8, 11, skinMid);
  p.px(7, 12, shirtDark);
  p.hline(5, 18, 6, "#241d18"); // belt

  // Left arm (viewer-right, with green bracelet)
  p.vline(12, 11, 7, o);
  p.vline(11, 11, 3, shirtDark);
  p.vline(11, 14, 4, skinMid);
  p.px(11, 18, o);
  if (bracelet) {
    p.px(11, 16, bracelet.main);
    p.px(10, 16, bracelet.light);
  }

  // Right arm (viewer-left) — ACT_2 has bandaged bloody hand + glinting knife!
  p.vline(3, 11, 7, o);
  p.vline(4, 11, 3, shirtMid);
  if (act === "ACT_2") {
    p.vline(4, 14, 2, skinMid);
    // White bandage with vivid red bloodstain
    p.rect(3, 16, 2, 2, "#ebe5d8");
    p.px(4, 16, "#b82525");
    p.px(3, 17, "#d93434");
    p.px(4, 18, o);
    // Glinting knife extending down-left
    p.px(3, 18, "#4d3221"); // hilt
    p.px(2, 19, "#dce6f0"); // blade
    p.px(1, 20, "#ffffff"); // blade glint
    p.px(2, 20, "#99a9ba");
    p.px(1, 21, "#c8d6e3");
  } else {
    p.vline(4, 14, 4, skinMid);
    p.px(4, 18, o);
  }

  // Head & messy blonde hair (y: 2..10)
  p.hline(5, 2, 6, o);
  p.px(4, 3, o);
  p.px(11, 3, o);
  p.vline(3, 4, 4, o);
  p.vline(12, 4, 4, o);

  // Messy blonde hair with swept tuft
  p.hline(5, 3, 6, hairMid);
  p.hline(6, 3, 3, hairLight);
  p.hline(4, 4, 8, hairMid);
  p.px(5, 4, hairLight);
  p.px(9, 4, hairLight);
  p.px(10, 4, hairDark);
  p.px(4, 5, hairDark);
  p.px(7, 5, hairMid);
  p.px(11, 5, hairDark);

  // Sun-tanned face
  p.rect(5, 5, 6, 4, skinMid);
  p.hline(6, 5, 4, skinLight);
  p.hline(5, 8, 6, skinShadow);
  p.hline(5, 9, 6, o);
  // Green eyes
  p.px(6, 6, eyeGreen);
  p.px(9, 6, eyeGreen);
  // Earring glint on left ear (viewer-right)
  p.px(11, 7, "#edf4fa");
  // Smirk
  p.px(7, 8, "#754832");
  p.px(8, 8, "#8c563b");
  p.px(9, 7, "#754832");
}

function drawAmarinaSprite(
  p: PixelCanvas,
  bracelet: BraceletStyle | null
): void {
  const o = WARM_OUTLINE;
  const beanieDark = "#914f1c";
  const beanieMid = "#c9762e";
  const beanieLight = "#e69b4c";
  const hairDark = "#1a1312";
  const hairMid = "#302321";
  const skinShadow = "#6e422b";
  const skinMid = "#8f593b";
  const skinLight = "#ab6f4d";
  const teal = "#2c7d78";
  const coral = "#cf4e42";
  const ochre = "#e0ab43";
  const skirtDark = "#3f274a";
  const skirtMid = "#5e3d6e";
  const skirtLight = "#79528c";
  const hearingAid = "#e6d8c3";
  const hearingSilver = "#d4dee8";

  p.ellipse(8, 26, 4.4, 1.4, SHADOW_GROUND);

  // Feet & boots (y: 23..26)
  p.rect(5, 24, 2, 2, "#38261e");
  p.rect(9, 24, 2, 2, "#38261e");
  p.hline(5, 26, 2, o);
  p.hline(9, 26, 2, o);
  p.vline(6, 23, 1, skinShadow);
  p.vline(9, 23, 1, skinShadow);

  // Patterned colorful skirt (y: 18..23)
  p.rect(5, 18, 6, 5, skirtMid);
  p.vline(5, 18, 5, skirtLight);
  p.vline(10, 18, 5, skirtDark);
  p.hline(5, 21, 6, ochre); // decorative hem band
  p.px(6, 21, coral);
  p.px(9, 21, coral);
  p.vline(4, 18, 5, o);
  p.vline(11, 18, 5, o);
  p.hline(5, 23, 6, o);

  // Colorful patterned blouse (y: 12..17)
  p.rect(5, 12, 6, 6, teal);
  p.hline(5, 14, 6, coral);
  p.px(6, 13, ochre);
  p.px(9, 13, ochre);
  p.hline(5, 16, 6, ochre);
  p.px(7, 12, skinMid);
  p.px(8, 12, skinMid);
  p.hline(5, 11, 6, o);

  // Arms + green bracelet
  p.vline(3, 12, 6, o);
  p.vline(4, 12, 4, teal);
  p.px(4, 14, coral);
  p.vline(4, 16, 2, skinMid);
  p.px(4, 18, o);

  p.vline(12, 12, 6, o);
  p.vline(11, 12, 4, teal);
  p.px(11, 14, coral);
  p.vline(11, 16, 2, skinMid);
  p.px(11, 18, o);
  if (bracelet) {
    p.px(11, 16, bracelet.main);
    p.px(10, 16, bracelet.light);
  }

  // Head + knit beanie/touca + straight dark hair + hearing aid (y: 2..11)
  p.hline(5, 2, 6, o);
  p.px(4, 3, o);
  p.px(11, 3, o);
  p.vline(3, 4, 6, o);
  p.vline(12, 4, 6, o);

  // Knit beanie
  p.hline(5, 3, 6, beanieMid);
  p.hline(6, 3, 3, beanieLight);
  p.hline(4, 4, 8, beanieMid);
  p.px(5, 4, beanieLight);
  p.px(8, 4, beanieLight);
  p.hline(4, 5, 8, beanieDark); // ribbed cuff
  p.px(6, 5, beanieMid);
  p.px(9, 5, beanieMid);

  // Face
  p.rect(5, 6, 6, 4, skinMid);
  p.hline(6, 6, 4, skinLight);
  p.hline(6, 9, 4, skinShadow);
  p.hline(5, 10, 6, o);

  // Straight dark hair framing sides
  p.vline(4, 6, 5, hairMid);
  p.px(4, 10, hairDark);
  p.vline(11, 6, 5, hairDark);
  p.px(4, 11, o);
  p.px(11, 11, o);

  // Visible hearing aid tucked at ear!
  p.px(11, 7, hearingAid);
  p.px(12, 7, hearingSilver);
  p.px(11, 8, hearingAid);

  // Dark warm eyes
  p.px(6, 7, "#170e0b");
  p.px(9, 7, "#170e0b");
  // Gentle tired expression
  p.px(7, 9, "#5c3422");
  p.px(8, 9, "#5c3422");
}

function drawJosephSprite(p: PixelCanvas): void {
  const o = WARM_OUTLINE;
  const hairDark = "#2b1c15";
  const hairMid = "#4d3326";
  const hairLight = "#6e4b39";
  const skinShadow = "#b38262";
  const skinMid = "#d19e7c";
  const skinLight = "#e6b99a";
  const shirtDark = "#99917d";
  const shirtMid = "#c2baa3";
  const shirtLight = "#dbd4c0";
  const shortsDark = "#423224";
  const shortsMid = "#5e4835";

  // Dappled shade pool around sitting child (~14x22 silhouette centered in 16x28)
  p.ellipse(8, 25, 5.8, 2.0, SHADOW_SHADE);

  // Sitting legs tucked in front (y: 22..25)
  p.rect(4, 22, 8, 2, shortsMid);
  p.hline(4, 23, 8, shortsDark);
  p.px(3, 22, o);
  p.px(12, 22, o);
  // Small knees/feet sitting on dirt
  p.rect(4, 24, 3, 1, skinMid);
  p.rect(9, 24, 3, 1, skinShadow);
  p.hline(4, 25, 8, o);

  // Tiny wooden stick/toy in dirt
  p.px(7, 24, "#6e5138");
  p.px(8, 25, "#8c694a");

  // Small torso (y: 17..21)
  p.rect(5, 17, 6, 5, shirtMid);
  p.vline(5, 17, 5, shirtLight);
  p.vline(10, 17, 5, shirtDark);
  p.vline(4, 18, 4, o);
  p.vline(11, 18, 4, o);
  // Little arms reaching toward ground
  p.px(5, 20, skinMid);
  p.px(6, 21, skinLight);
  p.px(10, 20, skinShadow);
  p.px(9, 21, skinMid);

  // Child head (y: 10..16, larger cute proportion)
  p.hline(5, 10, 6, o);
  p.px(4, 11, o);
  p.px(11, 11, o);
  p.vline(4, 12, 4, o);
  p.vline(11, 12, 4, o);

  // Tousled curls
  p.hline(5, 11, 6, hairMid);
  p.px(6, 11, hairLight);
  p.px(9, 11, hairLight);
  p.hline(5, 12, 6, hairDark);
  p.px(7, 12, hairMid);

  // Face
  p.rect(5, 13, 6, 3, skinMid);
  p.hline(6, 13, 4, skinLight);
  p.px(5, 13, hairDark);
  p.px(10, 13, hairDark);
  // Big innocent dark eyes
  p.px(6, 14, "#1c1310");
  p.px(9, 14, "#1c1310");
  p.px(7, 15, skinShadow);
  p.px(8, 15, skinShadow);
  p.hline(5, 16, 6, o);
}

function drawMarkSprite(
  p: PixelCanvas,
  bracelet: BraceletStyle | null
): void {
  const o = WARM_OUTLINE;
  const hairDark = "#38281c";
  const hairMid = "#59412f";
  const skinShadow = "#915f44";
  const skinMid = "#b57b5b";
  const skinLight = "#cc9272";
  const shirtMid = "#ada389";
  const dirt = "#694e35";
  const overallDark = "#2f3d4a";
  const overallMid = "#465a6b";
  const overallLight = "#5c7387";
  const boot = "#2b1f16";

  p.ellipse(8, 26, 4.9, 1.5, SHADOW_GROUND);

  // Heavy muddy boots & overalls legs (y: 19..26)
  p.rect(4, 19, 3, 5, overallMid);
  p.vline(4, 19, 5, overallDark);
  p.px(5, 22, dirt);
  p.vline(3, 19, 6, o);
  p.rect(4, 24, 3, 2, boot);
  p.px(6, 25, dirt);
  p.hline(4, 26, 3, o);
  p.vline(7, 20, 6, o);

  p.rect(9, 19, 3, 5, overallMid);
  p.vline(11, 19, 5, overallDark);
  p.px(10, 21, dirt);
  p.vline(12, 19, 6, o);
  p.rect(9, 24, 3, 2, boot);
  p.px(9, 25, dirt);
  p.hline(9, 26, 3, o);
  p.vline(8, 20, 6, o);

  // Hunched broad torso in dirt-stained shirt + overalls (y: 11..18)
  p.rect(4, 11, 8, 8, shirtMid);
  p.rect(5, 13, 6, 6, overallMid);
  p.vline(5, 11, 3, overallLight); // left strap
  p.vline(10, 11, 3, overallDark); // right strap
  p.px(6, 15, dirt);
  p.px(9, 16, dirt);
  p.hline(4, 10, 8, o);

  // Squared hostile arms
  p.vline(2, 12, 7, o);
  p.rect(3, 12, 1, 3, shirtMid);
  p.px(3, 13, dirt);
  p.rect(3, 15, 1, 3, skinMid);
  p.px(3, 18, o);

  p.vline(13, 12, 7, o);
  p.rect(12, 12, 1, 3, shirtMid);
  p.rect(12, 15, 1, 3, skinShadow);
  p.px(12, 18, o);
  if (bracelet) {
    p.px(12, 16, bracelet.main);
  }

  // Hunched head (slightly lower: y: 3..10)
  p.hline(5, 3, 6, o);
  p.px(4, 4, o);
  p.px(11, 4, o);
  p.vline(3, 5, 5, o);
  p.vline(12, 5, 5, o);
  p.hline(4, 4, 8, hairMid);
  p.hline(4, 5, 8, hairDark);
  p.rect(5, 6, 6, 4, skinMid);
  p.hline(6, 6, 4, skinLight);
  p.px(5, 8, dirt); // face smudge
  // Angry heavy scowl
  p.hline(5, 6, 2, hairDark);
  p.hline(9, 6, 2, hairDark);
  p.px(6, 7, "#1a1310");
  p.px(9, 7, "#1a1310");
  p.hline(7, 9, 2, "#6e3d2b");
  p.hline(5, 10, 6, o);
}

function drawRomenoSprite(p: PixelCanvas): void {
  const o = WARM_OUTLINE;
  const hairDark = "#63666b";
  const hairMid = "#94989e";
  const hairLight = "#c7ccd4";
  const skinShadow = "#a87e64";
  const skinMid = "#c99e82";
  const skinLight = "#e0b89d";
  const coatDark = "#1d1b21";
  const coatMid = "#312e36";
  const coatLight = "#494550";
  const shirtLight = "#dbd5c8";
  const boot = "#171417";

  p.ellipse(8, 26, 4.8, 1.4, SHADOW_GROUND);

  // Dark trousers & polished boots (y: 19..26)
  p.rect(5, 19, 2, 5, coatDark);
  p.rect(9, 19, 2, 5, coatDark);
  p.vline(4, 19, 6, o);
  p.vline(11, 19, 6, o);
  p.vline(7, 20, 6, o);
  p.vline(8, 20, 6, o);
  p.rect(5, 24, 2, 2, boot);
  p.rect(9, 24, 2, 2, boot);
  p.hline(5, 26, 2, o);
  p.hline(9, 26, 2, o);

  // Long authoritative dark coat (y: 10..20)
  p.rect(4, 11, 8, 9, coatMid);
  p.vline(4, 11, 9, coatLight);
  p.vline(11, 11, 9, coatDark);
  p.hline(4, 10, 8, o);
  // Crisp shirt lapel V
  p.rect(7, 11, 2, 3, shirtLight);
  p.px(7, 14, "#6e2e2e"); // dark tie/cravat accent
  p.px(8, 14, coatDark);
  // Coat buttons
  p.px(7, 16, "#8c8470");
  p.px(7, 18, "#8c8470");

  // Arms at sides (no bracelet)
  p.vline(3, 11, 7, o);
  p.vline(4, 11, 6, coatLight);
  p.px(4, 17, skinMid);
  p.px(4, 18, o);
  p.vline(12, 11, 7, o);
  p.vline(11, 11, 6, coatDark);
  p.px(11, 17, skinShadow);
  p.px(11, 18, o);

  // Distinguished graying head (tall, y: 1..10)
  p.hline(5, 1, 6, o);
  p.px(4, 2, o);
  p.px(11, 2, o);
  p.vline(3, 3, 5, o);
  p.vline(12, 3, 5, o);

  p.hline(5, 2, 6, hairMid);
  p.hline(6, 2, 4, hairLight);
  p.hline(4, 3, 8, hairMid);
  p.px(4, 4, hairLight); // silver temples
  p.px(11, 4, hairLight);
  p.px(5, 3, hairLight);
  p.px(10, 3, hairDark);

  p.rect(5, 4, 6, 5, skinMid);
  p.hline(6, 4, 4, skinLight);
  p.hline(5, 8, 6, skinShadow);
  p.hline(5, 9, 6, o);
  p.px(6, 5, hairDark);
  p.px(9, 5, hairDark);
  p.px(6, 6, "#171417");
  p.px(9, 6, "#171417");
  p.px(7, 8, "#7d5542");
  p.px(8, 8, "#8f634d");
}

function drawCalebSprite(
  p: PixelCanvas,
  bracelet: BraceletStyle | null
): void {
  const o = WARM_OUTLINE;
  const hairDark = "#332219";
  const hairMid = "#523829";
  const skinShadow = "#a8795c";
  const skinMid = "#c79675";
  const skinLight = "#deb08f";
  const shirtDark = "#404731";
  const shirtMid = "#5c6647";
  const shirtLight = "#78855d";
  const pantsDark = "#292623";
  const pantsMid = "#3d3834";
  const boot = "#241a14";

  p.ellipse(8, 26, 4.4, 1.4, SHADOW_GROUND);

  p.rect(5, 19, 2, 5, pantsMid);
  p.rect(9, 19, 2, 5, pantsMid);
  p.vline(5, 19, 5, pantsDark);
  p.vline(10, 19, 5, pantsDark);
  p.vline(4, 19, 6, o);
  p.vline(11, 19, 6, o);
  p.vline(7, 20, 6, o);
  p.vline(8, 20, 6, o);
  p.rect(5, 24, 2, 2, boot);
  p.rect(9, 24, 2, 2, boot);
  p.hline(5, 26, 2, o);
  p.hline(9, 26, 2, o);

  // Flannel shirt
  p.rect(5, 11, 6, 8, shirtMid);
  p.vline(5, 11, 8, shirtLight);
  p.vline(10, 11, 8, shirtDark);
  p.hline(5, 14, 6, shirtDark);
  p.hline(5, 10, 6, o);

  p.vline(3, 11, 7, o);
  p.vline(4, 11, 5, shirtMid);
  p.px(4, 16, skinMid);
  p.px(4, 17, skinShadow);
  p.px(4, 18, o);

  p.vline(12, 11, 7, o);
  p.vline(11, 11, 5, shirtDark);
  p.px(11, 16, skinMid);
  p.px(11, 17, skinShadow);
  p.px(11, 18, o);
  if (bracelet) {
    p.px(11, 16, bracelet.main);
  }

  // Head
  p.hline(5, 2, 6, o);
  p.px(4, 3, o);
  p.px(11, 3, o);
  p.vline(3, 4, 4, o);
  p.vline(12, 4, 4, o);
  p.hline(5, 3, 6, hairMid);
  p.hline(4, 4, 8, hairDark);
  p.rect(5, 5, 6, 4, skinMid);
  p.hline(6, 5, 4, skinLight);
  p.hline(5, 8, 6, skinShadow);
  p.hline(5, 9, 6, o);
  p.px(6, 6, "#1f1714");
  p.px(9, 6, "#1f1714");
}

// ============================================================================
// 64x64 PIXEL ART PORTRAITS (drawn at 32x32, nearest-neighbor scaled 2x)
// ============================================================================

function drawPortraitFrame(
  p: PixelCanvas,
  bgTop: string,
  bgMid: string,
  bgBot: string,
  accent: string
): void {
  // Rich atmospheric backdrop bands
  p.rect(0, 0, 32, 32, bgMid);
  p.rect(1, 1, 30, 10, bgTop);
  p.rect(1, 20, 30, 11, bgBot);
  // Subtle dithered transition lines
  for (let x = 2; x < 30; x += 2) {
    p.px(x, 11, bgTop);
    p.px(x + 1, 19, bgBot);
  }
  // Subtle corner light/vignette pixels
  p.px(2, 2, accent);
  p.px(29, 2, accent);
  p.px(2, 29, accent);
  p.px(29, 29, accent);
  // Crisp warm dark frame border
  p.hline(0, 0, 32, "#1c1410");
  p.hline(0, 31, 32, "#1c1410");
  p.vline(0, 0, 32, "#1c1410");
  p.vline(31, 0, 32, "#1c1410");
  // Inner subtle highlight bevel
  p.hline(1, 1, 30, "rgba(255,240,210,0.08)");
  p.vline(1, 1, 30, "rgba(255,240,210,0.06)");
}

function drawTerezaPortrait(p: PixelCanvas, mood: PortraitMood): void {
  const o = WARM_OUTLINE;
  const hairDark = "#261712";
  const hairMid = "#452b20";
  const hairLight = "#694534";
  const hairSheen = "#855b46";
  const skinDeep = "#b37f60";
  const skinShadow = "#cc997a";
  const skinMid = "#e6b99a";
  const skinLight = "#f5d4bc";
  const blush = "#db9988";
  const eyeDark = "#184169";
  const eyeBlue = "#3b98e8";
  const eyeLight = "#8fd0ff";
  const jacketDark = "#38342c";
  const jacketMid = "#575043";
  const jacketLight = "#78705e";

  drawPortraitFrame(p, "#2b2826", "#3d3732", "#241f1c", "#544c42");

  // Back hair behind neck/shoulders
  p.rect(6, 12, 20, 16, hairDark);
  p.rect(7, 13, 18, 13, hairMid);
  p.vline(5, 13, 13, o);
  p.vline(26, 13, 13, o);

  // Shoulders & survival jacket collar (y: 23..30)
  p.rect(5, 24, 22, 7, jacketMid);
  p.rect(7, 25, 18, 6, jacketDark);
  p.hline(6, 23, 20, o);
  p.rect(12, 24, 8, 7, "#24211f"); // inner tee
  p.vline(11, 24, 7, jacketLight); // left lapel
  p.vline(20, 24, 7, jacketLight); // right lapel
  p.px(10, 25, jacketLight);
  p.px(21, 25, jacketLight);

  // Neck
  p.rect(13, 21, 6, 4, skinShadow);
  p.rect(14, 21, 4, 3, skinMid);
  p.hline(13, 21, 6, skinDeep);

  // Face oval (x: 10..21, y: 8..21)
  p.rect(10, 9, 12, 11, skinMid);
  p.rect(11, 8, 10, 12, skinMid);
  p.rect(12, 20, 8, 1, skinShadow);
  p.hline(13, 21, 6, o);
  p.rect(11, 9, 10, 4, skinLight);
  p.vline(10, 13, 6, skinShadow);
  p.vline(21, 13, 6, skinShadow);

  // Layered brunette hair & bangs
  p.hline(9, 4, 14, o);
  p.hline(7, 5, 18, o);
  p.rect(8, 5, 16, 4, hairMid);
  p.rect(10, 5, 12, 2, hairLight);
  p.hline(12, 6, 4, hairSheen);
  p.hline(18, 6, 3, hairSheen);
  p.rect(7, 7, 3, 15, hairMid);
  p.vline(7, 8, 14, hairDark);
  p.px(8, 10, hairLight);
  p.px(8, 15, hairLight);
  p.rect(22, 7, 3, 15, hairMid);
  p.vline(24, 8, 14, hairDark);
  p.px(23, 11, hairLight);
  // Swept bangs across forehead
  p.hline(9, 8, 14, hairMid);
  p.px(10, 9, hairDark);
  p.px(11, 9, hairMid);
  p.px(14, 9, hairDark);
  p.px(15, 9, hairMid);
  p.px(19, 9, hairDark);
  p.px(20, 9, hairMid);
  p.px(21, 9, hairDark);

  // Expressive eyebrows (alert/wary)
  const browY = mood === "cold" ? 12 : 11;
  p.hline(11, browY, 3, hairDark);
  p.px(14, browY + (mood === "warm" ? 0 : 1), hairDark);
  p.hline(18, browY, 3, hairDark);
  p.px(17, browY + (mood === "warm" ? 0 : 1), hairDark);

  // Vivid blue eyes (x: 11..14, 17..20, y: 13..15)
  // Left eye
  p.hline(11, 13, 3, o);
  p.px(11, 14, "#f0f5fa");
  p.px(12, 14, eyeDark);
  p.px(13, 14, eyeBlue);
  p.px(11, 15, "#dfe8f0");
  p.px(12, 15, eyeBlue);
  p.px(13, 15, eyeLight);
  // Right eye
  p.hline(18, 13, 3, o);
  p.px(20, 14, "#f0f5fa");
  p.px(19, 14, eyeDark);
  p.px(18, 14, eyeBlue);
  p.px(20, 15, "#dfe8f0");
  p.px(19, 15, eyeBlue);
  p.px(18, 15, eyeLight);

  // Nose & subtle blush
  p.px(15, 16, skinShadow);
  p.px(16, 16, skinLight);
  p.px(11, 17, blush);
  p.px(20, 17, blush);

  // Guarded/observant mouth
  if (mood === "warm") {
    p.hline(14, 18, 4, "#9c5e54");
    p.px(18, 17, "#b57468");
  } else {
    p.hline(14, 18, 4, "#8a5149");
    p.px(15, 19, skinShadow);
    p.px(16, 19, skinShadow);
  }
}

function drawDilanPortrait(p: PixelCanvas, mood: PortraitMood): void {
  const o = WARM_OUTLINE;
  const hairDark = "#141114";
  const hairMid = "#262229";
  const hairLight = "#3d3742";
  const skinDeep = "#7d4f36";
  const skinShadow = "#996547";
  const skinMid = "#b87f5c";
  const skinLight = "#cf9876";
  const scar = "#dbbaa4";
  const shirtDark = "#1d3857";
  const shirtMid = "#2e5785";
  const shirtLight = "#4a7cb3";
  const cord = "#8f9aa6";

  drawPortraitFrame(p, "#242226", "#332e2e", "#1f1b1a", "#4a4340");

  // Broad shoulders in fitted blue shirt
  p.rect(3, 23, 26, 8, shirtMid);
  p.rect(4, 24, 4, 7, shirtLight);
  p.rect(24, 24, 4, 7, shirtDark);
  p.hline(4, 22, 24, o);
  // Collar opening + ID dog-tag cord
  p.rect(12, 23, 8, 4, skinShadow);
  p.rect(13, 23, 6, 3, skinMid);
  p.vline(13, 25, 6, cord);
  p.vline(18, 25, 6, cord);
  p.rect(14, 28, 4, 3, "#cfd8e0");
  p.px(15, 29, "#7d8b99");

  // Strong neck
  p.rect(12, 20, 8, 4, skinShadow);
  p.rect(13, 20, 6, 3, skinMid);
  p.hline(12, 20, 8, skinDeep);

  // Ears
  p.rect(8, 13, 2, 4, skinShadow);
  p.rect(22, 13, 2, 4, skinShadow);
  p.px(9, 14, skinMid);
  p.px(22, 14, skinMid);

  // Squared jaw face (x: 10..21, y: 7..20)
  p.rect(10, 8, 12, 12, skinMid);
  p.rect(11, 7, 10, 13, skinMid);
  p.rect(11, 8, 10, 4, skinLight);
  p.vline(10, 12, 7, skinShadow);
  p.vline(21, 12, 7, skinShadow);
  p.hline(11, 19, 10, skinShadow); // subtle jaw stubble
  p.hline(12, 20, 8, skinDeep);
  p.hline(12, 21, 8, o);

  // Thick messy black hair
  p.hline(9, 3, 14, o);
  p.rect(8, 4, 16, 5, hairMid);
  p.rect(10, 4, 10, 2, hairLight);
  p.px(13, 5, "#544c59");
  p.px(18, 5, "#544c59");
  p.rect(8, 7, 2, 6, hairDark);
  p.rect(22, 7, 2, 6, hairDark);
  p.px(10, 8, hairDark);
  p.px(12, 8, hairMid);
  p.px(15, 8, hairDark);
  p.px(19, 8, hairDark);
  p.px(21, 8, hairMid);

  // Heavy guarded eyebrows
  const bOff = mood === "cold" ? 1 : 0;
  p.hline(11, 11 + bOff, 4, hairDark);
  p.hline(17, 11 + bOff, 4, hairDark);
  p.px(14, 12, hairDark);
  p.px(17, 12, hairDark);

  // Intense dark eyes
  p.hline(11, 13, 3, o);
  p.px(11, 14, "#e3dfd8");
  p.px(12, 14, "#141014");
  p.px(13, 14, "#2b2226");
  p.hline(18, 13, 3, o);
  p.px(20, 14, "#e3dfd8");
  p.px(19, 14, "#141014");
  p.px(18, 14, "#2b2226");

  // Diagonal facial scar across cheek
  p.px(20, 15, scar);
  p.px(19, 16, scar);
  p.px(18, 17, scar);
  p.px(20, 16, skinDeep);

  // Nose & stern mouth
  p.vline(15, 14, 3, skinShadow);
  p.px(16, 16, skinLight);
  p.hline(13, 18, 6, "#6e4230");
  p.hline(14, 19, 4, skinDeep);
}

function drawOdeliaPortrait(p: PixelCanvas, mood: PortraitMood): void {
  const o = WARM_OUTLINE;
  const isCold = mood === "cold";
  const hairDark = isCold ? "#591d14" : "#6e2516";
  const hairMid = isCold ? "#8a3220" : "#a63e24";
  const hairLight = isCold ? "#b34d34" : "#d9653f";
  const skinDeep = isCold ? "#ab8270" : "#ba8b73";
  const skinShadow = isCold ? "#c49b88" : "#d4a68c";
  const skinMid = isCold ? "#deb9a4" : "#ebc2a7";
  const skinLight = isCold ? "#edd0bd" : "#fadbc5";
  const eyeDark = isCold ? "#4a230d" : "#633213";
  const eyeCaramel = isCold ? "#8f4e22" : "#c47431";
  const cardDark = "#592e28";
  const cardMid = "#7d453d";
  const cardLight = "#9e5e54";
  const collar = "#ebe2d0";

  if (isCold) {
    drawPortraitFrame(p, "#1b171f", "#2b2430", "#17141a", "#3e3545");
  } else {
    drawPortraitFrame(p, "#3d2c22", "#573f30", "#30221a", "#785944");
  }

  // Slender shoulders & tidy cardigan
  p.rect(6, 24, 20, 7, cardMid);
  p.vline(6, 24, 7, cardLight);
  p.vline(25, 24, 7, cardDark);
  p.hline(7, 23, 18, o);
  // Neat cream lace collar
  p.rect(12, 23, 8, 8, collar);
  p.px(11, 24, collar);
  p.px(20, 24, collar);
  p.vline(15, 25, 6, "#cfc2ab");
  p.px(16, 26, "#8c7a62"); // button

  // Slender neck
  p.rect(14, 20, 4, 4, skinShadow);
  p.rect(15, 20, 2, 3, skinMid);

  // Narrow gaunt face (x: 11..20, y: 8..20)
  p.rect(11, 9, 10, 10, skinMid);
  p.rect(12, 8, 8, 12, skinMid);
  p.rect(12, 9, 8, 4, skinLight);
  p.vline(11, 13, 6, skinShadow);
  p.vline(20, 13, 6, skinShadow);
  p.hline(13, 20, 6, skinShadow);
  p.hline(14, 21, 4, o);
  // Gaunt cheekbone hollows (stronger when cold)
  p.px(11, 16, skinDeep);
  p.px(20, 16, skinDeep);
  if (isCold) {
    p.px(12, 17, skinShadow);
    p.px(19, 17, skinShadow);
  }

  // Short styled red hair
  p.hline(10, 4, 12, o);
  p.rect(8, 5, 16, 4, hairMid);
  p.rect(10, 5, 11, 2, hairLight);
  p.px(13, 6, "#eb835b");
  p.px(17, 6, "#eb835b");
  p.rect(8, 7, 3, 9, hairMid);
  p.vline(8, 8, 8, hairDark);
  p.px(9, 10, hairLight);
  p.rect(21, 7, 3, 9, hairMid);
  p.vline(23, 8, 8, hairDark);
  p.px(22, 10, hairLight);
  // Side-swept bangs
  p.hline(10, 8, 12, hairMid);
  p.hline(11, 9, 4, hairDark);
  p.px(15, 9, hairMid);
  p.hline(19, 9, 3, hairDark);

  if (isCold) {
    // COLD PREDATORY STARE: sharp furrowed brows, heavy shadowed upper lids, tense flat mouth
    p.px(11, 11, hairDark);
    p.px(12, 11, hairDark);
    p.px(13, 12, hairDark);
    p.px(14, 12, hairDark);
    p.px(20, 11, hairDark);
    p.px(19, 11, hairDark);
    p.px(18, 12, hairDark);
    p.px(17, 12, hairDark);

    // Narrowed predatory almond eyes (no warm sparkle)
    p.hline(11, 13, 4, o);
    p.px(12, 14, eyeDark);
    p.px(13, 14, eyeCaramel);
    p.px(14, 14, "#d1c5bc");
    p.hline(17, 13, 4, o);
    p.px(19, 14, eyeDark);
    p.px(18, 14, eyeCaramel);
    p.px(17, 14, "#d1c5bc");

    // Harsh flat pinched mouth
    p.hline(13, 18, 6, "#783c36");
    p.px(13, 19, skinDeep);
    p.px(18, 19, skinDeep);
  } else {
    // UNSETTLINGLY SWEET ARTIFICIAL SMILE: arched brows, wide bright almond eyes, wide upturned smile
    p.px(11, 11, hairDark);
    p.hline(12, 10, 2, hairDark);
    p.px(14, 11, hairDark);
    p.px(20, 11, hairDark);
    p.hline(18, 10, 2, hairDark);
    p.px(17, 11, hairDark);

    // Caramel almond eyes with overly bright glint
    p.hline(11, 12, 4, o);
    p.px(11, 13, "#f7f3eb");
    p.px(12, 13, eyeDark);
    p.px(13, 13, eyeCaramel);
    p.px(12, 14, eyeCaramel);
    p.px(13, 14, "#f0b473");
    p.hline(17, 12, 4, o);
    p.px(20, 13, "#f7f3eb");
    p.px(19, 13, eyeDark);
    p.px(18, 13, eyeCaramel);
    p.px(19, 14, eyeCaramel);
    p.px(18, 14, "#f0b473");

    // Soft rosy cheeks + unsettlingly wide artificial smile
    p.px(11, 15, "#e09c8d");
    p.px(20, 15, "#e09c8d");
    p.px(12, 17, "#9e4640");
    p.hline(13, 18, 6, "#b54f47");
    p.px(19, 17, "#9e4640");
    p.hline(14, 17, 4, "#f5eee4"); // bright fixed teeth flash
  }

  // Slender nose
  p.px(15, 15, skinShadow);
  p.px(16, 15, skinLight);
}

function drawJadenPortrait(p: PixelCanvas, mood: PortraitMood): void {
  const o = WARM_OUTLINE;
  const hairDark = "#8a6a29";
  const hairMid = "#c9a547";
  const hairLight = "#ebd075";
  const hairBright = "#f7e39c";
  const skinDeep = "#875636";
  const skinShadow = "#a36c45";
  const skinMid = "#c2885d";
  const skinLight = "#d9a277";
  const eyeDark = "#215c31";
  const eyeGreen = "#49b861";
  const shirtDark = "#24201e";
  const shirtMid = "#3d3632";
  const shirtLight = "#574e48";

  drawPortraitFrame(p, "#33241a", "#4f3726", "#291c14", "#6e4e37");

  // Shoulders & open-collar henley
  p.rect(5, 23, 22, 8, shirtMid);
  p.rect(6, 24, 3, 7, shirtLight);
  p.rect(23, 24, 3, 7, shirtDark);
  p.hline(6, 22, 20, o);
  // Open V neckline
  p.rect(13, 23, 6, 5, skinMid);
  p.rect(14, 24, 4, 4, skinShadow);
  p.vline(12, 23, 6, shirtDark);
  p.vline(19, 23, 6, shirtDark);

  // Neck
  p.rect(13, 20, 6, 4, skinShadow);
  p.rect(14, 20, 4, 3, skinMid);

  // Ears + silver earring on viewer-right ear
  p.rect(9, 13, 2, 4, skinShadow);
  p.rect(21, 13, 2, 4, skinShadow);
  p.px(22, 16, "#edf4fa"); // bright earring glint
  p.px(22, 17, "#9eb0c2");

  // Sun-tanned angular face
  p.rect(10, 8, 12, 11, skinMid);
  p.rect(11, 7, 10, 13, skinMid);
  p.rect(11, 9, 10, 4, skinLight);
  p.vline(10, 12, 7, skinShadow);
  p.vline(21, 12, 7, skinShadow);
  p.hline(12, 20, 8, skinDeep);
  p.hline(13, 21, 6, o);

  // Messy tousled blonde hair
  p.hline(9, 3, 14, o);
  p.rect(8, 4, 16, 5, hairMid);
  p.rect(10, 4, 11, 2, hairLight);
  p.px(12, 5, hairBright);
  p.px(17, 5, hairBright);
  // Messy tufts hanging over forehead
  p.px(9, 8, hairDark);
  p.px(10, 9, hairMid);
  p.px(12, 8, hairLight);
  p.px(13, 9, hairMid);
  p.px(16, 8, hairDark);
  p.px(17, 9, hairLight);
  p.px(20, 8, hairMid);
  p.px(21, 9, hairDark);
  p.rect(8, 7, 2, 5, hairDark);
  p.rect(22, 7, 2, 5, hairDark);

  // Cocky asymmetric brows
  p.hline(11, 12, 3, hairDark);
  p.px(14, 12, hairDark);
  p.hline(18, 11, 3, hairDark);
  p.px(17, 12, hairDark);

  // Predatory green eyes (heavy upper lid)
  p.hline(11, 13, 4, o);
  p.px(11, 14, "#ebe6dc");
  p.px(12, 14, eyeDark);
  p.px(13, 14, eyeGreen);
  p.hline(17, 13, 4, o);
  p.px(20, 14, "#ebe6dc");
  p.px(19, 14, eyeDark);
  p.px(18, 14, eyeGreen);

  // Nose
  p.px(15, 15, skinShadow);
  p.px(16, 16, skinLight);

  // Predatory crooked smirk
  const smirkShift = mood === "cold" ? 0 : -1;
  p.hline(13, 18, 4, "#75432e");
  p.px(17, 18, "#8c5138");
  p.px(18, 18 + smirkShift, "#75432e");
  p.px(19, 17, skinDeep);
}

function drawAmarinaPortrait(p: PixelCanvas, mood: PortraitMood): void {
  const o = WARM_OUTLINE;
  const beanieDark = "#8a4818";
  const beanieMid = "#c9742c";
  const beanieLight = "#e69949";
  const hairDark = "#171110";
  const hairMid = "#2e2220";
  const skinDeep = "#5c3521";
  const skinShadow = "#75462d";
  const skinMid = "#945c3d";
  const skinLight = "#b07452";
  const teal = "#2b7a75";
  const coral = "#cc4c40";
  const ochre = "#e0ab43";
  const hearingBeige = "#e8dac5";
  const hearingSilver = "#dce6f0";

  drawPortraitFrame(p, "#29332e", "#3c4a42", "#222b26", "#54695d");

  // Straight dark hair behind neck
  p.rect(7, 12, 18, 15, hairDark);
  p.rect(8, 13, 16, 12, hairMid);

  // Shoulders & colorful woven collar
  p.rect(5, 24, 22, 7, teal);
  p.hline(6, 23, 20, o);
  p.hline(6, 26, 20, coral);
  p.hline(6, 28, 20, ochre);
  for (let x = 7; x < 25; x += 4) {
    p.px(x, 25, ochre);
    p.px(x + 1, 27, teal);
    p.px(x + 2, 29, coral);
  }
  // Neckline
  p.rect(13, 21, 6, 4, skinShadow);
  p.rect(14, 21, 4, 3, skinMid);

  // Face (x: 10..21, y: 10..20)
  p.rect(10, 10, 12, 10, skinMid);
  p.rect(11, 10, 10, 4, skinLight);
  p.vline(10, 13, 6, skinShadow);
  p.vline(21, 13, 6, skinShadow);
  p.hline(12, 20, 8, skinDeep);
  p.hline(13, 21, 6, o);

  // Straight dark hair framing left side
  p.rect(8, 10, 2, 13, hairMid);
  p.vline(8, 11, 12, hairDark);
  // Hair tucked back slightly on right side to reveal hearing aid!
  p.rect(22, 10, 2, 13, hairDark);
  p.px(21, 10, hairMid);

  // Visible hearing aid behind/on right ear (x: 21..23, y: 13..17)
  p.rect(21, 14, 2, 3, skinShadow);
  p.px(22, 13, hearingBeige);
  p.px(23, 14, hearingBeige);
  p.px(23, 15, hearingSilver);
  p.px(22, 16, hearingBeige);
  p.px(21, 15, hearingSilver); // ear mold tip

  // Knit beanie/touca (y: 3..10)
  p.hline(10, 3, 12, o);
  p.rect(8, 4, 16, 6, beanieMid);
  p.rect(10, 4, 10, 2, beanieLight);
  p.px(12, 5, "#f2b86b");
  p.px(17, 5, "#f2b86b");
  // Ribbed cuff
  p.hline(8, 8, 16, beanieDark);
  p.hline(8, 9, 16, beanieDark);
  for (let x = 9; x < 23; x += 2) {
    p.px(x, 8, beanieMid);
    p.px(x, 9, beanieLight);
  }
  p.hline(8, 10, 16, o);

  // Warm tired eyebrows & dark eyes
  p.hline(11, 12, 3, hairDark);
  p.hline(18, 12, 3, hairDark);

  p.hline(11, 13, 3, o);
  p.px(11, 14, "#ede6dc");
  p.px(12, 14, "#170e0b");
  p.px(13, 14, "#332018");
  p.hline(18, 13, 3, o);
  p.px(20, 14, "#ede6dc");
  p.px(19, 14, "#170e0b");
  p.px(18, 14, "#332018");
  // Subtle tired under-eye shadows
  p.hline(11, 15, 3, skinShadow);
  p.hline(18, 15, 3, skinShadow);

  // Nose & cautious warm mouth
  p.px(15, 16, skinShadow);
  p.px(16, 16, skinLight);
  if (mood === "cold") {
    p.hline(14, 18, 4, skinDeep);
  } else {
    p.hline(14, 18, 4, "#6b3828");
    p.px(13, 18, skinShadow);
    p.px(18, 18, skinShadow);
  }
}

function drawMarkPortrait(p: PixelCanvas): void {
  const o = WARM_OUTLINE;
  const hairDark = "#362519";
  const hairMid = "#59402d";
  const hairLight = "#78573e";
  const skinDeep = "#7d4d34";
  const skinShadow = "#9c6648";
  const skinMid = "#ba7e5c";
  const skinLight = "#d19675";
  const dirt = "#634830";
  const overall = "#425666";
  const shirt = "#aba085";

  drawPortraitFrame(p, "#2e2219", "#453325", "#241912", "#614834");

  // Broad shoulders in dirty shirt & denim overall straps
  p.rect(4, 23, 24, 8, shirt);
  p.hline(5, 22, 22, o);
  p.rect(8, 23, 4, 8, overall);
  p.rect(20, 23, 4, 8, overall);
  p.px(9, 26, "#b89f65"); // brass overall button
  p.px(21, 26, "#b89f65");
  p.px(14, 26, dirt);
  p.px(17, 28, dirt);

  // Thick neck
  p.rect(12, 20, 8, 4, skinShadow);
  p.rect(13, 20, 6, 3, skinMid);

  // Rugged weathered face
  p.rect(9, 8, 14, 12, skinMid);
  p.rect(10, 8, 12, 4, skinLight);
  p.vline(9, 12, 7, skinShadow);
  p.vline(22, 12, 7, skinShadow);
  // Rough beard stubble
  p.rect(10, 17, 12, 3, skinShadow);
  for (let x = 10; x <= 21; x += 2) {
    p.px(x, 18, skinDeep);
    p.px(x + 1, 19, skinDeep);
  }
  p.hline(11, 20, 10, o);

  // Unkempt shaggy hair
  p.hline(9, 4, 14, o);
  p.rect(8, 5, 16, 5, hairMid);
  p.rect(10, 5, 10, 2, hairLight);
  p.rect(8, 8, 2, 5, hairDark);
  p.rect(22, 8, 2, 5, hairDark);
  p.px(11, 9, hairDark);
  p.px(15, 9, hairMid);
  p.px(19, 9, hairDark);

  // Dirt smudges on cheek & forehead
  p.px(11, 10, dirt);
  p.px(20, 15, dirt);
  p.px(19, 16, dirt);

  // Hostile deeply furrowed scowl
  p.hline(10, 11, 3, hairDark);
  p.px(13, 12, hairDark);
  p.px(14, 12, hairDark);
  p.hline(19, 11, 3, hairDark);
  p.px(18, 12, hairDark);
  p.px(17, 12, hairDark);

  // Glaring eyes
  p.hline(11, 13, 3, o);
  p.px(12, 14, "#17110e");
  p.px(13, 14, "#d9cfbe");
  p.hline(18, 13, 3, o);
  p.px(19, 14, "#17110e");
  p.px(18, 14, "#d9cfbe");

  // Downturned angry mouth
  p.hline(13, 17, 6, "#663226");
  p.px(12, 18, "#663226");
  p.px(19, 18, "#663226");
}

function drawRomenoPortrait(p: PixelCanvas): void {
  const o = WARM_OUTLINE;
  const hairDark = "#5e6269";
  const hairMid = "#8f949c";
  const hairLight = "#c7ccd6";
  const hairBright = "#e3e8f0";
  const skinDeep = "#8f674e";
  const skinShadow = "#ad8166";
  const skinMid = "#cca083";
  const skinLight = "#e3baa0";
  const coatDark = "#1c1a21";
  const coatMid = "#302d36";
  const coatLight = "#494552";
  const shirt = "#e0dad0";

  drawPortraitFrame(p, "#1d1c24", "#2e2c36", "#18171c", "#474454");

  // Tailored dark coat & structured lapels
  p.rect(4, 23, 24, 8, coatMid);
  p.hline(5, 22, 22, o);
  p.rect(12, 23, 8, 8, shirt);
  p.vline(11, 23, 8, coatLight);
  p.vline(20, 23, 8, coatLight);
  p.rect(15, 25, 2, 6, "#632828"); // dignified dark burgundy tie
  p.vline(5, 24, 7, coatLight);
  p.vline(26, 24, 7, coatDark);

  // Neck
  p.rect(13, 20, 6, 4, skinShadow);
  p.rect(14, 20, 4, 3, skinMid);

  // Ears
  p.rect(9, 13, 2, 4, skinShadow);
  p.rect(21, 13, 2, 4, skinShadow);

  // Distinguished middle-aged face
  p.rect(10, 8, 12, 12, skinMid);
  p.rect(11, 7, 10, 13, skinMid);
  p.rect(11, 8, 10, 4, skinLight);
  p.vline(10, 12, 7, skinShadow);
  p.vline(21, 12, 7, skinShadow);
  p.hline(12, 20, 8, skinDeep);
  p.hline(13, 21, 6, o);
  // Subtle forehead & cheek age lines
  p.hline(13, 10, 6, skinShadow);
  p.px(12, 16, skinShadow);
  p.px(19, 16, skinShadow);

  // Neatly combed silver-gray hair
  p.hline(10, 3, 12, o);
  p.rect(9, 4, 14, 4, hairMid);
  p.rect(11, 4, 10, 2, hairLight);
  p.hline(12, 5, 6, hairBright);
  p.rect(9, 7, 2, 6, hairLight); // silver temples
  p.rect(21, 7, 2, 6, hairLight);
  p.vline(8, 6, 6, hairDark);
  p.vline(23, 6, 6, hairDark);

  // Composed authoritative brows & dark eyes
  p.hline(11, 12, 4, hairDark);
  p.hline(17, 12, 4, hairDark);
  p.hline(11, 13, 3, o);
  p.px(11, 14, "#e6e2da");
  p.px(12, 14, "#171417");
  p.px(13, 14, "#2e282e");
  p.hline(18, 13, 3, o);
  p.px(20, 14, "#e6e2da");
  p.px(19, 14, "#171417");
  p.px(18, 14, "#2e282e");

  // Nose & polite patronizing half-smile
  p.vline(15, 14, 3, skinShadow);
  p.px(16, 16, skinLight);
  p.hline(13, 18, 5, "#875746");
  p.px(18, 17, "#9c6754");
  p.px(19, 17, skinShadow);
}

function drawJosephPortrait(p: PixelCanvas): void {
  const o = WARM_OUTLINE;
  const hairDark = "#2b1b14";
  const hairMid = "#4d3326";
  const hairLight = "#734e3b";
  const skinShadow = "#b58364";
  const skinMid = "#d4a07e";
  const skinLight = "#ebc0a2";
  const blush = "#d99682";
  const shirtDark = "#99917d";
  const shirtMid = "#c4bca5";
  const shirtLight = "#ded7c3";

  // Soft leafy shade backdrop
  drawPortraitFrame(p, "#1f2922", "#324237", "#1a241d", "#485e4e");

  // Small shoulders sitting lower in frame
  p.rect(8, 25, 16, 6, shirtMid);
  p.vline(8, 25, 6, shirtLight);
  p.vline(23, 25, 6, shirtDark);
  p.hline(9, 24, 14, o);
  p.rect(14, 24, 4, 3, skinMid);

  // Small rounded child face (x: 10..21, y: 12..23)
  p.rect(10, 13, 12, 9, skinMid);
  p.rect(11, 12, 10, 11, skinMid);
  p.rect(12, 13, 8, 4, skinLight);
  p.hline(12, 22, 8, skinShadow);
  p.hline(13, 23, 6, o);

  // Soft tousled dark curls
  p.hline(10, 8, 12, o);
  p.rect(8, 9, 16, 5, hairMid);
  p.rect(10, 9, 10, 2, hairLight);
  p.px(9, 12, hairDark);
  p.px(11, 13, hairMid);
  p.px(14, 13, hairDark);
  p.px(18, 13, hairMid);
  p.px(21, 12, hairDark);
  p.rect(9, 12, 1, 5, hairDark);
  p.rect(22, 12, 1, 5, hairDark);

  // Big innocent dark eyes
  p.rect(12, 15, 2, 2, "#1c120e");
  p.px(12, 15, "#ffffff"); // bright innocent sparkle
  p.rect(18, 15, 2, 2, "#1c120e");
  p.px(18, 15, "#ffffff");

  // Soft rosy cheeks & tiny quiet mouth
  p.px(11, 18, blush);
  p.px(20, 18, blush);
  p.px(15, 18, skinShadow);
  p.hline(15, 20, 2, "#9c6252");
}

function drawCalebPortrait(p: PixelCanvas): void {
  const o = WARM_OUTLINE;
  const hairDark = "#332219";
  const hairMid = "#523829";
  const skinShadow = "#a6775a";
  const skinMid = "#c79675";
  const skinLight = "#deb08f";
  const flannelDark = "#3e452f";
  const flannelMid = "#5c6647";
  const flannelLight = "#78855d";

  drawPortraitFrame(p, "#242921", "#384033", "#1e241b", "#4e5947");

  p.rect(5, 23, 22, 8, flannelMid);
  p.hline(6, 22, 20, o);
  p.hline(6, 26, 20, flannelDark);
  p.vline(10, 23, 8, flannelLight);
  p.vline(21, 23, 8, flannelDark);
  p.rect(13, 21, 6, 4, skinShadow);

  p.rect(10, 9, 12, 11, skinMid);
  p.rect(11, 8, 10, 12, skinMid);
  p.rect(11, 9, 10, 4, skinLight);
  p.hline(12, 20, 8, skinShadow);
  p.hline(13, 21, 6, o);

  p.hline(9, 4, 14, o);
  p.rect(8, 5, 16, 4, hairMid);
  p.rect(9, 8, 2, 5, hairDark);
  p.rect(21, 8, 2, 5, hairDark);

  p.hline(11, 12, 3, hairDark);
  p.hline(18, 12, 3, hairDark);
  p.px(12, 14, "#1c1512");
  p.px(19, 14, "#1c1512");
  p.hline(14, 18, 4, "#7d503d");
}

function drawSfxPortrait(p: PixelCanvas): void {
  // Atmospheric retro audio-tape / acoustic waveform emblem
  drawPortraitFrame(p, "#171412", "#211d1a", "#12100e", "#383028");

  // Faint scanlines
  for (let y = 3; y < 29; y += 3) {
    p.hline(2, y, 28, "rgba(255,235,190,0.03)");
  }

  // Retro brass cassette / oscilloscope inner bezel
  p.hline(4, 5, 24, "#5c4d35");
  p.hline(4, 26, 24, "#5c4d35");
  p.vline(4, 5, 22, "#5c4d35");
  p.vline(27, 5, 22, "#5c4d35");
  p.px(5, 6, "#9e8452");
  p.px(26, 6, "#9e8452");
  p.px(5, 25, "#9e8452");
  p.px(26, 25, "#9e8452");

  // Center horizon line
  p.hline(6, 16, 20, "#4a3e2c");

  // Symmetrical golden sound-wave bars
  const heights = [2, 4, 7, 5, 10, 14, 9, 15, 11, 6, 12, 8, 5, 3, 2];
  const startX = 8;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    const x = startX + i;
    const half = Math.floor(h / 2);
    const topY = 16 - half;
    p.vline(x, topY, h, "#c99636");
    if (h >= 6) {
      p.vline(x, topY + 1, h - 2, "#e8b948");
    }
    if (h >= 10) {
      p.vline(x, topY + 3, h - 6, "#fff0bd");
    }
  }

  // Subtle dual reel dots at top/bottom corners
  p.rect(7, 8, 2, 2, "#756244");
  p.rect(23, 8, 2, 2, "#756244");
  p.hline(11, 23, 10, "#63533a");
  p.px(12, 23, "#e8b948");
  p.px(19, 23, "#e8b948");
}

function createPortraitDataUrl(drawFn: (p: PixelCanvas) => void): string | null {
  if (typeof document === "undefined") return null;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = PORTRAIT_SRC;
  srcCanvas.height = PORTRAIT_SRC;
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) return null;
  srcCtx.imageSmoothingEnabled = false;

  const p = new PixelCanvas(srcCtx, PORTRAIT_SRC, PORTRAIT_SRC);
  p.clear();
  drawFn(p);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = PORTRAIT_OUT;
  outCanvas.height = PORTRAIT_OUT;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) return null;
  outCtx.imageSmoothingEnabled = false;
  outCtx.drawImage(srcCanvas, 0, 0, PORTRAIT_OUT, PORTRAIT_OUT);

  return outCanvas.toDataURL("image/png");
}

function renderPortraitFor(entityId: EntityId, mood: PortraitMood): string | null {
  switch (entityId) {
    case "TEREZA":
      return createPortraitDataUrl((p) => drawTerezaPortrait(p, mood));
    case "DILAN":
      return createPortraitDataUrl((p) => drawDilanPortrait(p, mood));
    case "ODELIA":
      return createPortraitDataUrl((p) => drawOdeliaPortrait(p, mood));
    case "JADEN":
      return createPortraitDataUrl((p) => drawJadenPortrait(p, mood));
    case "AMARINA":
      return createPortraitDataUrl((p) => drawAmarinaPortrait(p, mood));
    case "MARK":
      return createPortraitDataUrl((p) => drawMarkPortrait(p));
    case "ROMENO":
      return createPortraitDataUrl((p) => drawRomenoPortrait(p));
    case "JOSEPH":
      return createPortraitDataUrl((p) => drawJosephPortrait(p));
    case "CALEB":
      return createPortraitDataUrl((p) => drawCalebPortrait(p));
    case "SFX":
      return createPortraitDataUrl((p) => drawSfxPortrait(p));
  }
}

// ============================================================================
// PUBLIC GENERATOR & REGISTRY
// ============================================================================

export function generateCharacterArt(
  scene: Phaser.Scene,
  entities: EntitiesDataFile,
  availablePortraitIds: Set<string>
): CharacterArtRegistry {
  const specMap = new Map<Exclude<EntityId, "SFX">, EntitySpec>();
  for (const spec of entities.entities) {
    specMap.set(spec.id, spec);
  }

  // 1. Generate Tereza walk-cycle & idle sprites (2 acts x 4 directions x 4 frames)
  const terezaKey = (act: "ACT_1" | "ACT_2", facing: FacingDir, frame: 0 | 1 | 2 | 3): string =>
    `char_TEREZA_${act}_${facing}_${frame}`;

  for (const act of ACTS) {
    const bracelet = resolveBraceletStyle(specMap.get("TEREZA"), act);
    for (const facing of FACINGS) {
      for (const frame of FRAMES) {
        const key = terezaKey(act, facing, frame);
        createSpriteTexture(scene, key, (p) => {
          drawTerezaSprite(p, act, facing, frame, bracelet);
        });
      }
    }
  }

  // 2. Generate NPC sprites (16x28) for both acts
  const npcKey = (entityId: Exclude<EntityId, "SFX">, act: "ACT_1" | "ACT_2"): string => {
    if (entityId === "TEREZA") {
      return terezaKey(act, "down", 0);
    }
    return `char_NPC_${entityId}_${act}`;
  };

  for (const act of ACTS) {
    for (const entityId of ALL_NPC_IDS) {
      if (entityId === "TEREZA") continue;
      const spec = specMap.get(entityId);
      const bracelet =
        resolveBraceletStyle(spec, act) ?? (entityId === "CALEB" ? BRACELET_GREEN : null);
      const key = npcKey(entityId, act);
      createSpriteTexture(scene, key, (p) => {
        switch (entityId) {
          case "DILAN":
            drawDilanSprite(p, act, bracelet);
            break;
          case "ODELIA":
            drawOdeliaSprite(p);
            break;
          case "JADEN":
            drawJadenSprite(p, act, bracelet);
            break;
          case "AMARINA":
            drawAmarinaSprite(p, bracelet);
            break;
          case "JOSEPH":
            drawJosephSprite(p);
            break;
          case "MARK":
            drawMarkSprite(p, bracelet);
            break;
          case "ROMENO":
            drawRomenoSprite(p);
            break;
          case "CALEB":
            drawCalebSprite(p, bracelet);
            break;
        }
      });
    }
  }

  // 3. Build data-driven NPC hotspot resolver from entities.json (+ CALEB fallback)
  const resolvableNpcIds: Exclude<EntityId, "SFX">[] = [];
  for (const spec of entities.entities) {
    if (!resolvableNpcIds.includes(spec.id)) {
      resolvableNpcIds.push(spec.id);
    }
  }
  if (!resolvableNpcIds.includes("CALEB")) {
    resolvableNpcIds.push("CALEB");
  }
  // Sort longest first to avoid any prefix ambiguity
  resolvableNpcIds.sort((a, b) => b.length - a.length);

  // 4. Pre-generate crisp 64x64 procedural portrait Data URLs
  const portraitCache = new Map<string, string | null>();
  const cachePortrait = (entityId: EntityId, mood: PortraitMood): void => {
    const cacheKey = `${entityId}:${mood}`;
    portraitCache.set(cacheKey, renderPortraitFor(entityId, mood));
  };

  for (const entityId of ALL_PORTRAIT_IDS) {
    cachePortrait(entityId, "default");
    if (entityId === "ODELIA" || entityId === "TEREZA" || entityId === "DILAN" || entityId === "JADEN" || entityId === "AMARINA") {
      cachePortrait(entityId, "cold");
      cachePortrait(entityId, "warm");
    }
  }

  return {
    getTerezaTextureKey(act: "ACT_1" | "ACT_2", facing: FacingDir, frame: 0 | 1 | 2 | 3): string {
      return terezaKey(act, facing, frame);
    },

    getNpcTextureKey(entityId: Exclude<EntityId, "SFX">, act: "ACT_1" | "ACT_2"): string | null {
      const key = npcKey(entityId, act);
      return scene.textures.exists(key) ? key : null;
    },

    resolveHotspotNpcEntity(hotspotId: string): Exclude<EntityId, "SFX"> | null {
      const upper = hotspotId.toUpperCase();
      const tokens = upper.split("_");
      for (const id of resolvableNpcIds) {
        if (tokens.includes(id)) {
          return id;
        }
      }
      return null;
    },

    getPortraitUrl(entityId: EntityId, mood: PortraitMood = "default"): string | null {
      // Phase 2 automatic art replacement takes priority over procedural portraits
      if (mood !== "default") {
        const moodId = `${entityId}_${mood.toUpperCase()}`;
        if (availablePortraitIds.has(moodId)) {
          return `assets/portraits/${moodId}.png`;
        }
      }
      if (availablePortraitIds.has(entityId)) {
        return `assets/portraits/${entityId}.png`;
      }

      const exactKey = `${entityId}:${mood}`;
      if (portraitCache.has(exactKey)) {
        return portraitCache.get(exactKey) ?? null;
      }
      return portraitCache.get(`${entityId}:default`) ?? null;
    },
  };
}
