import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function syncToken(userId?: string) {
  if (userId) {
    console.log(`🔄 Sincronizando token para o usuário: ${userId}`);
    await processUser(userId);
  } else {
    console.log('🔄 Sincronizando tokens para TODOS os usuários que possuirem tokens em fcm_tokens mas não em profiles...');
    
    // Busca usuários que têm token em fcm_tokens mas não em profiles.push_token
    // Como o Supabase non-join cross-schema query é limitado, vamos fazer em duas etapas ou usar uma estratégia de busca
    
    // 1. Pegar todos os user_id únicos de fcm_tokens que estão ativos
    const { data: tokens, error: tokenErr } = await sb.schema('drive')
      .from('fcm_tokens')
      .select('user_id')
      .eq('is_active', true);

    if (tokenErr) {
      console.error('Erro ao buscar tokens:', tokenErr.message);
      return;
    }

    const uniqueUserIds = Array.from(new Set(tokens.map(t => t.user_id).filter(Boolean)));
    console.log(`Encontrados ${uniqueUserIds.length} usuários únicos com tokens ativos.`);

    for (const id of uniqueUserIds) {
      await processUser(id);
    }
  }
  
  console.log('\n✅ Processamento concluído.');
}

async function processUser(userId: string) {
  // 1. Buscar o token mais recente e ativo para este usuário
  const { data: fcmTokens, error: fcmErr } = await sb.schema('drive')
    .from('fcm_tokens')
    .select('fcm_token, updated_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (fcmErr) {
    console.error(`  [${userId}] Erro ao buscar fcm_token:`, fcmErr.message);
    return;
  }

  if (!fcmTokens || fcmTokens.length === 0) {
    console.log(`  [${userId}] Nenhum token ativo encontrado em fcm_tokens.`);
    return;
  }

  const newestToken = fcmTokens[0].fcm_token;

  // 2. Verificar se o profile já tem este token (para evitar updates desnecessários)
  const { data: profile, error: profileErr } = await sb.schema('drive')
    .from('profiles')
    .select('push_token')
    .eq('id', userId)
    .single();

  if (profileErr) {
    console.error(`  [${userId}] Erro ao buscar profile:`, profileErr.message);
    return;
  }

  if (profile.push_token === newestToken) {
    console.log(`  [${userId}] Profile já possui o token mais recente. Pulando.`);
    return;
  }

  // 3. Atualizar o profile
  const { error: updateErr } = await sb.schema('drive')
    .from('profiles')
    .update({ 
      push_token: newestToken,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  if (updateErr) {
    console.error(`  [${userId}] Erro ao atualizar push_token no profile:`, updateErr.message);
  } else {
    console.log(`  [${userId}] Token sincronizado com sucesso: ${newestToken.substring(0, 10)}...`);
  }
}

// Execução
const targetId = process.argv[2];
syncToken(targetId).catch(console.error);
