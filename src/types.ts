// types.ts — Contrato de Tipagem Estrita para /public/game_data/*.json

export type RoomId =
  | "R01_BARRACA"
  | "R02_FLORES"
  | "R03_CABANA"
  | "R04_QUARTO"
  | "R05_CORREDOR"
  | "R06_PATIO";

export type EntityId =
  | "TEREZA"
  | "DILAN"
  | "ODELIA"
  | "JADEN"
  | "AMARINA"
  | "MARK"
  | "ROMENO"
  | "CALEB"
  | "JOSEPH"
  | "SFX";

export type ItemId =
  | "ITEM_BUSSOLA"
  | "ITEM_COMIDA_VENCIDA"
  | "ITEM_FLOR_VENENOSA"
  | "ITEM_PISTOLA_CROMADA"
  | "ITEM_FICHA_TRIAGEM";

export type EvidenceId = "K1" | "K2" | "K3" | "K4" | "K5";

export type FlagKey =
  | "FLAG_VIDRO_EXAMINADO"
  | "FLAG_KIT_PRONTO"
  | "FLAG_TOCOU_FLORES"
  | "FLAG_CAPTURA_ATO1"
  | "FLAG_SABE_TRAVESSIA"
  | "FLAG_DILAN_DISTRAIDO"
  | "FLAG_ATO1_COMPLETO"
  | "FLAG_ODELIA_VISTA"
  | "FLAG_REGRAS_RECEBIDAS"
  | "FLAG_AMARINA_EXAMINADA"
  | "FLAG_AMARINA_FALOU"
  | "FLAG_CERCADO_VISTO"
  | "FLAG_PATIO_AUDITADO"
  | "FLAG_JADEN_VISTO"
  | "FLAG_PORTA_TRANCADA"
  | "FLAG_DEMO_FIM";

export interface GameState {
  active_room: RoomId;
  inventory: ItemId[];
  flags: Record<FlagKey, boolean>;
  evidences: EvidenceId[];
  narrative_clock: number;
}

export interface StateEffects {
  add_items?: ItemId[];
  remove_items?: ItemId[];
  add_evidences?: EvidenceId[];
  set_flags?: Partial<Record<FlagKey, boolean>>;
  set_clock?: number;
  clock_delta?: number;
  transition_room?: RoomId;
  trigger_cutscene?: string;
}

// ---------- Sprint 2: Rooms ----------
export interface RoomSpec {
  id: RoomId;
  name: string;
  act: "ACT_1" | "ACT_2";
  time_of_day: string;
  world_size: { width: number; height: number };
  scrolling: boolean;
  atmosphere: {
    mood: string;
    palette_hex: string[];
    lighting_layers: Array<Record<string, unknown>>;
    audio: {
      ambient_loop: string;
      footstep_surface: "dirt" | "mud" | "wood" | "gravel";
    };
  };
  walkable_polygon: Array<[number, number]>;
  depth_scale: {
    y_min: number;
    y_max: number;
    scale_min: number;
    scale_max: number;
  };
  spawns: Record<string, [number, number]>;
  hotspots: HotspotSpec[];
  art_direction_prompt: string;
}

export interface HotspotSpec {
  id: string;
  label: string;
  type: "object" | "npc" | "exit";
  bounds: [number, number, number, number]; // [x, y, w, h]
  walk_to: [number, number];
  facing: "left" | "right" | "up" | "down";
  visible_if: string;
  linked_dag_nodes: string[];
  target_room?: RoomId;
  requires?: string;
  blocked_dialogue?: string;
  triggers_cutscene?: string;
  override_event_if?: {
    condition: string;
    event: string;
  };
  interactions?: {
    examine?: string;
    interact?: string;
    use_item?: Partial<Record<ItemId, string>>;
  };
}

export interface RoomsDataFile {
  schema_version: string;
  sprint: string;
  rendering_contract: Record<string, unknown>;
  rooms: RoomSpec[];
}

// ---------- Sprint 3: Dialogues ----------
export interface DialogueLine {
  speaker: EntityId;
  text: string;
}

export interface DialogueOption {
  text: string;
  next: string;
}

export interface BranchNode {
  speaker: EntityId;
  text: string;
  options?: DialogueOption[];
  effects?: StateEffects;
  next?: string;
}

export type DialogueEntry =
  | {
      type: "linear" | "event" | "cutscene_black_screen";
      sfx?: string;
      lines: DialogueLine[];
      effects?: StateEffects;
    }
  | {
      type: "branching";
      entry_node: string;
      nodes: Record<string, BranchNode>;
    }
  | {
      type: "conditional_event";
      condition: string;
      if_true: { lines: DialogueLine[]; effects?: StateEffects };
      if_false: { lines: DialogueLine[]; effects?: StateEffects };
    };

export interface DialoguesDataFile {
  schema_version: string;
  sprint: string;
  cadence_rules: {
    max_chars_per_line: number;
    style: string;
    fallback_responses: Record<string, string>;
  };
  dialogues: Record<string, DialogueEntry>;
}

// ---------- Sprint 3: Journal ----------
export interface JournalDataFile {
  schema_version: string;
  sprint: string;
  ui_title: string;
  keyword_headers_by_stage: Array<{
    stage: string;
    keyword: string;
    objective: string;
  }>;
  entries: Array<{
    id: EvidenceId;
    title: string;
    unlocked_by: EvidenceId;
    text: string;
  }>;
}

// ---------- Sprint 0: Entities ----------
export interface EntitySpec {
  id: Exclude<EntityId, "SFX">;
  name: string;
  role: string;
  visual_spec: {
    traits: string;
    bracelet: string | { act_1: string; act_2: string };
  };
  voice_profile: string;
}

export interface EntitiesDataFile {
  schema_version: string;
  entities: EntitySpec[];
}