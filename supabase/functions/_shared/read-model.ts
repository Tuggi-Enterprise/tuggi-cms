// ─────────────────────────────────────────────────────────────────────────────
// Self-heal do read-model core.app_poi_read para UM POI.
//
// POR QUÊ: geração de áudio/descrição grava AO VIVO em core.attraction_descriptions,
// mas o caminho de DISPARO do app (core.app_get_pois_by_cone) NÃO lê a tabela viva —
// lê a cópia materializada core.app_poi_read. Sem reconstruir a linha do POI ali, o
// áudio recém-gerado fica INVISÍVEL para o guia (o app recebe o TP sem audio_url →
// nada toca), até o cron refresh_app_poi_read rodar (minutos depois, ou nunca se o
// cron estiver parado). Chamar isto logo após a escrita fecha esse race na origem.
//
// CUSTO: reconstrói 1 POI (~1s). NÃO confundir com refresh_app_poi_read(true), que
// reconstrói tudo de uma vez e dá timeout. Por-POI é barato e seguro.
//
// BEST-EFFORT: uma falha aqui NÃO deve derrubar a geração (o áudio já foi gravado);
// o cron continua sendo o fallback. Por isso só logamos, nunca lançamos.
// ─────────────────────────────────────────────────────────────────────────────

// Loose: aceita qualquer supabase-js client (a tipagem do .rpc via esm.sh atrita).
type SchemaClient = { schema: (name: string) => { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> } };

export async function rebuildReadModel(
  client: SchemaClient,
  attractionId: string,
): Promise<void> {
  if (!attractionId) return;
  try {
    const { error } = await client
      .schema("core")
      .rpc("app_poi_read_build", { p_ids: [attractionId] });
    if (error) {
      console.warn(`[read-model] app_poi_read_build falhou p/ ${attractionId}: ${error.message} (fallback: cron)`);
    } else {
      console.log(`[read-model] ✅ app_poi_read atualizado p/ ${attractionId}`);
    }
  } catch (e) {
    console.warn(`[read-model] app_poi_read_build exception p/ ${attractionId}: ${(e as Error).message} (fallback: cron)`);
  }
}
