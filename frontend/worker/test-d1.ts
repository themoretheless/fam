import type {
  D1Database,
  D1PreparedStatement,
  D1RunResult,
} from "./store";

interface MemoryRow {
  schema_version: number;
  revision: number;
  state_json: string;
  updated_at_ms: number;
}

function normalized(query: string): string {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

class MemoryStatement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: MemoryD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    const statement = new MemoryStatement(this.database, this.query);
    statement.values = values;
    return statement;
  }

  async first<T>(): Promise<T | null> {
    this.database.queries.push(this.query);
    if (!normalized(this.query).startsWith("select schema_version")) {
      throw new Error(`unexpected first(): ${this.query}`);
    }
    return (this.database.row ? { ...this.database.row } : null) as T | null;
  }

  async run<T = D1RunResult>(): Promise<T> {
    this.database.queries.push(this.query);
    const sql = normalized(this.query);

    if (sql.startsWith("create table if not exists app_state")) {
      this.database.schemaRuns += 1;
      return { success: true, meta: { changes: 0 } } as T;
    }

    if (sql.startsWith("insert or ignore into app_state")) {
      this.database.insertRuns += 1;
      if (this.database.row) {
        return { success: true, meta: { changes: 0 } } as T;
      }
      this.database.row = {
        schema_version: Number(this.values[0]),
        revision: 0,
        state_json: String(this.values[1]),
        updated_at_ms: Number(this.values[2]),
      };
      return { success: true, meta: { changes: 1 } } as T;
    }

    if (sql.startsWith("update app_state")) {
      this.database.updateRuns += 1;
      if (this.database.failUpdates) throw new Error("injected update failure");
      if (!this.database.row) throw new Error("state row missing");

      if (this.database.conflictsRemaining > 0) {
        this.database.conflictsRemaining -= 1;
        if (this.database.conflictStateMutation) {
          const state = JSON.parse(this.database.row.state_json) as Record<string, unknown>;
          this.database.conflictStateMutation(state);
          this.database.row.state_json = JSON.stringify(state);
          this.database.conflictStateMutation = null;
        }
        this.database.row.revision += 1;
        return { success: true, meta: { changes: 0 } } as T;
      }

      const expectedRevision = Number(this.values[3]);
      if (this.database.row.revision !== expectedRevision) {
        return { success: true, meta: { changes: 0 } } as T;
      }
      this.database.row = {
        schema_version: Number(this.values[0]),
        revision: expectedRevision + 1,
        state_json: String(this.values[1]),
        updated_at_ms: Number(this.values[2]),
      };
      return { success: true, meta: { changes: 1 } } as T;
    }

    throw new Error(`unexpected run(): ${this.query}`);
  }
}

export class MemoryD1 implements D1Database {
  row: MemoryRow | null = null;
  readonly queries: string[] = [];
  schemaRuns = 0;
  insertRuns = 0;
  updateRuns = 0;
  conflictsRemaining = 0;
  conflictStateMutation: ((state: Record<string, unknown>) => void) | null = null;
  failUpdates = false;

  seedStoredState(state: unknown, revision = 0, schemaVersion = 1): void {
    this.row = {
      schema_version: schemaVersion,
      revision,
      state_json: JSON.stringify(state),
      updated_at_ms: 0,
    };
  }

  parsedState<T = Record<string, unknown>>(): T {
    if (!this.row) throw new Error("state row missing");
    return JSON.parse(this.row.state_json) as T;
  }

  prepare(query: string): D1PreparedStatement {
    return new MemoryStatement(this, query);
  }
}
