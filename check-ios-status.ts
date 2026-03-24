import { getSupabase } from './lib/core/supabase-client';

const sb = getSupabase('service');

async function checkLogs() {
  console.log('--- Checking Notification Logs ---');
  
  // Pegar os últimos 20 logs de erro ou falha
  const { data: logs, error } = await sb.schema('core')
    .from('notification_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching logs:', error.message);
    return;
  }

  if (!logs || logs.length === 0) {
    console.log('No logs found.');
    return;
  }

  console.table(logs.map(l => ({
    id: l.id,
    type: l.type,
    status: l.status,
    userIds: l.user_ids?.length || 0,
    sent_at: l.sent_at,
    error: l.error_details || 'N/A'
  })));

  // Vamos tentar identificar se há falhas específicas de tokens iOS
  // Para isso precisaríamos cruzar com os tokens, mas os logs salvam o resultado resumido.
  // Vamos buscar na tabela fcm_tokens se há muitos tokens iOS inativos recentemente.
  
  console.log('\n--- Checking Inactive iOS Tokens ---');
  const { data: profiles, error: pErr } = await sb.schema('drive')
    .from('profiles')
    .select('id, last_platform')
    .eq('last_platform', 'ios');

  if (pErr) {
    console.error('Error fetching ios profiles:', pErr.message);
  } else {
    const iosUserIds = profiles.map(p => p.id);
    const { count, error: tErr } = await sb.schema('drive')
      .from('fcm_tokens')
      .select('*', { count: 'exact', head: true })
      .in('user_id', iosUserIds)
      .eq('is_active', false);
    
    console.log(`Total iOS Inactive Tokens: ${count || 0}`);
  }
}

checkLogs().catch(console.error);
