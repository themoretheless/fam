import type {
  Achievement,
  Db,
  FamEvent,
  FamilyShelfItem,
  MemorableDate,
  Player,
  Reaction,
  SeasonResult,
  Task,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isPlayer(value: unknown): value is Player {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.avatar === "string" &&
    isFiniteNumber(value.score) &&
    isFiniteNumber(value.xp) &&
    isNullableFiniteNumber(value.last_claim_at) &&
    typeof value.comeback_week_key === "string"
  );
}

function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.emoji === "string" &&
    isFiniteNumber(value.base_points) &&
    isFiniteNumber(value.created_at) &&
    isFiniteNumber(value.deadline) &&
    typeof value.status === "string" &&
    ["open", "done", "burned", "scheduled"].includes(value.status) &&
    isNullableString(value.claimed_by) &&
    isNullableFiniteNumber(value.awarded_points) &&
    isNullableFiniteNumber(value.finished_at) &&
    isNullableFiniteNumber(value.repeat_hours) &&
    isNullableFiniteNumber(value.interval_hours) &&
    isNullableFiniteNumber(value.fuse_hours) &&
    isNullableFiniteNumber(value.appear_at)
  );
}

function isReaction(value: unknown): value is Reaction {
  return (
    isRecord(value) &&
    typeof value.player_id === "string" &&
    typeof value.emoji === "string"
  );
}

function isEvent(value: unknown): value is FamEvent {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.text === "string" &&
    isFiniteNumber(value.at) &&
    Array.isArray(value.reactions) &&
    value.reactions.every(isReaction)
  );
}

function isSeason(value: unknown): value is SeasonResult {
  return (
    isRecord(value) &&
    typeof value.week_key === "string" &&
    isFiniteNumber(value.p1_score) &&
    isFiniteNumber(value.p2_score) &&
    isNullableString(value.winner)
  );
}

function isAchievement(value: unknown): value is Achievement {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.player_id === "string" &&
    typeof value.key === "string" &&
    typeof value.title === "string" &&
    typeof value.emoji === "string" &&
    isFiniteNumber(value.at)
  );
}

function isShelfItem(value: unknown): value is FamilyShelfItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.emoji === "string" &&
    isFiniteNumber(value.base_points) &&
    isFiniteNumber(value.hours) &&
    typeof value.repeat === "boolean" &&
    isNullableFiniteNumber(value.interval_hours)
  );
}

function isMemorableDate(value: unknown): value is MemorableDate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.date === "string" &&
    typeof value.kind === "string" &&
    ["anniversary", "meeting", "birthday", "custom"].includes(value.kind)
  );
}

export function isStoredState(value: unknown): value is Db {
  if (!isRecord(value)) return false;
  if (
    !Array.isArray(value.players) ||
    value.players.length !== 2 ||
    !value.players.every(isPlayer) ||
    value.players[0]!.id !== "p1" ||
    value.players[1]!.id !== "p2"
  ) {
    return false;
  }
  return (
    Array.isArray(value.tasks) &&
    value.tasks.every(isTask) &&
    Array.isArray(value.events) &&
    value.events.every(isEvent) &&
    typeof value.week_key === "string" &&
    Array.isArray(value.seasons) &&
    value.seasons.every(isSeason) &&
    Array.isArray(value.achievements) &&
    value.achievements.every(isAchievement) &&
    Number.isSafeInteger(value.week_burns) &&
    Number(value.week_burns) >= 0 &&
    Number.isSafeInteger(value.week_claims) &&
    Number(value.week_claims) >= 0 &&
    Array.isArray(value.family_shelf) &&
    value.family_shelf.every(isShelfItem) &&
    Array.isArray(value.memorable_dates) &&
    value.memorable_dates.every(isMemorableDate)
  );
}
