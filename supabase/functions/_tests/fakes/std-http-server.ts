/**
 * Stands in for `https://deno.land/std@0.177.0/http/server.ts` under `_tests/import_map.json`.
 * `serve` does not listen: it hands the handler to the test, which calls it with a Request.
 */
export type Handler = (request: Request) => Response | Promise<Response>;

export const capturedHandlers: Handler[] = [];

export function serve(handler: Handler): void {
  capturedHandlers.push(handler);
}
