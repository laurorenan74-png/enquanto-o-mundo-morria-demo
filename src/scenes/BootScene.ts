import Phaser from "phaser";
import assetManifest from "virtual:asset-manifest";
import type {
  DialoguesDataFile,
  EntitiesDataFile,
  JournalDataFile,
  RoomsDataFile,
} from "../types";
import type { GameDataBundle, StoryGraphDataFile } from "../engine/gameData";

export const SCENE_BOOT = "BootScene";
export const SCENE_GAME = "GameScene";

export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE_BOOT);
  }

  public preload(): void {
    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;

    this.cameras.main.setBackgroundColor("#090807");

    // Clean pixel-art progress bar (zero text rendered inside 320x180 canvas)
    const barOuter = this.add
      .rectangle(cx, cy, 124, 10, 0x1a120c)
      .setStrokeStyle(1, 0x633d24);
    const barBg = this.add
      .rectangle(cx, cy, 118, 6, 0x2a1c13)
      .setStrokeStyle(1, 0x8d5a34);
    const barFill = this.add
      .rectangle(cx - 57, cy, 2, 4, 0xd9a74a)
      .setOrigin(0, 0.5);

    this.load.on("progress", (value: number) => {
      barFill.width = Math.max(2, Math.round(114 * value));
    });

    this.load.on("complete", () => {
      barOuter.destroy();
      barBg.destroy();
      barFill.destroy();
    });

    // Core 5 data-driven JSON contracts
    this.load.json("storyGraph", "game_data/sprint1_story_graph.json");
    this.load.json("rooms", "game_data/sprint2_rooms_spec.json");
    this.load.json("dialogues", "game_data/sprint3_dialogues.json");
    this.load.json("journal", "game_data/sprint3_journal.json");
    this.load.json("entities", "game_data/entities.json");

    // Phase 2 automatic art replacement (only loads PNGs verified present by Vite manifest)
    for (const roomId of assetManifest.rooms) {
      this.load.image(`room_bg_${roomId}`, `assets/rooms/${roomId}.png`);
    }
    for (const entityId of assetManifest.portraits) {
      this.load.image(`portrait_${entityId}`, `assets/portraits/${entityId}.png`);
    }
  }

  public create(): void {
    const data: GameDataBundle = {
      storyGraph: this.cache.json.get("storyGraph") as StoryGraphDataFile,
      rooms: this.cache.json.get("rooms") as RoomsDataFile,
      dialogues: this.cache.json.get("dialogues") as DialoguesDataFile,
      journal: this.cache.json.get("journal") as JournalDataFile,
      entities: this.cache.json.get("entities") as EntitiesDataFile,
    };

    this.scene.start(SCENE_GAME, { data, assetManifest });
  }
}
