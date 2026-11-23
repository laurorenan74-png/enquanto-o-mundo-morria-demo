import type {
  DialoguesDataFile,
  EntitiesDataFile,
  EntityId,
  EvidenceId,
  FlagKey,
  GameState,
  ItemId,
  JournalDataFile,
  RoomId,
  RoomsDataFile,
  StateEffects,
} from "../types";

export interface ItemSpec {
  id: ItemId;
  name: string;
  act: number;
  origin_room: RoomId;
  consumable: boolean;
  description: string;
}

export interface EvidenceSpec {
  id: EvidenceId;
  title: string;
  trigger_node: string;
  room: RoomId;
  journal_text: string;
}

export interface InterludePanel {
  panel: number;
  title: string;
  caption: string;
}

export interface StingerLine {
  speaker: EntityId;
  line: string;
}

export interface ActSpec {
  id: string;
  title: string;
  type?: string;
  rooms?: RoomId[];
  summary?: string;
  panels?: InterludePanel[];
  canon_stinger?: StingerLine[];
  closing_card?: string;
}

export interface DagNodeSpec {
  node_id: string;
  act: string;
  room: RoomId;
  preconditions: string[];
  action: string;
  effects: StateEffects;
}

export interface StoryGraphDataFile {
  schema_version: string;
  sprint: string;
  project: {
    title: string;
    source_title: string;
    source_author: string;
    genre: string[];
    reference_style: string;
    target_engine: string;
    logical_resolution: {
      width: number;
      height: number;
    };
  };
  canon_normalization: {
    timeline_offset: string;
    entity_ids: Record<string, string>;
    world_rules: Record<string, unknown>;
  };
  state_machine_spec: {
    state_tuple: string;
    rooms: RoomId[];
    initial_state: {
      active_room: RoomId;
      inventory: ItemId[];
      flags: Partial<Record<FlagKey, boolean>>;
      evidences: EvidenceId[];
      narrative_clock: number;
    };
  };
  items: ItemSpec[];
  evidences: EvidenceSpec[];
  acts: ActSpec[];
  dag_nodes: DagNodeSpec[];
}

export interface GameDataBundle {
  storyGraph: StoryGraphDataFile;
  rooms: RoomsDataFile;
  dialogues: DialoguesDataFile;
  journal: JournalDataFile;
  entities: EntitiesDataFile;
}

export function createInitialGameState(storyGraph: StoryGraphDataFile): GameState {
  const raw = storyGraph.state_machine_spec.initial_state;
  const allFlagKeys: FlagKey[] = [
    "FLAG_VIDRO_EXAMINADO",
    "FLAG_KIT_PRONTO",
    "FLAG_TOCOU_FLORES",
    "FLAG_CAPTURA_ATO1",
    "FLAG_SABE_TRAVESSIA",
    "FLAG_DILAN_DISTRAIDO",
    "FLAG_ATO1_COMPLETO",
    "FLAG_ODELIA_VISTA",
    "FLAG_REGRAS_RECEBIDAS",
    "FLAG_AMARINA_EXAMINADA",
    "FLAG_AMARINA_FALOU",
    "FLAG_CERCADO_VISTO",
    "FLAG_PATIO_AUDITADO",
    "FLAG_JADEN_VISTO",
    "FLAG_PORTA_TRANCADA",
    "FLAG_DEMO_FIM",
  ];

  const flags = {} as Record<FlagKey, boolean>;
  for (const key of allFlagKeys) {
    flags[key] = Boolean(raw.flags[key]);
  }

  return {
    active_room: raw.active_room,
    inventory: [...raw.inventory],
    flags,
    evidences: [...raw.evidences],
    narrative_clock: raw.narrative_clock,
  };
}
