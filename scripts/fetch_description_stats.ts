
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function getStats() {
  const startDate = '2025-12-15T00:00:00Z';
  const endDate = '2025-12-31T23:59:59Z';

  console.log(`Report for ${startDate} to ${endDate}\n`);

  // Target: core.attraction_descriptions
  const { data: ads, error: adsError } = await supabase
    .schema('core')
    .from('attraction_descriptions')
    .select('*')
    .gte('updated_at', startDate)
    .lte('updated_at', endDate);

  if (adsError) {
    console.error('Error core.attraction_descriptions:', adsError.message);
  } else {
    const total = ads?.length || 0;
    console.log(`Relatório de Descrições Geradas (15/12 a 31/12/2025)`);
    console.log(`-----------------------------------------------`);
    console.log(`Total de registros: ${total}\n`);
    
    if (total > 0) {
      const breakdown: any = {};
      let totalChars = 0;
      
      ads.forEach((ad: any) => {
        const lang = ad.language || 'unknown';
        // Check which column has content
        const text = ad.base_narrative_text || ad.description || '';
        const chars = text.length;
        
        if (!breakdown[lang]) breakdown[lang] = { count: 0, characters: 0 };
        breakdown[lang].count++;
        breakdown[lang].characters += chars;
        totalChars += chars;
      });
      
      console.log('Breakdown por Idioma:');
      Object.entries(breakdown).forEach(([lang, stats]: [string, any]) => {
        console.log(`- ${lang.toUpperCase()}:`);
        console.log(`  Volume: ${stats.count} descrições`);
        console.log(`  Caracteres: ${stats.characters.toLocaleString('pt-BR')}`);
      });
      
      console.log(`\n-----------------------------------------------`);
      console.log(`Volume Total: ${total} descrições`);
      console.log(`Total de Caracteres: ${totalChars.toLocaleString('pt-BR')}`);
    } else {
      console.log('Nenhuma descrição encontrada no período selecionado.');
    }
  }
}

getStats();
