import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const START = '2026-05-01T00:00:00Z';
const END = '2026-06-01T00:00:00Z';

// Gemini tokenizer rule-of-thumb: ~4 chars/token (EN), ~3.5 chars/token (PT/ES).
// Source: Google docs say "1 token ≈ 4 chars in English". For PT we estimate
// slightly denser (more accents, longer words). This is an APPROXIMATION; for
// exact numbers we would need to log `usageMetadata` from Gemini responses.
const CHARS_PER_TOKEN: Record<string, number> = {
  'pt-br': 3.5,
  'pt-pt': 3.5,
  'es-es': 3.7,
  'es-us': 3.7,
  'it-it': 3.7,
  'fr-fr': 3.7,
  'de-de': 3.5,
  'en-us': 4.0,
  'en-gb': 4.0,
};

async function pageAll<T>(build: () => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  console.log(`📐 Estimativa de tokens — Maio/2026\n`);

  const rows = await pageAll<any>(() =>
    supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('language, description, facts_pack_json')
      .gte('created_at', START)
      .lt('created_at', END)
  );

  // ── Saída (description text) ──
  const lensByLang: Record<string, number[]> = {};
  const tokensByLang: Record<string, number[]> = {};
  let totalDescChars = 0;
  let totalFactsChars = 0;

  for (const r of rows) {
    const lang = (r.language || 'unknown').toLowerCase();
    const desc = (r.description || '') as string;
    const facts = r.facts_pack_json ? JSON.stringify(r.facts_pack_json) : '';
    const cpt = CHARS_PER_TOKEN[lang] ?? 4.0;
    const tokens = Math.round(desc.length / cpt);

    lensByLang[lang] ??= [];
    tokensByLang[lang] ??= [];
    lensByLang[lang].push(desc.length);
    tokensByLang[lang].push(tokens);

    totalDescChars += desc.length;
    totalFactsChars += facts.length;
  }

  console.log(`Total de descrições: ${rows.length}`);
  console.log(
    `Soma de caracteres (description): ${totalDescChars.toLocaleString('pt-BR')}`
  );
  console.log(
    `Soma de caracteres (facts_pack_json): ${totalFactsChars.toLocaleString('pt-BR')}\n`
  );

  console.log(`— SAÍDA (texto da description gerado) —`);
  console.log(
    `Idioma     | n     | média chars | mediana chars | média tokens | mediana tokens`
  );
  console.log(
    `-----------|-------|-------------|---------------|--------------|---------------`
  );
  let grandLen = 0;
  let grandTok = 0;
  let grandN = 0;
  for (const [lang, lens] of Object.entries(lensByLang).sort(
    (a, b) => b[1].length - a[1].length
  )) {
    const n = lens.length;
    const avgC = lens.reduce((a, b) => a + b, 0) / n;
    const medC = median(lens);
    const toks = tokensByLang[lang];
    const avgT = toks.reduce((a, b) => a + b, 0) / n;
    const medT = median(toks);
    console.log(
      `${lang.padEnd(11)}| ${String(n).padEnd(5)} | ${avgC.toFixed(0).padStart(11)} | ${medC.toFixed(0).padStart(13)} | ${avgT.toFixed(0).padStart(12)} | ${medT.toFixed(0).padStart(14)}`
    );
    grandLen += lens.reduce((a, b) => a + b, 0);
    grandTok += toks.reduce((a, b) => a + b, 0);
    grandN += n;
  }
  console.log(
    `\nMédia geral (saída): ${(grandLen / grandN).toFixed(0)} chars ≈ ${(
      grandTok / grandN
    ).toFixed(0)} tokens por descrição`
  );

  // ── Entrada (estimativa baseada no prompt construído em masterPackGenerator) ──
  // System instruction: ~1900 chars fixos (já contém regras do tag + persona)
  // User prompt: ~150-300 chars (POI name + city + reference list opcional)
  // Quando grounded com Google Search, o modelo recebe ~3-8 KB de resultados.
  const SYSTEM_INSTRUCTION_CHARS = 1900; // medido em masterPackGenerator.ts
  const USER_PROMPT_CHARS = 230;          // POI name + city + instruções
  const GROUNDING_RESULTS_CHARS = 5500;   // search snippets típicos (estim.)

  console.log(`\n— ENTRADA (estimativa por chamada ao Gemini) —`);
  console.log(`(não há log de usage no banco; valores derivados do prompt construído)\n`);
  console.log(
    `system_instruction (fixo)    : ~${SYSTEM_INSTRUCTION_CHARS} chars ≈ ${Math.round(SYSTEM_INSTRUCTION_CHARS / 4)} tokens`
  );
  console.log(
    `user prompt (variável)       : ~${USER_PROMPT_CHARS} chars ≈ ${Math.round(USER_PROMPT_CHARS / 4)} tokens`
  );
  console.log(
    `grounding (search snippets)  : ~${GROUNDING_RESULTS_CHARS} chars ≈ ${Math.round(GROUNDING_RESULTS_CHARS / 4)} tokens`
  );
  const inWithGround =
    Math.round(
      (SYSTEM_INSTRUCTION_CHARS + USER_PROMPT_CHARS + GROUNDING_RESULTS_CHARS) /
        4
    );
  const inWithoutGround = Math.round(
    (SYSTEM_INSTRUCTION_CHARS + USER_PROMPT_CHARS) / 4
  );
  console.log(`\nTotal input por chamada (sem grounding) : ~${inWithoutGround} tokens`);
  console.log(`Total input por chamada (com grounding) : ~${inWithGround} tokens`);

  // ── Totais agregados Maio ──
  const avgOutTokens = grandTok / grandN;
  console.log(`\n— TOTAIS AGREGADOS (Maio/2026) —`);
  console.log(`Chamadas Gemini (≈ #descrições): ${grandN}`);
  console.log(
    `Output tokens totais (estim.): ${grandTok.toLocaleString('pt-BR')} (~${avgOutTokens.toFixed(0)}/chamada)`
  );
  console.log(
    `Input tokens totais (sem grounding): ${(grandN * inWithoutGround).toLocaleString('pt-BR')}`
  );
  console.log(
    `Input tokens totais (com grounding): ${(grandN * inWithGround).toLocaleString('pt-BR')}`
  );
}

main().catch((e) => {
  console.error('Erro:', e.message || e);
  process.exit(1);
});
