import type {
  DialogueEntry,
  EntityId,
  EntitySpec,
  EvidenceId,
  FlagKey,
  GameState,
  HotspotSpec,
  ItemId,
  RoomId,
  RoomSpec,
  StateEffects,
} from "../types";
import { evalCondition } from "./expressionEvaluator";
import {
  createInitialGameState,
  type ActSpec,
  type GameDataBundle,
  type ItemSpec,
} from "./gameData";

export interface AppliedEffectsResult {
  addedItems: ItemId[];
  removedItems: ItemId[];
  addedEvidences: EvidenceId[];
  transitionRoom?: RoomId;
  triggerCutscene?: string;
  clockChanged: boolean;
}

export class StateManager {
  public readonly data: GameDataBundle;
  public state: GameState;
  private visitedRooms: Set<RoomId> = new Set();

  constructor(data: GameDataBundle) {
    this.data = data;
    this.state = createInitialGameState(data.storyGraph);
  }

  public reset(): void {
    this.state = createInitialGameState(this.data.storyGraph);
    this.visitedRooms.clear();
  }

  public markRoomVisited(roomId: RoomId): boolean {
    const isFirstVisit = !this.visitedRooms.has(roomId);
    this.visitedRooms.add(roomId);
    return isFirstVisit;
  }

  public hasVisitedRoom(roomId: RoomId): boolean {
    return this.visitedRooms.has(roomId);
  }

  public getRoom(roomId: RoomId = this.state.active_room): RoomSpec {
    const room = this.data.rooms.rooms.find((r) => r.id === roomId);
    if (!room) {
      throw new Error(`Room not found in rooms spec: ${roomId}`);
    }
    return room;
  }

  public getVisibleHotspots(roomId: RoomId = this.state.active_room): HotspotSpec[] {
    const room = this.getRoom(roomId);
    return room.hotspots.filter((hs) => evalCondition(hs.visible_if, this.state));
  }

  public getDialogue(id: string): DialogueEntry {
    const entry = this.data.dialogues.dialogues[id];
    if (!entry) {
      throw new Error(`Dialogue/event not found: ${id}`);
    }
    return entry;
  }

  public findIntroCutsceneForRoom(roomId: RoomId): string | undefined {
    const prefix = roomId.split("_")[0];
    const targetPrefix = `DLG_${prefix}_INTRO`;
    for (const [id, entry] of Object.entries(this.data.dialogues.dialogues)) {
      if (entry.type === "cutscene_black_screen" && id.startsWith(targetPrefix)) {
        return id;
      }
    }
    return undefined;
  }

  public getAct(actId: string): ActSpec | undefined {
    return this.data.storyGraph.acts.find((a) => a.id === actId);
  }

  public getItemSpec(itemId: ItemId): ItemSpec | undefined {
    return this.data.storyGraph.items.find((i) => i.id === itemId);
  }

  public getEntitySpec(entityId: EntityId): EntitySpec | undefined {
    if (entityId === "SFX") return undefined;
    return this.data.entities.entities.find((e) => e.id === entityId);
  }

  public getSpeakerName(speaker: EntityId): string {
    if (speaker === "SFX") return "SOM";
    const entity = this.getEntitySpec(speaker);
    if (entity) return entity.name;
    return this.data.storyGraph.canon_normalization.entity_ids[speaker] ?? speaker;
  }

  public getFallbackResponse(key: string): string {
    return (
      this.data.dialogues.cadence_rules.fallback_responses[key] ??
      this.data.dialogues.cadence_rules.fallback_responses["wrong_item"] ??
      "..."
    );
  }

  public evaluate(expr: string | undefined): boolean {
    return evalCondition(expr, this.state);
  }

  public applyEffects(effects?: StateEffects): AppliedEffectsResult {
    const result: AppliedEffectsResult = {
      addedItems: [],
      removedItems: [],
      addedEvidences: [],
      clockChanged: false,
    };

    if (!effects) return result;

    if (effects.add_items) {
      for (const item of effects.add_items) {
        if (!this.state.inventory.includes(item)) {
          this.state.inventory.push(item);
          result.addedItems.push(item);
        }
      }
    }

    if (effects.remove_items) {
      for (const item of effects.remove_items) {
        const idx = this.state.inventory.indexOf(item);
        if (idx !== -1) {
          this.state.inventory.splice(idx, 1);
          result.removedItems.push(item);
        }
      }
    }

    if (effects.add_evidences) {
      for (const ev of effects.add_evidences) {
        if (!this.state.evidences.includes(ev)) {
          this.state.evidences.push(ev);
          result.addedEvidences.push(ev);
        }
      }
    }

    if (effects.set_flags) {
      for (const [k, v] of Object.entries(effects.set_flags)) {
        this.state.flags[k as FlagKey] = Boolean(v);
      }
    }

    if (typeof effects.set_clock === "number") {
      this.state.narrative_clock = effects.set_clock;
      result.clockChanged = true;
    }

    if (typeof effects.clock_delta === "number") {
      this.state.narrative_clock = Math.max(0, this.state.narrative_clock + effects.clock_delta);
      result.clockChanged = true;
    }

    if (effects.transition_room) {
      this.state.active_room = effects.transition_room;
      result.transitionRoom = effects.transition_room;
    }

    if (effects.trigger_cutscene) {
      result.triggerCutscene = effects.trigger_cutscene;
    }

    return result;
  }

  public getCurrentJournalStage(): { stage: string; keyword: string; objective: string } {
    const headers = this.data.journal.keyword_headers_by_stage;
    const room = this.getRoom();
    let stageId = headers[0]?.stage ?? "ACT_1_START";

    if (room.act === "ACT_1") {
      stageId = this.state.active_room === "R03_CABANA" ? "ACT_1_CABIN" : "ACT_1_START";
    } else if (this.state.flags.FLAG_PORTA_TRANCADA || this.state.evidences.length >= 5) {
      stageId = "ACT_2_CLIMAX";
    } else if (this.state.active_room === "R06_PATIO" || this.state.flags.FLAG_REGRAS_RECEBIDAS) {
      stageId = "ACT_2_YARD";
    } else {
      stageId = "ACT_2_ROOM";
    }

    return headers.find((h) => h.stage === stageId) ?? headers[0];
  }
}
