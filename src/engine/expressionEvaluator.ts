import type { FlagKey, GameState, ItemId } from "../types";

/**
 * Deterministic evaluator for visible_if, requires, and condition expressions.
 * Supports:
 * - true / false
 * - && conjunctions
 * - has_item('ITEM_ID') and !has_item('ITEM_ID')
 * - FLAG_KEY == true / false, FLAG_KEY != true / false
 * - bare FLAG_KEY / !FLAG_KEY
 * - active_room == 'ROOM_ID' / != 'ROOM_ID'
 * - evidences.length == N / != N
 */
export function evalCondition(expr: string | undefined, state: GameState): boolean {
  if (!expr) return true;
  const trimmed = expr.trim();
  if (trimmed === "" || trimmed === "true") return true;
  if (trimmed === "false") return false;

  const parts = trimmed.split("&&");
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!evalAtomic(part, state)) {
      return false;
    }
  }
  return true;
}

function evalAtomic(part: string, state: GameState): boolean {
  if (part === "true") return true;
  if (part === "false") return false;

  const itemMatch = part.match(/^(!?)has_item\(\s*['"]([^'"]+)['"]\s*\)$/);
  if (itemMatch) {
    const negate = itemMatch[1] === "!";
    const itemId = itemMatch[2] as ItemId;
    const has = state.inventory.includes(itemId);
    return negate ? !has : has;
  }

  const roomMatch = part.match(/^active_room\s*(==|!=)\s*['"]([^'"]+)['"]$/);
  if (roomMatch) {
    const op = roomMatch[1];
    const targetRoom = roomMatch[2];
    return op === "==" ? state.active_room === targetRoom : state.active_room !== targetRoom;
  }

  const evLenMatch = part.match(/^evidences\.length\s*(==|!=)\s*(\d+)$/);
  if (evLenMatch) {
    const op = evLenMatch[1];
    const targetNum = Number(evLenMatch[2]);
    return op === "==" ? state.evidences.length === targetNum : state.evidences.length !== targetNum;
  }

  const flagEqMatch = part.match(/^([A-Z0-9_]+)\s*(==|!=)\s*(true|false)$/);
  if (flagEqMatch) {
    const flagKey = flagEqMatch[1] as FlagKey;
    const op = flagEqMatch[2];
    const target = flagEqMatch[3] === "true";
    const actual = Boolean(state.flags[flagKey]);
    return op === "==" ? actual === target : actual !== target;
  }

  const bareFlagMatch = part.match(/^(!?)([A-Z][A-Z0-9_]+)$/);
  if (bareFlagMatch) {
    const negate = bareFlagMatch[1] === "!";
    const flagKey = bareFlagMatch[2] as FlagKey;
    const actual = Boolean(state.flags[flagKey]);
    return negate ? !actual : actual;
  }

  throw new Error(`Unsupported condition expression: ${part}`);
}
