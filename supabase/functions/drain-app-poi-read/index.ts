// ============================================================================
// drain-app-poi-read — drenador da fila core.app_poi_read_dirty
// ============================================================================
// Acordado (event-driven) pelo trigger de wake (net.http_post) sempre que algo
// muda em attractions/coordinate/description/trigger_points. Processa a fila em
// LOTES LIMITADOS via core.drain_app_poi_read_dirty(batch) — cada chamada
// reconstrói ≤BATCH POIs no read-model (nunca estoura timeout). Se sobrar
// trabalho além do teto por invocação, re-acorda a si mesmo (não bloqueia).
//
// verify_jwt=true (deploy padrão): o wake/backstop/self-rewake chamam com o
// service-role Bearer (via Vault no SQL; via getSecretKey aqui). Concorrência é
// segura (FOR UPDATE SKIP LOCKED no SQL → invocações paralelas pegam lotes
// disjuntos), então múltiplos wakes não duplicam trabalho.
// ============================================================================
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getSecretKey } from "../_shared/supabase-client.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJECT_URL = Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = getSecretKey() || "";
const SELF_URL = `${PROJECT_URL}/functions/v1/drain-app-poi-read`;

const BATCH = 500;      // POIs reconstruídos por chamada SQL
const MAX_ITERS = 20;   // teto por invocação (~10k POIs) p/ caber no wall-clock

const admin = createClient(PROJECT_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  db: { schema: "core" },
});

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok");

  let total = 0, iters = 0, more = false;
  for (; iters < MAX_ITERS; iters++) {
    const { data, error } = await admin.rpc("drain_app_poi_read_dirty", { batch: BATCH });
    if (error) {
      console.error("[drain] rpc error:", error.message);
      return new Response(
        JSON.stringify({ ok: false, error: error.message, drained: total }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    const n = (data as number) ?? 0;
    total += n;
    if (n === 0) break;                       // fila vazia
    if (iters === MAX_ITERS - 1) more = true;  // atingiu o teto e ainda havia trabalho
  }

  // Sobrou? re-acorda a si mesmo (fire-and-forget, não bloqueia a resposta).
  if (more) {
    const cont = fetch(SELF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: "{}",
    }).catch((e) => console.warn("[drain] re-wake falhou:", e?.message));
    // @ts-ignore — continua em background após responder
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(cont);
  }

  console.log(`[drain] drenados=${total} iters=${iters} more=${more}`);
  return new Response(
    JSON.stringify({ ok: true, drained: total, more }),
    { headers: { "Content-Type": "application/json" } },
  );
});
