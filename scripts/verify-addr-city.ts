import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function verify() {
  console.log('=== VERIFICAÇÃO COMPLETA: addr:city nos 100k+ itens ===');
  
  const { count: withProps } = await sb.schema('homolog').from('pois')
    .select('*', { count: 'exact', head: true })
    .not('osm_properties', 'is', null);
  console.log('Total com osm_properties:', withProps);

  const { count: propsNoCity } = await sb.schema('homolog').from('pois')
    .select('*', { count: 'exact', head: true })
    .not('osm_properties', 'is', null)
    .is('city', null);
  console.log('Com osm_properties MAS city NULL:', propsNoCity);

  // Agora vamos varrer TODOS com paginação real
  let found = 0;
  let checked = 0;
  let examples: string[] = [];

  for (let offset = 0; offset < 200000; offset += 1000) {
    const { data, error } = await sb.schema('homolog').from('pois')
      .select('uuid_id, name, osm_properties')
      .not('osm_properties', 'is', null)
      .is('city', null)
      .range(offset, offset + 999);

    if (error) {
      console.log('Erro no offset', offset, ':', error.message);
      break;
    }
    if (!data || data.length === 0) {
      console.log('Fim dos dados no offset', offset);
      break;
    }

    checked += data.length;

    for (const item of data) {
      if (item.osm_properties && item.osm_properties['addr:city']) {
        found++;
        if (examples.length < 5) {
          examples.push(`${item.name} -> ${item.osm_properties['addr:city']}`);
        }
      }
    }

    if (checked % 5000 === 0) {
      console.log(`  ... verificados ${checked} | encontrados com addr:city: ${found}`);
    }
  }

  console.log('\n=== RESULTADO FINAL ===');
  console.log('Total verificados (com osm_properties e city NULL):', checked);
  console.log('Com addr:city dentro do JSON:', found);
  
  if (examples.length > 0) {
    console.log('\nExemplos encontrados:');
    examples.forEach(e => console.log('  -', e));
  }
}

verify().catch(console.error);
