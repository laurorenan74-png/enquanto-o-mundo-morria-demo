// walkthrough_test.ts — Validador Headless de Caminho Crítico (Zero-Softlock)
// Execução: npx tsx tests/walkthrough_test.ts

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import type {
  GameState,
  StateEffects,
  RoomsDataFile,
  DialoguesDataFile,
  FlagKey,
  ItemId,
  EvidenceId,
} from "../src/types";

const DATA_DIR = path.resolve(process.cwd(), "public/game_data");

const storyGraph = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "sprint1_story_graph.json"), "utf-8")
);
const roomsData: RoomsDataFile = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "sprint2_rooms_spec.json"), "utf-8")
);
const dialoguesData: DialoguesDataFile = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "sprint3_dialogues.json"), "utf-8")
);

function createInitialState(): GameState {
  const base = structuredClone(storyGraph.state_machine_spec.initial_state);
  base.flags.FLAG_CERCADO_VISTO = false;
  return base as GameState;
}

function evalCondition(expr: string | undefined, state: GameState): boolean {
  if (!expr || expr === "true") return true;
  if (expr === "false") return false;
  return expr.split("&&").every((rawPart) => {
    const part = rawPart.trim();
    const itemMatch = part.match(/^(!?)has_item\('([^']+)'\)$/);
    if (itemMatch) {
      const negate = itemMatch[1] === "!";
      const has = state.inventory.includes(itemMatch[2] as ItemId);
      return negate ? !has : has;
    }
    const eqMatch = part.match(/^([A-Z0-9_]+)\s*(==|!=)\s*(true|false)$/);
    if (eqMatch) {
      const flagVal = Boolean(state.flags[eqMatch[1] as FlagKey]);
      const target = eqMatch[3] === "true";
      return eqMatch[2] === "==" ? flagVal === target : flagVal !== target;
    }
    throw new Error(`Unsupported condition expression: ${part}`);
  });
}

function applyEffects(state: GameState, effects?: StateEffects): void {
  if (!effects) return;
  for (const item of effects.add_items ?? []) {
    if (!state.inventory.includes(item)) state.inventory.push(item);
  }
  for (const ev of effects.add_evidences ?? []) {
    if (!state.evidences.includes(ev)) state.evidences.push(ev);
  }
  if (effects.set_flags) {
    for (const [k, v] of Object.entries(effects.set_flags)) {
      state.flags[k as FlagKey] = Boolean(v);
    }
  }
  if (typeof effects.set_clock === "number") {
    state.narrative_clock = effects.set_clock;
  }
  if (typeof effects.clock_delta === "number") {
    state.narrative_clock = Math.max(0, state.narrative_clock + effects.clock_delta);
  }
  if (effects.transition_room) {
    state.active_room = effects.transition_room;
  }
}

function runDialogueOrEvent(state: GameState, id: string, branchPath: string[] = []): void {
  const entry = dialoguesData.dialogues[id];
  assert.ok(entry, `Missing dialogue/event ID: ${id}`);

  if (entry.type === "linear" || entry.type === "event" || entry.type === "cutscene_black_screen") {
    applyEffects(state, entry.effects);
    return;
  }
  if (entry.type === "conditional_event") {
    const branch = evalCondition(entry.condition, state) ? entry.if_true : entry.if_false;
    applyEffects(state, branch.effects);
    return;
  }
  if (entry.type === "branching") {
    let cursor = entry.entry_node;
    let step = 0;
    while (cursor !== "END") {
      const node = entry.nodes[cursor];
      assert.ok(node, `Missing branch node ${cursor} in ${id}`);
      applyEffects(state, node.effects);
      if (node.options && node.options.length > 0) {
        const chosen = branchPath[step++] ?? node.options[0].next;
        cursor = chosen;
      } else {
        cursor = node.next ?? "END";
      }
    }
  }
}

function interactHotspot(
  state: GameState,
  hotspotId: string,
  verb: "examine" | "interact" | "use_item",
  itemId?: ItemId,
  branchPath: string[] = []
): void {
  const room = roomsData.rooms.find((r) => r.id === state.active_room);
  assert.ok(room, `Room not found: ${state.active_room}`);
  const hs = room.hotspots.find((h) => h.id === hotspotId);
  assert.ok(hs, `Hotspot ${hotspotId} not found in ${state.active_room}`);
  assert.ok(evalCondition(hs.visible_if, state), `Hotspot ${hotspotId} is not visible`);

  if (hs.type === "exit" && verb === "interact") {
    if (hs.override_event_if && evalCondition(hs.override_event_if.condition, state)) {
      runDialogueOrEvent(state, hs.override_event_if.event);
      return;
    }
    if (evalCondition(hs.requires, state)) {
      assert.ok(hs.target_room, `Exit ${hotspotId} missing target_room`);
      state.active_room = hs.target_room;
    } else if (hs.blocked_dialogue) {
      runDialogueOrEvent(state, hs.blocked_dialogue);
    }
    return;
  }

  if (verb === "use_item" && itemId) {
    const targetId = hs.interactions?.use_item?.[itemId];
    assert.ok(targetId, `No use_item handler for ${itemId} on ${hotspotId}`);
    runDialogueOrEvent(state, targetId);
    return;
  }

  const targetId = hs.interactions?.[verb as "examine" | "interact"];
  assert.ok(targetId, `No ${verb} handler on ${hotspotId}`);
  runDialogueOrEvent(state, targetId, branchPath);
}

// ================= CRITICAL PATH SIMULATION (N01 -> N14) =================
const state = createInitialState();

// N01 & N02 — R01_BARRACA
interactHotspot(state, "HS_VIDRO_QUEBRADO", "examine");
interactHotspot(state, "HS_MOCHILA_VELHA", "interact");
interactHotspot(state, "HS_SAIDA_LESTE", "interact");
assert.equal(state.active_room, "R02_FLORES");

// N03 — R02_FLORES
interactHotspot(state, "HS_FLORES_VALE", "interact");
assert.equal(state.active_room, "R03_CABANA");
assert.ok(state.inventory.includes("ITEM_FLOR_VENENOSA"));

// N04, N05, N06 — R03_CABANA
interactHotspot(state, "HS_NPC_DILAN", "interact", undefined, ["OPT_REFUGIO", "OPT_LOCAL"]);
assert.equal(state.flags.FLAG_SABE_TRAVESSIA, true);
interactHotspot(state, "HS_CONTADOR_GEIGER", "use_item", "ITEM_FLOR_VENENOSA");
assert.equal(state.flags.FLAG_DILAN_DISTRAIDO, true);
interactHotspot(state, "HS_COLDRE_MESA", "interact");
assert.ok(state.inventory.includes("ITEM_PISTOLA_CROMADA"));
interactHotspot(state, "HS_PORTA_CABANA", "interact");
assert.equal(state.active_room, "R04_QUARTO");

// N07, N08, N09 — R04_QUARTO -> R05_CORREDOR -> R06_PATIO
interactHotspot(state, "HS_NPC_ODELIA", "interact", undefined, ["OPT_DENTES", "OPT_JADEN"]);
assert.ok(state.evidences.includes("K1"));
interactHotspot(state, "HS_NPC_DILAN_QUARTO", "interact", undefined, ["OPT_MENTIRA"]);
assert.ok(state.evidences.includes("K2"));
assert.equal(state.narrative_clock, 40);
interactHotspot(state, "HS_PORTA_QUARTO", "interact");
assert.equal(state.active_room, "R05_CORREDOR");
interactHotspot(state, "HS_PORTA_PRINCIPAL", "interact");
assert.equal(state.active_room, "R06_PATIO");

// N10, N11, N12, N13 — R06_PATIO
interactHotspot(state, "HS_NPC_AMARINA", "examine");
interactHotspot(state, "HS_NPC_AMARINA", "interact");
assert.equal(state.flags.FLAG_AMARINA_FALOU, true);
assert.equal(state.narrative_clock, 30);

interactHotspot(state, "HS_CERCADO_ANIMAIS", "examine");
interactHotspot(state, "HS_LATERAL_TRIAGEM", "interact");
assert.ok(state.evidences.includes("K3"));
assert.equal(state.narrative_clock, 20);

interactHotspot(state, "HS_NPC_JADEN_BATENTE", "examine");
assert.ok(state.evidences.includes("K4"));
assert.equal(state.narrative_clock, 10);

interactHotspot(state, "HS_SAIDA_CASARAO", "interact");
assert.ok(state.evidences.includes("K5"));
assert.equal(state.flags.FLAG_PORTA_TRANCADA, true);
assert.equal(state.narrative_clock, 0);
assert.equal(state.active_room, "R05_CORREDOR");

// N14 — R05_CORREDOR (Ending)
interactHotspot(state, "HS_PORTA_PRINCIPAL", "interact");
assert.equal(state.flags.FLAG_DEMO_FIM, true);
assert.equal(state.evidences.length, 5);

console.log("PASS: Critical path N01 -> N14 validated with 0 softlocks and 5/5 evidences.");
