import { describe, expect, it } from "vitest";
import { defaultDb } from "./domain";
import { MemoryD1 } from "./test-d1";
import {
  applyExampleContentSeed,
  CONTENT_SEED_VERSION,
  ensureSchema,
  EXAMPLE_FAMILY_SHELF,
  EXAMPLE_MEMORABLE_DATES,
  loadState,
  MAX_CAS_ATTEMPTS,
  mutateState,
  StateConflictError,
  StateStoreError,
} from "./store";

describe("D1 state store", () => {
  it("creates the singleton and seeds neutral examples exactly once per binding", async () => {
    const database = new MemoryD1();

    await Promise.all([ensureSchema(database), ensureSchema(database)]);
    const loaded = await loadState(database);

    expect(database.schemaRuns).toBe(1);
    expect(database.insertRuns).toBe(1);
    expect(database.updateRuns).toBe(1);
    expect(loaded.revision).toBe(1);
    expect(loaded.state.players.map((player) => player.id)).toEqual(["p1", "p2"]);
    expect(loaded.state.tasks).toEqual([]);
    expect(loaded.state.family_shelf).toEqual(EXAMPLE_FAMILY_SHELF);
    expect(loaded.state.memorable_dates).toEqual(EXAMPLE_MEMORABLE_DATES);
    expect(database.row?.content_seed_version).toBe(CONTENT_SEED_VERSION);
  });

  it("applies the content seed idempotently", () => {
    const state = defaultDb();

    expect(applyExampleContentSeed(state, 0, 0)).toBe(true);
    const seeded = JSON.stringify(state);
    expect(applyExampleContentSeed(state, 1, CONTENT_SEED_VERSION)).toBe(false);
    expect(JSON.stringify(state)).toBe(seeded);
  });

  it("seeds an untouched v1 row after its sole technical week initialization", async () => {
    const database = new MemoryD1();
    database.seedStoredState({ ...defaultDb(), week_key: "2026-W31" }, 1);

    const loaded = await loadState(database);

    expect(loaded.revision).toBe(2);
    expect(loaded.state.week_key).toBe("2026-W31");
    expect(loaded.state.family_shelf).toEqual(EXAMPLE_FAMILY_SHELF);
    expect(loaded.state.memorable_dates).toEqual(EXAMPLE_MEMORABLE_DATES);
  });

  it("marks an ambiguous visually empty row without adding examples", async () => {
    const database = new MemoryD1();
    database.seedStoredState(defaultDb(), 2);

    const loaded = await loadState(database);

    expect(loaded.revision).toBe(3);
    expect(loaded.state.family_shelf).toEqual([]);
    expect(loaded.state.memorable_dates).toEqual([]);
    expect(database.row?.content_seed_version).toBe(CONTENT_SEED_VERSION);
  });

  it("does not restore examples after the family deletes them", async () => {
    const database = new MemoryD1();
    await loadState(database);

    await mutateState(database, (draft) => {
      draft.family_shelf = [];
      draft.memorable_dates = [];
      return { changed: true, value: null };
    });
    const afterDelete = await loadState(database);

    expect(afterDelete.state.family_shelf).toEqual([]);
    expect(afterDelete.state.memorable_dates).toEqual([]);
    expect(database.row?.content_seed_version).toBe(CONTENT_SEED_VERSION);
  });

  it("reclassifies after a real concurrent user edit and never overwrites it", async () => {
    const database = new MemoryD1();
    database.conflictsRemaining = 1;
    database.conflictStateMutation = (state) => {
      const players = state.players as Array<Record<string, unknown>>;
      players[0]!.name = "Аня";
    };

    const loaded = await loadState(database);

    expect(loaded.revision).toBe(2);
    expect(loaded.state.players[0]!.name).toBe("Аня");
    expect(loaded.state.family_shelf).toEqual([]);
    expect(loaded.state.memorable_dates).toEqual([]);
    expect(database.row?.content_seed_version).toBe(CONTENT_SEED_VERSION);
  });

  it("retries safely after bootstrap exhausts its CAS budget", async () => {
    const database = new MemoryD1();
    database.conflictsRemaining = MAX_CAS_ATTEMPTS;

    await expect(ensureSchema(database)).rejects.toBeInstanceOf(StateStoreError);
    expect(database.row?.revision).toBe(MAX_CAS_ATTEMPTS);
    expect(database.row?.content_seed_version).toBe(0);

    const loaded = await loadState(database);
    expect(loaded.revision).toBe(MAX_CAS_ATTEMPTS + 1);
    expect(loaded.state.family_shelf).toEqual([]);
    expect(loaded.state.memorable_dates).toEqual([]);
    expect(database.row?.content_seed_version).toBe(CONTENT_SEED_VERSION);
  });

  it("leaves the v1 JSON untouched when bootstrap persistence fails", async () => {
    const database = new MemoryD1();
    const original = defaultDb();
    database.seedStoredState(original);
    database.failUpdates = true;

    await expect(ensureSchema(database)).rejects.toBeInstanceOf(StateStoreError);
    expect(database.parsedState()).toEqual(original);
    expect(database.row?.revision).toBe(0);
    expect(database.row?.content_seed_version).toBe(0);

    database.failUpdates = false;
    const loaded = await loadState(database);
    expect(loaded.state.family_shelf).toEqual(EXAMPLE_FAMILY_SHELF);
  });

  it("adds the marker column to a legacy v1 table without changing schema_version", async () => {
    const database = new MemoryD1();
    database.seedStoredState(defaultDb(), 0, 1, 0, false);

    const loaded = await loadState(database);

    expect(database.alterRuns).toBe(1);
    expect(database.hasContentSeedColumn).toBe(true);
    expect(database.row?.schema_version).toBe(1);
    expect(database.row?.content_seed_version).toBe(CONTENT_SEED_VERSION);
    expect(loaded.state.family_shelf).toEqual(EXAMPLE_FAMILY_SHELF);
  });

  it("marks a near-limit used state without rewriting one byte of its JSON", async () => {
    const database = new MemoryD1();
    const state = defaultDb();
    state.events.push({ id: "large", kind: "note", text: "", at: 0, reactions: [] });
    const emptyBytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
    state.events[0]!.text = "x".repeat(1_500_000 - emptyBytes - 4);
    database.seedStoredState(state, 2);
    const originalJson = database.row!.state_json;

    const loaded = await loadState(database);

    expect(new TextEncoder().encode(originalJson).byteLength).toBeGreaterThan(1_499_900);
    expect(database.row?.state_json).toBe(originalJson);
    expect(database.row?.revision).toBe(3);
    expect(database.row?.content_seed_version).toBe(CONTENT_SEED_VERSION);
    expect(loaded.state.events).toHaveLength(1);
  });

  it("rejects structurally malformed state without writing marker or revision", async () => {
    const database = new MemoryD1();
    database.seedRawState(JSON.stringify({ players: [] }), 7);
    const originalJson = database.row!.state_json;

    await expect(ensureSchema(database)).rejects.toBeInstanceOf(StateStoreError);

    expect(database.row?.state_json).toBe(originalJson);
    expect(database.row?.revision).toBe(7);
    expect(database.row?.content_seed_version).toBe(0);
    expect(database.updateRuns).toBe(0);
  });

  it("deep-clones state and leaves storage untouched when a reducer fails", async () => {
    const database = new MemoryD1();
    const before = await loadState(database);
    const updatesBefore = database.updateRuns;

    await expect(
      mutateState(database, (draft) => {
        draft.players[0]!.name = "Не сохранять";
        throw new Error("domain failure");
      }),
    ).rejects.toThrow("domain failure");

    const after = await loadState(database);
    expect(after).toEqual(before);
    expect(database.updateRuns).toBe(updatesBefore);
  });

  it("replays the reducer after CAS conflicts and commits the latest draft", async () => {
    const database = new MemoryD1();
    const initial = await loadState(database);
    const updatesBefore = database.updateRuns;
    database.conflictsRemaining = 2;
    let reducerRuns = 0;

    const result = await mutateState(database, (draft) => {
      reducerRuns += 1;
      draft.week_claims += 1;
      return { changed: true, value: draft.week_claims };
    });

    expect(reducerRuns).toBe(3);
    expect(database.updateRuns - updatesBefore).toBe(3);
    expect(result.revision).toBe(initial.revision + 3);
    expect(result.value).toBe(1);
    expect((await loadState(database)).state.week_claims).toBe(1);
  });

  it("returns a conflict error after five failed CAS attempts", async () => {
    const database = new MemoryD1();
    await loadState(database);
    const updatesBefore = database.updateRuns;
    database.conflictsRemaining = MAX_CAS_ATTEMPTS;
    let reducerRuns = 0;

    await expect(
      mutateState(database, (draft) => {
        reducerRuns += 1;
        draft.week_claims += 1;
        return { changed: true, value: null };
      }),
    ).rejects.toBeInstanceOf(StateConflictError);

    expect(reducerRuns).toBe(MAX_CAS_ATTEMPTS);
    expect(database.updateRuns - updatesBefore).toBe(MAX_CAS_ATTEMPTS);
  });

  it("wraps D1 write failures as service-availability errors", async () => {
    const database = new MemoryD1();
    await loadState(database);
    database.failUpdates = true;

    await expect(
      mutateState(database, (draft) => {
        draft.week_claims += 1;
        return { changed: true, value: null };
      }),
    ).rejects.toBeInstanceOf(StateStoreError);
  });

  it("compacts old finished tasks before enforcing the 1.5 MB limit", async () => {
    const database = new MemoryD1();
    const longTitle = "x".repeat(5_000);

    const result = await mutateState(database, (draft) => {
      for (let index = 0; index < 400; index += 1) {
        draft.tasks.push({
          id: `done-${index}`,
          title: longTitle,
          emoji: "✅",
          base_points: 1,
          created_at: index,
          deadline: index + 1,
          status: "done",
          claimed_by: "p1",
          awarded_points: 1,
          finished_at: index,
          repeat_hours: null,
          interval_hours: null,
          fuse_hours: 1,
          appear_at: null,
        });
      }
      return { changed: true, value: null };
    });

    expect(result.state.tasks).toHaveLength(200);
    expect(result.state.tasks[0]!.id).toBe("done-399");
    expect(new TextEncoder().encode(database.row!.state_json).byteLength).toBeLessThanOrEqual(
      1_500_000,
    );
  });
});
