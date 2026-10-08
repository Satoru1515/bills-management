/**
 * Test helper: a fake Supabase client that records every query-builder call
 * and answers each awaited query with the next queued response.
 *
 *   const mock = createSupabaseMock();
 *   mock.respond({ data: [row] });
 *   await repoFunction(mock.client, ...);
 *   expect(mock.queries[0]).toEqual({ table: "transactions", calls: [...] });
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export interface MockCall {
  method: string;
  args: unknown[];
}

export interface MockQuery {
  table: string;
  calls: MockCall[];
}

export interface MockResponse {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

export interface SupabaseMock {
  client: SupabaseClient<Database>;
  /** One entry per `client.from(table)`, in order. */
  queries: MockQuery[];
  /** Queues responses, used in order by the awaited queries. */
  respond: (...responses: MockResponse[]) => void;
}

export function createSupabaseMock(): SupabaseMock {
  const queries: MockQuery[] = [];
  const queue: MockResponse[] = [];

  function builder(query: MockQuery): unknown {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            const response = queue.shift();
            if (!response) {
              throw new Error(`No mock response queued for query on "${query.table}"`);
            }
            const result = { data: response.data ?? null, error: response.error ?? null };
            return (resolve: (value: unknown) => void) => resolve(result);
          }
          return (...args: unknown[]) => {
            query.calls.push({ method: String(prop), args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const client = {
    from(table: string) {
      const query: MockQuery = { table, calls: [] };
      queries.push(query);
      return builder(query);
    },
  };

  return {
    client: client as unknown as SupabaseClient<Database>,
    queries,
    respond: (...responses) => queue.push(...responses),
  };
}

/** Method names of a recorded query, in call order. */
export function methodsOf(query: MockQuery | undefined): string[] {
  return query?.calls.map((call) => call.method) ?? [];
}

/** Arguments of every call to `method` in a recorded query. */
export function argsOf(query: MockQuery | undefined, method: string): unknown[][] {
  return query?.calls.filter((call) => call.method === method).map((call) => call.args) ?? [];
}
