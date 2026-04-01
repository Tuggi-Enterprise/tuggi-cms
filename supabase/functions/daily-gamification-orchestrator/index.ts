
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Dicionário de Traduções (Personalidade Tuggi - Sem Emojis) ---
const TRANSLATIONS: Record<string, any> = {
  'pt-br': {
    title: 'Sua jornada de ontem',
    fallback: 'Viajante',
    body: (name: string, heard: number, missed: number) => 
      `Ei ${name}! Sua jornada de ontem revelou ${heard} historias, mas ${missed} segredos ficaram pelo caminho. Que tal ligar o som e descobrir novos misterios hoje?`,
    body_zero_heard: (name: string, missed: number) => 
      `Viagem silenciosa, ${name}? Vimos que voce iniciou sua jornada, mas ${missed} historias ainda esperam para serem ouvidas por ai. Que tal ativar o guia hoje?`
  },
  'pt-pt': {
    title: 'A sua jornada de ontem',
    fallback: 'Viajante',
    body: (name: string, heard: number, missed: number) => 
      `Olá ${name}! A sua jornada de ontem revelou ${heard} historias, mas ${missed} segredos ficaram pelo caminho. Que tal ligar o som e descobrir novos misterios hoje?`,
    body_zero_heard: (name: string, missed: number) => 
      `Viagem silenciosa, ${name}? Vimos que iniciou a sua jornada, mas ${missed} historias ainda esperam para ouvidas por ai. Que tal ativar o guia hoje?`
  },
  'en': {
    title: 'Your journey yesterday',
    fallback: 'Traveler',
    body: (name: string, heard: number, missed: number) => 
      `Hey ${name}! Yesterdays journey uncovered ${heard} stories, but ${missed} secrets were left behind. Ready to tune in and discover new mysteries today?`,
    body_zero_heard: (name: string, missed: number) => 
      `A quiet trip, ${name}? We noticed you started your journey, but ${missed} stories are still waiting to be heard. How about turning on the guide today?`
  },
  'es': {
    title: 'Tu jornada de ayer',
    fallback: 'Viajero',
    body: (name: string, heard: number, missed: number) => 
      `¡Hola ${name}! Tu jornada de ayer revelo ${heard} historias, pero ${missed} secretos quedaron por el camino. ¿Que tal encender el sonido y descubrir nuevos misterios hoje?`,
    body_zero_heard: (name: string, missed: number) => 
      `¿Viaje silencioso, ${name}? Vimos que iniciaste tu jornada, pero ${missed} historias aun esperan para ser escuchadas. ¿Que tal activar el guia hoy?`
  },
  'it': {
    title: 'Il tuo viaggio di ieri',
    fallback: 'Viaggiatore',
    body: (name: string, heard: number, missed: number) => 
      `Ehi ${name}! Il tuo viaggio di ieri ha svelato ${heard} storie, ma ${missed} segreti sono rimasti lungo a strada. Che ne dici di accendere il suono e scoprire nuovi misteri oggi?`,
    body_zero_heard: (name: string, missed: number) => 
      `Viaggio silenzioso, ${name}? Abbiamo notato que hai iniziato il tuo viaggio, ma ${missed} storie aspettano ancora di essere ascoltate. Che ne dici di attivare la guida oggi?`
  }
};

const getTranslation = (lang: string) => {
  const code = (lang || 'pt-br').toLowerCase();
  if (code.startsWith('pt-br')) return TRANSLATIONS['pt-br'];
  if (code.startsWith('pt-pt')) return TRANSLATIONS['pt-pt'];
  if (code.startsWith('pt')) return TRANSLATIONS['pt-br'];
  if (code.startsWith('it')) return TRANSLATIONS['it'];
  if (code.startsWith('es')) return TRANSLATIONS['es'];
  return TRANSLATIONS['en'];
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] 🚀 Daily Gamification Orchestrator started`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const driveClient = createClient(supabaseUrl, supabaseKey, {
      db: { schema: 'drive' }
    });

    // 1. Get Candidates (those at 07:00 AM local time)
    const { data: candidates, error: candidateError } = await driveClient
      .rpc('get_morning_push_candidates');

    if (candidateError) throw candidateError;
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No candidates for current hour' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${requestId}] 🎯 Found ${candidates.length} candidates to notify.`);

    const userIdsNotified = [];
    const results = [];

    // 2. Send Push directly via firebase-push-notification/send (EF-to-EF)
    const pushUrl = `${supabaseUrl}/functions/v1/firebase-push-notification/send`;

    for (const user of candidates) {
      const i18n = getTranslation(user.language);
      
      const messageBody = user.heard_count > 0 
        ? i18n.body(user.nickname || i18n.fallback, user.heard_count, user.missed_count)
        : i18n.body_zero_heard(user.nickname || i18n.fallback, user.missed_count);

      try {
        const pushResponse = await fetch(pushUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            type: 'user',
            userIds: [user.user_id],
            notification: {
              title: i18n.title,
              body: messageBody,
              data: { source: 'daily-fomo', date: new Date().toISOString().split('T')[0] }
            },
            priority: 'high',
            ttl: 86400
          })
        });

        const pushResult = await pushResponse.json();
        console.log(`[${requestId}] 📲 Push to ${user.nickname}: ${pushResponse.status}`, JSON.stringify(pushResult));
        
        results.push({ user_id: user.user_id, status: pushResponse.ok ? 'sent' : 'failed' });
        if (pushResponse.ok) userIdsNotified.push(user.user_id);

      } catch (pushErr) {
        console.error(`[${requestId}] ⚠️ Push failed for ${user.user_id}:`, pushErr.message);
        results.push({ user_id: user.user_id, status: 'error', error: pushErr.message });
      }
    }

    // 3. Mark cache as notified to avoid double-send
    if (userIdsNotified.length > 0) {
      await driveClient
        .from('daily_user_fomo_stats')
        .update({ notified_at: new Date().toISOString() })
        .in('user_id', userIdsNotified)
        .eq('summary_date', new Date(Date.now() - 86400000).toISOString().split('T')[0]);
    }

    console.log(`[${requestId}] ✅ Done. Sent: ${userIdsNotified.length}/${candidates.length}`);

    return new Response(JSON.stringify({ 
      success: true, 
      sent: userIdsNotified.length,
      total: candidates.length,
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error(`[${requestId}] 💥 Error:`, err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
