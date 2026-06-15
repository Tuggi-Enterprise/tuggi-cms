// cleanup-orphan-audios — varredura periódica de áudios órfãos.
// Disparada por core.automated_audio_cleanup() (cron) via pg_net.
// Faz a remoção REAL via storage API (diferente da função SQL antiga, que só
// apagava o metadado em storage.objects e não liberava o blob no S3).
//
// Alvo (vem da RPC core.find_orphan_audio_paths, recalculado AO VIVO a cada lote):
//   - audio/ e master_audio/ NÃO referenciados por nenhum audio_url
//   - contextual_audio/ com mais de CONTEXTUAL_TTL_DAYS dias (cache)
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Aceita os nomes custom do projeto OU os reservados (sempre injetados pelo runtime)
const PROJECT_URL = Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const BUCKET = "travel-app-audios";
const BATCH = 1000;
const MAX_BATCHES = 100;            // teto de segurança: ~100k arquivos/execução
const CONTEXTUAL_TTL_DAYS = 30;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Apenas service_role pode disparar (apaga em massa — não pode ser anon/público).
// Decodifica o JWT e checa a claim `role` — robusto a diferenças de valor da chave.
function isServiceRole(req: Request): boolean {
  const raw = (req.headers.get("Authorization") || req.headers.get("apikey") || "").replace(/^Bearer\s+/i, "").trim();
  const part = raw.split(".")[1];
  if (!part) return false;
  try {
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!isServiceRole(req)) return json({ error: "unauthorized" }, 401);

  let deleted = 0, bytes = 0, batches = 0;

  try {
    if (!PROJECT_URL || !SERVICE_ROLE_KEY) throw new Error("env ausente: PROJECT_URL/SERVICE_ROLE_KEY");
    const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);
    while (batches < MAX_BATCHES) {
      const { data: orphans, error } = await supabase
        .schema("core")
        .rpc("find_orphan_audio_paths", { p_limit: BATCH, p_contextual_max_age_days: CONTEXTUAL_TTL_DAYS });
      if (error) throw new Error("rpc: " + error.message);
      if (!orphans || orphans.length === 0) break;

      const paths = orphans.map((o: { path: string }) => o.path);
      const { data: removed, error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
      if (rmErr) throw new Error("remove: " + rmErr.message);

      const n = removed?.length ?? 0;
      if (n === 0) break; // sem progresso (falha persistente) — evita loop infinito
      deleted += n;
      bytes += orphans.reduce((s: number, o: { bytes: number }) => s + Number(o.bytes || 0), 0);
      batches++;
    }

    const result = {
      ok: true,
      files_deleted: deleted,
      size_recovered_mb: Math.round(bytes / 1048576),
      batches,
      capped: batches >= MAX_BATCHES,
    };
    await supabase.schema("core").from("storage_cleanup_logs").insert({
      operation_type: "audio_cleanup",
      execution_time: new Date().toISOString(),
      files_processed: deleted,
      size_processed_bytes: bytes,
      details: result,
    });
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      if (PROJECT_URL && SERVICE_ROLE_KEY) {
        await createClient(PROJECT_URL, SERVICE_ROLE_KEY).schema("core").from("storage_cleanup_logs").insert({
          operation_type: "audio_error",
          execution_time: new Date().toISOString(),
          files_processed: deleted,
          size_processed_bytes: bytes,
          details: { error: msg, deleted, batches },
        });
      }
    } catch (_) { /* logging best-effort */ }
    return json({ ok: false, error: msg, files_deleted: deleted }, 500);
  }
});
