
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

const INPUT_FILE = 'spatial_duplicates.json';
const BATCH_SIZE = 100;

async function cleanupSpatialDuplicates() {
  console.log('🗑️ Iniciando limpeza de duplicatas espaciais...');

  if (!fs.existsSync(INPUT_FILE)) {
    console.error('❌ Arquivo de duplicatas não encontrado.');
    return;
  }

  const idsToDelete = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8')) as string[];
  const total = idsToDelete.length;

  console.log(`📋 Total de IDs para deletar: ${total}`);

  let deletedCount = 0;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = idsToDelete.slice(i, i + BATCH_SIZE);

    // Primeiro apaga coordenadas
    await supabase.schema('homolog').from('coordinates').delete().in('poi_uuid_id', batch);

    // Depois apaga o POI
    const { error } = await supabase
      .schema('homolog')
      .from('pois')
      .delete()
      .in('uuid_id', batch);

    if (error) {
      console.error(`\nErro no lote ${i}:`, error.message);
    } else {
      deletedCount += batch.length;
      process.stdout.write(`\r✅ Progresso: ${deletedCount}/${total}`);
    }
  }

  console.log('\n\n🏁 Limpeza concluída!');
}

cleanupSpatialDuplicates();
