import Phaser from "phaser";
import type { AssetManifest } from "virtual:asset-manifest";
import type {
  DialogueEntry,
  HotspotSpec,
  ItemId,
  RoomId,
  RoomSpec,
  StateEffects,
} from "../types";
import { audioEngine } from "../audio/AudioEngine";
import type { GameDataBundle } from "../engine/gameData";
import {
  clampPointToPolygon,
  computeDepthScale,
  hexToNumber,
  type Point2D,
} from "../engine/geometry";
import { StateManager } from "../engine/stateManager";
import {
  generateCharacterArt,
  type CharacterArtRegistry,
  type FacingDir,
} from "../graphics/CharacterArtGenerator";
import {
  createRoomDynamicDecor,
  generateAllRoomTextures,
  getConditionalPropTextureKey,
  getProceduralRoomTextureKey,
} from "../graphics/RoomArtGenerator";
import { DomOverlay } from "../ui/DomOverlay";
import { SCENE_GAME } from "./BootScene";

interface GameSceneInitData {
  data: GameDataBundle;
  assetManifest: AssetManifest;
}

interface HotspotRenderEntry {
  spec: HotspotSpec;
  box: Phaser.GameObjects.Rectangle;
}

interface DustMote {
  rect: Phaser.GameObjects.Rectangle;
  vx: number;
  vy: number;
  minX: number;
  maxX: number;
  maxY: number;
}

const VIEWPORT_W = 320;
const WALK_SPEED_PX_PER_SEC = 68;
const WALK_FRAME_DURATION_SEC = 0.16;

export class GameScene extends Phaser.Scene {
  private stateManager!: StateManager;
  private domOverlay!: DomOverlay;
  private charArt!: CharacterArtRegistry;
  private availableRooms: Set<string> = new Set();
  private availablePortraits: string[] = [];

  private currentRoom!: RoomSpec;

  // World layers
  private bgLayer!: Phaser.GameObjects.Container;
  private propLayer!: Phaser.GameObjects.Container;
  private hotspotLayer!: Phaser.GameObjects.Container;
  private lightingLayer!: Phaser.GameObjects.Container;
  private highlightLayer!: Phaser.GameObjects.Container;

  // Dynamic room decor & NPCs (cleaned up on room change / hotspot rebuild)
  private roomDecorObjects: Phaser.GameObjects.GameObject[] = [];
  private npcVisuals: Phaser.GameObjects.Container[] = [];

  // Player (Tereza)
  private playerContainer!: Phaser.GameObjects.Container;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private playerSprite!: Phaser.GameObjects.Image;
  private playerFacing: FacingDir = "right";
  private playerWalkFrame: 0 | 1 | 2 | 3 = 0;
  private walkTarget: Point2D | null = null;
  private onWalkArrive: (() => void) | null = null;
  private walkAnimAccum = 0;

  // Dynamic room visuals
  private hoveredHotspot: HotspotRenderEntry | null = null;
  private dustMotes: DustMote[] = [];
  private heatHazeOverlay: Phaser.GameObjects.Rectangle | null = null;
  private elapsedTime = 0;

  // Highlight state (Tab or Space)
  private highlightKeysHeld = false;
  private pointerHandledByHotspot = false;
  private windowBlurHandler: (() => void) | null = null;

  constructor() {
    super(SCENE_GAME);
  }

  public init(initData: GameSceneInitData): void {
    this.stateManager = new StateManager(initData.data);
    this.availableRooms = new Set(initData.assetManifest.rooms);
    this.availablePortraits = initData.assetManifest.portraits;
  }

  public create(): void {
    this.input.mouse?.disableContextMenu();

    // Pre-generate crisp procedural pixel-art room backdrops, conditional props, characters & portraits
    generateAllRoomTextures(this, this.stateManager.data.rooms.rooms);
    this.charArt = generateCharacterArt(
      this,
      this.stateManager.data.entities,
      new Set(this.availablePortraits)
    );

    this.bgLayer = this.add.container(0, 0).setDepth(10);
    this.propLayer = this.add.container(0, 0).setDepth(25);
    this.createPlayer();
    this.hotspotLayer = this.add.container(0, 0).setDepth(60);
    this.lightingLayer = this.add.container(0, 0).setDepth(70);
    this.highlightLayer = this.add.container(0, 0).setDepth(90).setVisible(false);

    const mountRoot = document.getElementById("ui-overlay");
    if (!mountRoot) {
      throw new Error("Missing #ui-overlay mount element in index.html");
    }

    this.domOverlay = new DomOverlay(
      mountRoot,
      this.stateManager,
      {
        onSelectItem: () => {
          this.blurActiveDomButton();
        },
        onExamineItem: (itemId) => {
          this.blurActiveDomButton();
          this.examineInventoryItem(itemId);
        },
        onRestartGame: () => {
          this.blurActiveDomButton();
          this.restartDemo();
        },
        onToggleMute: () => {
          this.blurActiveDomButton();
          audioEngine.unlock();
          return audioEngine.toggleMute();
        },
        onUiClick: () => {
          this.blurActiveDomButton();
          audioEngine.unlock();
          audioEngine.playUiClick();
        },
        onJournalToggle: (open) => {
          this.blurActiveDomButton();
          audioEngine.unlock();
          audioEngine.playJournalPaper(open);
        },
        onTypewriterBlip: (speaker) => {
          audioEngine.playTextBlip(speaker);
        },
      },
      this.charArt
    );
    this.domOverlay.setMutedState(audioEngine.isMuted());

    this.setupInputs();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cleanupSceneResources();
    });

    this.enterRoom(this.stateManager.state.active_room, undefined);
  }

  public update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.elapsedTime += dt;

    this.updatePlayerMovement(dt);
    this.updateAmbientEffects(dt);
  }

  private cleanupSceneResources(): void {
    this.destroyRoomDecor();
    this.destroyNpcVisuals();
    if (this.windowBlurHandler) {
      window.removeEventListener("blur", this.windowBlurHandler);
      this.windowBlurHandler = null;
    }
    this.domOverlay?.destroy();
    audioEngine.stopAll();
  }

  private blurActiveDomButton(): void {
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement) {
      active.blur();
    }
  }

  private createPlayer(): void {
    const initialKey = this.charArt.getTerezaTextureKey("ACT_1", this.playerFacing, 0);
    this.playerContainer = this.add.container(160, 146).setDepth(55);
    this.playerShadow = this.add.ellipse(0, -1, 11, 4, 0x090605, 0.34);
    this.playerSprite = this.add.image(0, 0, initialKey).setOrigin(0.5, 1);
    this.playerContainer.add([this.playerShadow, this.playerSprite]);
  }

  private updatePlayerTexture(): void {
    const act = this.currentRoom?.act ?? "ACT_1";
    const texKey = this.charArt.getTerezaTextureKey(act, this.playerFacing, this.playerWalkFrame);
    if (this.playerSprite.texture.key !== texKey && this.textures.exists(texKey)) {
      this.playerSprite.setTexture(texKey);
    }
  }

  private setupInputs(): void {
    // Clear hover tooltip when pointer exits canvas
    this.input.on("gameout", () => {
      this.clearHoveredHotspot();
      this.domOverlay.showTooltip(null);
    });

    // World floor click & global advance click (only when no interactive hotspot handled it)
    this.input.on(
      "pointerdown",
      (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        audioEngine.unlock();

        if (this.pointerHandledByHotspot) {
          this.pointerHandledByHotspot = false;
          return;
        }
        if (currentlyOver.length > 0) {
          return;
        }

        if (this.domOverlay.isCutsceneActive() || this.domOverlay.isDialogueActive()) {
          if (!pointer.rightButtonDown()) {
            this.domOverlay.handleAdvanceInput();
          }
          return;
        }

        if (this.domOverlay.isJournalOpen()) {
          return;
        }

        // Close inventory drawer if user clicks in the room
        if (this.domOverlay.isInventoryOpen()) {
          this.domOverlay.closeTransientMenus();
          return;
        }

        // Right-click on empty space deselects armed item
        if (pointer.rightButtonDown()) {
          if (this.domOverlay.getSelectedItem()) {
            this.domOverlay.setSelectedItem(null);
            audioEngine.playUiClick();
          }
          return;
        }

        // Left-click walks Tereza inside walkable_polygon
        const clamped = clampPointToPolygon(
          pointer.worldX,
          pointer.worldY,
          this.currentRoom.walkable_polygon
        );
        this.startWalkingTo(clamped, null);
      }
    );

    // Keyboard bindings (Tab / Space highlight & advance, J journal, I inventory, Esc, 1-3 options)
    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      audioEngine.unlock();

      if (event.code === "Tab" || event.code === "Space") {
        event.preventDefault();
      }

      if (event.code === "Space" || event.code === "Enter") {
        if (this.domOverlay.isCutsceneActive() || this.domOverlay.isDialogueActive()) {
          event.preventDefault();
          this.blurActiveDomButton();
          this.domOverlay.handleAdvanceInput();
          return;
        }
      }

      if (event.code === "Digit1" || event.code === "Numpad1") {
        if (this.domOverlay.handleOptionHotkey(0)) return;
      } else if (event.code === "Digit2" || event.code === "Numpad2") {
        if (this.domOverlay.handleOptionHotkey(1)) return;
      } else if (event.code === "Digit3" || event.code === "Numpad3") {
        if (this.domOverlay.handleOptionHotkey(2)) return;
      }

      if (event.code === "KeyJ") {
        this.setHotspotHighlight(false);
        this.domOverlay.toggleJournal();
        return;
      }

      if (event.code === "KeyI") {
        this.setHotspotHighlight(false);
        this.domOverlay.toggleInventory();
        return;
      }

      if (event.code === "Escape") {
        if (this.domOverlay.getSelectedItem()) {
          this.domOverlay.setSelectedItem(null);
          audioEngine.playUiClick();
        } else {
          this.domOverlay.closeTransientMenus();
        }
        return;
      }

      if (
        (event.code === "Tab" || event.code === "Space") &&
        !this.domOverlay.isBlockingWorldInput()
      ) {
        this.setHotspotHighlight(true);
      }
    });

    this.input.keyboard?.on("keyup", (event: KeyboardEvent) => {
      if (event.code === "Tab" || event.code === "Space") {
        this.setHotspotHighlight(false);
      }
    });

    this.windowBlurHandler = () => {
      this.setHotspotHighlight(false);
      this.clearHoveredHotspot();
      this.domOverlay.showTooltip(null);
    };
    window.addEventListener("blur", this.windowBlurHandler);
  }

  private setHotspotHighlight(active: boolean): void {
    if (this.highlightKeysHeld === active) return;
    this.highlightKeysHeld = active;
    this.highlightLayer.setVisible(active);
  }

  private clearHoveredHotspot(): void {
    if (!this.hoveredHotspot) return;
    this.hoveredHotspot.box.setStrokeStyle(1, 0xf5dc84, 0);
    this.hoveredHotspot.box.setFillStyle(0xf5dc84, 0.001);
    this.hoveredHotspot = null;
  }

  private destroyRoomDecor(): void {
    for (const obj of this.roomDecorObjects) {
      obj.destroy();
    }
    this.roomDecorObjects = [];
  }

  private destroyNpcVisuals(): void {
    for (const container of this.npcVisuals) {
      container.destroy();
    }
    this.npcVisuals = [];
  }

  private enterRoom(roomId: RoomId, fromRoomId: RoomId | undefined): void {
    this.stateManager.state.active_room = roomId;
    const isFirstVisit = this.stateManager.markRoomVisited(roomId);
    this.currentRoom = this.stateManager.getRoom(roomId);

    this.walkTarget = null;
    this.onWalkArrive = null;
    this.playerWalkFrame = 0;
    this.walkAnimAccum = 0;
    this.setHotspotHighlight(false);
    this.clearHoveredHotspot();
    this.domOverlay.closeTransientMenus();
    this.domOverlay.showTooltip(null);

    // Sync ASMR ambience + cozy lo-fi music state for this room
    audioEngine.setRoomAudio(
      this.currentRoom.atmosphere.audio.ambient_loop,
      this.currentRoom.act,
      this.stateManager.state.flags
    );

    // Configure world camera bounds and scrolling (R06_PATIO is 480x180)
    const { width, height } = this.currentRoom.world_size;
    this.cameras.main.setBounds(0, 0, width, height);

    // Position player at room spawn
    const spawnKey = fromRoomId ? `from_${fromRoomId}` : "default";
    const spawnCoords =
      this.currentRoom.spawns[spawnKey] ?? this.currentRoom.spawns["default"] ?? [160, 146];
    const clampedSpawn = clampPointToPolygon(
      spawnCoords[0],
      spawnCoords[1],
      this.currentRoom.walkable_polygon
    );
    this.playerContainer.setPosition(clampedSpawn.x, clampedSpawn.y);
    this.applyPlayerDepthScale();
    this.updatePlayerTexture();

    if (this.currentRoom.scrolling) {
      this.cameras.main.startFollow(this.playerContainer, true, 0.14, 0.14);
    } else {
      this.cameras.main.stopFollow();
      this.cameras.main.setScroll(0, 0);
    }

    this.renderRoomBackdrop();
    this.renderLightingLayers();
    this.rebuildHotspots();
    this.domOverlay.refreshHud();

    // First-visit black-screen intro audio (e.g. DLG_R03_INTRO_AUDIO before showing R03_CABANA)
    if (isFirstVisit) {
      const introId = this.stateManager.findIntroCutsceneForRoom(roomId);
      if (introId) {
        const entry = this.stateManager.getDialogue(introId);
        if (entry.type === "cutscene_black_screen") {
          if (entry.sfx) {
            audioEngine.playCue(entry.sfx);
          }
          this.domOverlay.playBlackScreenCutscene(
            entry.lines,
            () => {
              this.handleEffectsAfterDialogue(entry.effects, roomId);
            },
            entry.sfx
          );
        }
      }
    }
  }

  private renderRoomBackdrop(): void {
    this.bgLayer.removeAll(true);
    this.destroyRoomDecor();

    const { width, height } = this.currentRoom.world_size;
    const phase2TexKey = `room_bg_${this.currentRoom.id}`;
    const hasPhase2Art =
      this.availableRooms.has(this.currentRoom.id) && this.textures.exists(phase2TexKey);

    const activeTexKey = hasPhase2Art
      ? phase2TexKey
      : getProceduralRoomTextureKey(this.currentRoom.id);

    const artImg = this.add
      .image(0, 0, activeTexKey)
      .setOrigin(0, 0)
      .setDisplaySize(width, height);
    this.bgLayer.add(artImg);

    // Mount subtle room-specific dynamic ambient decor (gleams, swaying wildflowers, Geiger LED, sconces, flecks)
    const decor = createRoomDynamicDecor(this, this.currentRoom);
    for (const obj of decor) {
      const depthObj = obj as Phaser.GameObjects.GameObject & { setDepth?: (value: number) => unknown };
      depthObj.setDepth?.(20);
    }
    this.roomDecorObjects = decor;
  }

  private renderLightingLayers(): void {
    this.lightingLayer.removeAll(true);
    this.dustMotes = [];
    this.heatHazeOverlay = null;

    const { width, height } = this.currentRoom.world_size;

    for (const layer of this.currentRoom.atmosphere.lighting_layers) {
      const type = String(layer["type"] ?? "");
      const alpha = typeof layer["alpha"] === "number" ? layer["alpha"] : 0.2;
      const colorHex = typeof layer["color"] === "string" ? layer["color"] : "#e8dcb8";
      const colorNum = hexToNumber(colorHex, 0xe8dcb8);
      const origin = Array.isArray(layer["origin"])
        ? (layer["origin"] as [number, number])
        : ([width / 2, 24] as [number, number]);

      if (type === "light_shafts" || type === "window_keylight") {
        const g = this.add.graphics();
        g.fillStyle(colorNum, alpha * 0.45);
        g.fillTriangle(
          origin[0],
          origin[1],
          origin[0] - 46,
          height,
          origin[0] + 34,
          height
        );
        this.lightingLayer.add(g);
      } else if (type === "morning_window_glow" || type === "harsh_sun_glare") {
        const glow = this.add.circle(origin[0], origin[1], 54, colorNum, alpha * 0.45);
        this.lightingLayer.add(glow);
      } else if (type === "under_door_slit") {
        const g = this.add.graphics();
        g.fillStyle(colorNum, alpha * 0.45);
        g.fillTriangle(
          origin[0] - 20,
          origin[1],
          origin[0] + 20,
          origin[1],
          origin[0] + 44,
          height
        );
        g.fillTriangle(
          origin[0] - 20,
          origin[1],
          origin[0] - 44,
          height,
          origin[0] + 44,
          height
        );
        this.lightingLayer.add(g);
      } else if (type === "overcast_wash") {
        const wash = this.add.rectangle(0, 0, width, height, colorNum, alpha * 0.45).setOrigin(0);
        this.lightingLayer.add(wash);
      } else if (type === "heat_haze_shader") {
        const intensity = typeof layer["intensity"] === "number" ? layer["intensity"] : 0.1;
        this.heatHazeOverlay = this.add
          .rectangle(0, 0, width, height, 0xf2d9a0, intensity * 0.35)
          .setOrigin(0);
        this.lightingLayer.add(this.heatHazeOverlay);
      } else if (type === "particles_dust") {
        for (let i = 0; i < 10; i++) {
          const rect = this.add.rectangle(
            (i * 31) % width,
            16 + ((i * 19) % Math.max(1, height - 24)),
            1,
            1,
            0xe6dfd0,
            0.35
          );
          this.lightingLayer.add(rect);
          this.dustMotes.push({
            rect,
            vx: 3.5 + (i % 4) * 1.2,
            vy: 2.5 + (i % 3) * 1.0,
            minX: 0,
            maxX: width,
            maxY: height,
          });
        }
      } else if (type === "vignette") {
        const strength = typeof layer["strength"] === "number" ? layer["strength"] : 0.35;
        const g = this.add.graphics();
        g.setScrollFactor(0);
        const edgeAlpha = Math.min(0.42, strength * 0.48);
        g.fillStyle(0x000000, edgeAlpha);
        g.fillRect(0, 0, 10, height);
        g.fillRect(VIEWPORT_W - 10, 0, 10, height);
        g.fillStyle(0x000000, edgeAlpha * 0.45);
        g.fillRect(10, 0, 10, height);
        g.fillRect(VIEWPORT_W - 20, 0, 10, height);
        this.lightingLayer.add(g);
      }
    }
  }

  private rebuildHotspots(): void {
    this.hotspotLayer.removeAll(true);
    this.propLayer.removeAll(true);
    this.highlightLayer.removeAll(true);
    this.destroyNpcVisuals();
    this.hoveredHotspot = null;
    this.domOverlay.showTooltip(null);

    const visibleHotspots = this.stateManager.getVisibleHotspots(this.currentRoom.id);

    for (const hs of visibleHotspots) {
      const [bx, by, bw, bh] = hs.bounds;

      // 1. Conditional prop sprite (exact bounds alignment when visible_if == true)
      const propTexKey = getConditionalPropTextureKey(hs.id);
      if (propTexKey && this.textures.exists(propTexKey)) {
        const propImg = this.add
          .image(bx, by, propTexKey)
          .setOrigin(0, 0)
          .setDisplaySize(bw, bh);
        this.propLayer.add(propImg);
      }

      // 2. NPC pixel-art sprite anchored at bottom-center of bounds with foot shadow & depth sorting
      if (hs.type === "npc") {
        const entityId = this.charArt.resolveHotspotNpcEntity(hs.id);
        if (entityId) {
          const npcTexKey = this.charArt.getNpcTextureKey(entityId, this.currentRoom.act);
          if (npcTexKey && this.textures.exists(npcTexKey)) {
            const footX = Math.round(bx + bw / 2);
            const footY = Math.round(by + bh);
            const npcScale = computeDepthScale(footY, this.currentRoom.depth_scale);
            const npcContainer = this.add
              .container(footX, footY)
              .setScale(npcScale)
              .setDepth(40 + Math.round(footY * 0.1));

            const shadow = this.add.ellipse(0, -1, 11, 4, 0x090605, 0.34);
            const sprite = this.add.image(0, 0, npcTexKey).setOrigin(0.5, 1);
            npcContainer.add([shadow, sprite]);
            this.npcVisuals.push(npcContainer);
          }
        }
      }

      // 3. Invisible interactive hitbox with subtle hover border shimmer (zero static boxes or text)
      const box = this.add
        .rectangle(bx, by, bw, bh, 0xf5dc84, 0.001)
        .setOrigin(0, 0)
        .setStrokeStyle(1, 0xf5dc84, 0)
        .setInteractive({ useHandCursor: true });

      const entry: HotspotRenderEntry = { spec: hs, box };

      box.on("pointerover", (pointer: Phaser.Input.Pointer) => {
        if (this.domOverlay.isBlockingWorldInput()) return;
        this.clearHoveredHotspot();
        this.hoveredHotspot = entry;
        box.setStrokeStyle(1, 0xf5dc84, 0.72);
        box.setFillStyle(0xf5dc84, 0.06);
        const { x, y } = this.getPointerClientCoords(pointer);
        this.domOverlay.showTooltip(hs.label, this.buildHotspotVerbHint(hs), x, y);
      });

      box.on("pointermove", (pointer: Phaser.Input.Pointer) => {
        if (this.domOverlay.isBlockingWorldInput()) {
          if (this.hoveredHotspot === entry) {
            this.clearHoveredHotspot();
          }
          this.domOverlay.showTooltip(null);
          return;
        }
        if (this.hoveredHotspot !== entry) {
          this.clearHoveredHotspot();
          this.hoveredHotspot = entry;
          box.setStrokeStyle(1, 0xf5dc84, 0.72);
          box.setFillStyle(0xf5dc84, 0.06);
        }
        const { x, y } = this.getPointerClientCoords(pointer);
        this.domOverlay.showTooltip(hs.label, this.buildHotspotVerbHint(hs), x, y);
      });

      box.on("pointerout", () => {
        if (this.hoveredHotspot === entry) {
          this.clearHoveredHotspot();
        } else {
          box.setStrokeStyle(1, 0xf5dc84, 0);
          box.setFillStyle(0xf5dc84, 0.001);
        }
        this.domOverlay.showTooltip(null);
      });

      box.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        audioEngine.unlock();
        this.pointerHandledByHotspot = true;

        if (this.domOverlay.isCutsceneActive() || this.domOverlay.isDialogueActive()) {
          if (!pointer.rightButtonDown()) {
            this.domOverlay.handleAdvanceInput();
          }
          return;
        }
        if (this.domOverlay.isJournalOpen()) return;
        if (this.domOverlay.isInventoryOpen()) {
          this.domOverlay.closeTransientMenus();
          return;
        }

        if (pointer.rightButtonDown()) {
          if (this.domOverlay.getSelectedItem()) {
            this.domOverlay.setSelectedItem(null);
            audioEngine.playUiClick();
            const { x, y } = this.getPointerClientCoords(pointer);
            this.domOverlay.showTooltip(hs.label, this.buildHotspotVerbHint(hs), x, y);
            return;
          }
          this.executeHotspotRightClick(hs);
        } else {
          const target = clampPointToPolygon(
            hs.walk_to[0],
            hs.walk_to[1],
            this.currentRoom.walkable_polygon
          );
          this.startWalkingTo(target, () => {
            this.playerFacing = hs.facing;
            this.playerWalkFrame = 0;
            this.updatePlayerTexture();
            this.executeHotspotLeftClick(hs);
          });
        }
      });

      this.hotspotLayer.add(box);

      // 4. Tab / Space highlight outline ONLY (subtle glowing pixel border, ZERO text on canvas)
      const hlOuter = this.add
        .rectangle(bx - 1, by - 1, bw + 2, bh + 2, 0xf5dc84, 0)
        .setOrigin(0, 0)
        .setStrokeStyle(1, 0xffe999, 0.35);
      const hlInner = this.add
        .rectangle(bx, by, bw, bh, 0xf5dc84, 0.1)
        .setOrigin(0, 0)
        .setStrokeStyle(1, 0xf5dc84, 0.92);
      this.highlightLayer.add([hlOuter, hlInner]);
    }
  }

  private getPointerClientCoords(pointer: Phaser.Input.Pointer): { x?: number; y?: number } {
    const ev = pointer.event;
    if (ev && "clientX" in ev && "clientY" in ev) {
      return { x: ev.clientX, y: ev.clientY };
    }
    return {};
  }

  private buildHotspotVerbHint(hs: HotspotSpec): string {
    const selected = this.domOverlay.getSelectedItem();
    if (selected) {
      const itemName = this.stateManager.getItemSpec(selected)?.name ?? selected;
      return `Esq: Usar ${itemName} · Dir: Cancelar`;
    }
    const leftVerb = hs.type === "exit" ? "Ir" : hs.type === "npc" ? "Falar" : "Interagir";
    return `Esq: ${leftVerb} · Dir: Examinar`;
  }

  private startWalkingTo(target: Point2D, onArrive: (() => void) | null): void {
    const dx = target.x - this.playerContainer.x;
    const dy = target.y - this.playerContainer.y;
    if (Math.hypot(dx, dy) <= 2.5) {
      this.playerContainer.setPosition(target.x, target.y);
      this.applyPlayerDepthScale();
      this.playerWalkFrame = 0;
      this.walkAnimAccum = 0;
      this.updatePlayerTexture();
      this.walkTarget = null;
      this.onWalkArrive = null;
      if (onArrive) onArrive();
      return;
    }

    this.walkTarget = target;
    this.onWalkArrive = onArrive;
  }

  private updatePlayerMovement(dt: number): void {
    if (!this.walkTarget) return;

    const dx = this.walkTarget.x - this.playerContainer.x;
    const dy = this.walkTarget.y - this.playerContainer.y;
    const dist = Math.hypot(dx, dy);

    if (Math.abs(dx) >= Math.abs(dy)) {
      this.playerFacing = dx < 0 ? "left" : "right";
    } else {
      this.playerFacing = dy < 0 ? "up" : "down";
    }

    const step = WALK_SPEED_PX_PER_SEC * dt;
    if (dist <= step) {
      this.playerContainer.setPosition(this.walkTarget.x, this.walkTarget.y);
      this.applyPlayerDepthScale();
      this.playerWalkFrame = 0;
      this.walkAnimAccum = 0;
      this.updatePlayerTexture();
      const cb = this.onWalkArrive;
      this.walkTarget = null;
      this.onWalkArrive = null;
      if (cb) cb();
      return;
    }

    const nx = this.playerContainer.x + (dx / dist) * step;
    const ny = this.playerContainer.y + (dy / dist) * step;
    const clamped = clampPointToPolygon(nx, ny, this.currentRoom.walkable_polygon);
    this.playerContainer.setPosition(clamped.x, clamped.y);
    this.applyPlayerDepthScale();

    // Smooth 4-frame walk cycle (0 -> 1 -> 2 -> 3 -> 0) synced with surface footsteps
    this.walkAnimAccum += dt;
    if (this.walkAnimAccum >= WALK_FRAME_DURATION_SEC) {
      this.walkAnimAccum -= WALK_FRAME_DURATION_SEC;
      this.playerWalkFrame = ((this.playerWalkFrame + 1) % 4) as 0 | 1 | 2 | 3;
      if (this.playerWalkFrame === 1 || this.playerWalkFrame === 3) {
        audioEngine.playFootstep(this.currentRoom.atmosphere.audio.footstep_surface);
      }
    }
    this.updatePlayerTexture();
  }

  private applyPlayerDepthScale(): void {
    const scale = computeDepthScale(this.playerContainer.y, this.currentRoom.depth_scale);
    this.playerContainer.setScale(scale);
    this.playerContainer.setDepth(40 + Math.round(this.playerContainer.y * 0.1));
  }

  private updateAmbientEffects(dt: number): void {
    for (const mote of this.dustMotes) {
      mote.rect.x += mote.vx * dt;
      mote.rect.y += mote.vy * dt;
      if (mote.rect.x > mote.maxX) mote.rect.x = mote.minX;
      if (mote.rect.y > mote.maxY) mote.rect.y = 16;
    }

    if (this.heatHazeOverlay) {
      this.heatHazeOverlay.setAlpha(0.03 + Math.sin(this.elapsedTime * 3.2) * 0.02);
    }

    if (this.highlightKeysHeld) {
      this.highlightLayer.setAlpha(0.75 + Math.sin(this.elapsedTime * 6) * 0.25);
    }

    if (this.hoveredHotspot) {
      if (this.domOverlay.isBlockingWorldInput()) {
        this.clearHoveredHotspot();
      } else {
        const shimmerAlpha = 0.52 + Math.sin(this.elapsedTime * 5.2) * 0.22;
        this.hoveredHotspot.box.setStrokeStyle(1, 0xf5dc84, shimmerAlpha);
      }
    }
  }

  private executeHotspotRightClick(hs: HotspotSpec): void {
    this.walkTarget = null;
    this.onWalkArrive = null;
    this.playerWalkFrame = 0;
    this.walkAnimAccum = 0;
    const centerX = hs.bounds[0] + hs.bounds[2] / 2;
    this.playerFacing = centerX < this.playerContainer.x ? "left" : "right";
    this.updatePlayerTexture();

    const examineId = hs.interactions?.examine;
    if (examineId) {
      this.runDialogueOrEvent(examineId);
      return;
    }

    if (hs.type === "exit") {
      this.clearHoveredHotspot();
      this.domOverlay.showLines([{ speaker: "TEREZA", text: `${hs.label}.` }], () => {
        this.domOverlay.refreshHud();
      });
    }
  }

  private executeHotspotLeftClick(hs: HotspotSpec): void {
    const selectedItem = this.domOverlay.getSelectedItem();
    if (selectedItem) {
      this.domOverlay.setSelectedItem(null);
      const useTarget = hs.interactions?.use_item?.[selectedItem];
      if (useTarget) {
        this.runDialogueOrEvent(useTarget);
      } else {
        this.clearHoveredHotspot();
        this.domOverlay.showLines(
          [{ speaker: "TEREZA", text: this.stateManager.getFallbackResponse("wrong_item") }],
          () => {
            this.domOverlay.refreshHud();
          }
        );
      }
      return;
    }

    if (hs.type === "exit") {
      if (hs.override_event_if && this.stateManager.evaluate(hs.override_event_if.condition)) {
        this.runDialogueOrEvent(hs.override_event_if.event);
        return;
      }

      if (this.stateManager.evaluate(hs.requires)) {
        const prevRoom = this.currentRoom.id;
        const targetRoom = hs.target_room;
        if (!targetRoom) return;

        if (hs.triggers_cutscene) {
          const act = this.stateManager.getAct(hs.triggers_cutscene);
          if (act && act.type === "static_cutscene_4_panels") {
            this.clearHoveredHotspot();
            this.domOverlay.playInterludeAct(act, () => {
              this.enterRoom(targetRoom, prevRoom);
            });
            return;
          }
        }
        this.enterRoom(targetRoom, prevRoom);
      } else if (hs.blocked_dialogue) {
        this.runDialogueOrEvent(hs.blocked_dialogue);
      } else {
        this.clearHoveredHotspot();
        this.domOverlay.showLines(
          [{ speaker: "TEREZA", text: this.stateManager.getFallbackResponse("default_locked") }],
          () => {
            this.domOverlay.refreshHud();
          }
        );
      }
      return;
    }

    const interactId = hs.interactions?.interact ?? hs.interactions?.examine;
    if (interactId) {
      this.runDialogueOrEvent(interactId);
    }
  }

  private examineInventoryItem(itemId: ItemId): void {
    const spec = this.stateManager.getItemSpec(itemId);
    if (!spec) return;
    this.clearHoveredHotspot();
    this.domOverlay.showLines([{ speaker: "TEREZA", text: `${spec.name}: ${spec.description}` }], () => {
      this.domOverlay.refreshHud();
    });
  }

  private runDialogueOrEvent(id: string): void {
    const entry: DialogueEntry = this.stateManager.getDialogue(id);
    const originRoom = this.currentRoom.id;

    this.setHotspotHighlight(false);
    this.clearHoveredHotspot();
    this.domOverlay.showTooltip(null);

    // Instant horror silence on the Act II confrontation climax
    if (id === "EVT_R06_CONFRONTO_MARK_DILAN") {
      audioEngine.cutMusicAbruptly();
    }

    if (entry.type === "linear" || entry.type === "event") {
      if (entry.sfx) {
        audioEngine.playCue(entry.sfx);
      }
      this.domOverlay.showLines(
        entry.lines,
        () => {
          this.handleEffectsAfterDialogue(entry.effects, originRoom);
        },
        entry.sfx
      );
      return;
    }

    if (entry.type === "cutscene_black_screen") {
      if (entry.sfx) {
        audioEngine.playCue(entry.sfx);
      }
      this.domOverlay.playBlackScreenCutscene(
        entry.lines,
        () => {
          this.handleEffectsAfterDialogue(entry.effects, originRoom);
        },
        entry.sfx
      );
      return;
    }

    if (entry.type === "conditional_event") {
      const branch = this.stateManager.evaluate(entry.condition) ? entry.if_true : entry.if_false;
      this.domOverlay.showLines(branch.lines, () => {
        this.handleEffectsAfterDialogue(branch.effects, originRoom);
      });
      return;
    }

    if (entry.type === "branching") {
      let pendingTransition: RoomId | undefined;
      let pendingCutscene: string | undefined;

      const stepNode = (nodeId: string): void => {
        if (nodeId === "END") {
          this.domOverlay.clearDialogue();
          this.domOverlay.refreshHud();
          if (pendingCutscene) {
            this.triggerCutsceneAndTransition(pendingCutscene, pendingTransition, originRoom);
          } else if (pendingTransition) {
            this.enterRoom(pendingTransition, originRoom);
          } else {
            this.rebuildHotspots();
          }
          return;
        }

        const node = entry.nodes[nodeId];
        if (!node) {
          stepNode("END");
          return;
        }

        const applyNodeEffects = (): void => {
          const applied = this.stateManager.applyEffects(node.effects);
          this.syncAudioWithFlags();
          if (applied.addedEvidences.length > 0) {
            this.domOverlay.notifyNewEvidence(
              applied.addedEvidences[applied.addedEvidences.length - 1]
            );
          }
          if (applied.transitionRoom) pendingTransition = applied.transitionRoom;
          if (applied.triggerCutscene) pendingCutscene = applied.triggerCutscene;
          this.domOverlay.refreshHud();
        };

        this.domOverlay.showBranchNode(
          node,
          (chosenNext) => {
            applyNodeEffects();
            stepNode(chosenNext);
          },
          () => {
            applyNodeEffects();
            stepNode(node.next ?? "END");
          }
        );
      };

      stepNode(entry.entry_node);
    }
  }

  private syncAudioWithFlags(): void {
    const flags = this.stateManager.state.flags;
    if (flags.FLAG_JADEN_VISTO || flags.FLAG_PORTA_TRANCADA) {
      audioEngine.cutMusicAbruptly();
    }
    audioEngine.syncNarrativeTension(flags);
  }

  private handleEffectsAfterDialogue(effects: StateEffects | undefined, originRoom: RoomId): void {
    const applied = this.stateManager.applyEffects(effects);
    this.syncAudioWithFlags();

    if (applied.addedEvidences.length > 0) {
      this.domOverlay.notifyNewEvidence(applied.addedEvidences[applied.addedEvidences.length - 1]);
    }
    this.domOverlay.refreshHud();

    if (applied.triggerCutscene) {
      this.triggerCutsceneAndTransition(applied.triggerCutscene, applied.transitionRoom, originRoom);
      return;
    }

    if (applied.transitionRoom) {
      this.enterRoom(applied.transitionRoom, originRoom);
      return;
    }

    this.rebuildHotspots();
  }

  private triggerCutsceneAndTransition(
    cutsceneId: string,
    transitionRoom: RoomId | undefined,
    originRoom: RoomId
  ): void {
    const act = this.stateManager.getAct(cutsceneId);
    if (act && act.type === "ending_sequence") {
      audioEngine.cutMusicAbruptly();
      this.domOverlay.playEndingAct(act);
      return;
    }
    if (act && act.type === "static_cutscene_4_panels") {
      this.domOverlay.playInterludeAct(act, () => {
        if (transitionRoom) {
          this.enterRoom(transitionRoom, originRoom);
        } else {
          this.rebuildHotspots();
        }
      });
      return;
    }
    if (transitionRoom) {
      this.enterRoom(transitionRoom, originRoom);
    } else {
      this.rebuildHotspots();
    }
  }

  private restartDemo(): void {
    this.stateManager.reset();
    this.domOverlay.setSelectedItem(null);
    this.enterRoom(this.stateManager.state.active_room, undefined);
  }
}
