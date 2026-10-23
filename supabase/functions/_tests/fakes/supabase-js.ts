/**
 * Stands in for `https://esm.sh/@supabase/supabase-js@2` under `_tests/import_map.json`.
 *
 * Every client shares one `scenario`: the test says who the token belongs to and what
 * `drive.get_entitlement` answers, and reads back every table, RPC and bucket the code touched.
 * Anything not scripted resolves `{ data: null, error: null }`, so the code under test keeps going
 * and the trail in `scenario.calls` shows how far it went.
 *
 * `createClient` answers `any` on purpose: the code under test chains the real client's typed API.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface FakeUser {
  id: string;
  email?: string;
  is_anonymous?: boolean;
}

/** One write the code sent: the table, the builder method, and the values it carried. */
export interface FakeWrite {
  table: string;
  op: 'insert' | 'update' | 'upsert';
  values: unknown;
}

/** Answers a query from the chain of builder methods it used (`['select', 'eq', 'maybeSingle']`). */
export type TableAnswer = (chain: string[]) => unknown;

export interface Scenario {
  user: FakeUser | null;
  entitlement: { data: unknown; error: { code?: string } | null } | 'hang';
  /**
   * What a query on each table answers as `data`; tables not listed answer `null`. A function
   * answers per query, for code that reads the same table more than once.
   */
  tables: Record<string, unknown | TableAnswer>;
  calls: string[];
  /** Every insert, update and upsert, in order. Reset with `calls` by `request()`. */
  writes: FakeWrite[];
}

export const scenario: Scenario = {
  user: null,
  entitlement: { data: null, error: null },
  tables: {},
  calls: [],
  writes: [],
};

const WRITE_OPS = new Set(['insert', 'update', 'upsert']);

const EMPTY = { data: null, error: null };

/**
 * A query builder: every method returns itself, and awaiting it yields `result(chain)`, where
 * `chain` is the methods called on it. On a table, writes are recorded in `scenario.writes`.
 */
function builder(result: (chain: string[]) => Promise<unknown>, table?: string): unknown {
  const chain: string[] = [];
  const proxy: unknown = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onFail: (e: unknown) => unknown) =>
          result(chain).then(onOk, onFail);
      }
      return (...args: unknown[]) => {
        const method = String(prop);
        chain.push(method);
        if (table && WRITE_OPS.has(method)) {
          scenario.writes.push({ table, op: method as FakeWrite['op'], values: args[0] });
        }
        return proxy;
      };
    },
  });
  return proxy;
}

function tableResult(table: string, chain: string[]): Promise<unknown> {
  const answer = scenario.tables[table];
  const data = typeof answer === 'function' ? (answer as TableAnswer)(chain) : answer;
  return Promise.resolve({ data: data ?? null, error: null });
}

function entitlementResult(): Promise<unknown> {
  if (scenario.entitlement === 'hang') return new Promise(() => {});
  return Promise.resolve(scenario.entitlement);
}

function schemaScope(): Record<string, unknown> {
  return {
    from: (table: string) => {
      scenario.calls.push(`from:${table}`);
      return builder((chain) => tableResult(table, chain), table);
    },
    rpc: (fn: string) => {
      scenario.calls.push(`rpc:${fn}`);
      return builder(fn === 'get_entitlement' ? entitlementResult : () => Promise.resolve(EMPTY));
    },
  };
}

// deno-lint-ignore no-explicit-any
export function createClient(_url: string, _key: string, _options?: unknown): any {
  return {
    ...schemaScope(),
    schema: () => schemaScope(),
    auth: {
      getUser: () => {
        scenario.calls.push('auth:getUser');
        return Promise.resolve(
          scenario.user
            ? { data: { user: scenario.user }, error: null }
            : { data: { user: null }, error: { message: 'invalid token' } },
        );
      },
    },
    storage: {
      from: (bucket: string) => {
        scenario.calls.push(`storage:${bucket}`);
        return builder(() => Promise.resolve(EMPTY));
      },
    },
    functions: {
      invoke: (name: string) => {
        scenario.calls.push(`invoke:${name}`);
        return Promise.resolve(EMPTY);
      },
    },
  };
}
