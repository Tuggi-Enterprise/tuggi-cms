
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Dicionário de Traduções (Personalidade Tuggi - Sem Emojis) ---
const TRANSLATIONS: Record<string, any> = {
  'pt-br': {
    title: 'Sua jornada de ontem',
    body: (name: string, heard: number, missed: number) => 
      `Ei ${name}! Sua jornada de ontem revelou ${heard} historias, mas ${missed} segredos ficaram pelo caminho. Que tal ligar o som e descobrir novos misterios hoje?`,
    body_zero_heard: (name: string, missed: number) => 
      `Viagem silenciosa, ${name}? Vimos que voce iniciou sua jornada, mas ${missed} historias ainda esperam para serem ouvidas por ai. Que tal ativar o guia hoje?`
  },
  'pt-pt': {
    title: 'A sua jornada de ontem',
    body: (name: string, heard: number, missed: number) => 
      `Olá ${name}! A sua jornada de ontem revelou ${heard} historias, mas ${missed} segredos ficaram pelo caminho. Que tal ligar o som e descobrir novos misterios hoje?`,
    body_zero_heard: (name: string, missed: number) => 
      `Viagem silenciosa, ${name}? Vimos que iniciou a sua jornada, mas ${missed} historias ainda esperam para serem ouvidas por ai. Que tal ativar o guia hoje?`
  },
  'en': {
    title: 'Your journey yesterday',
    body: (name: string, heard: number, missed: number) => 
      `Hey ${name}! Yesterdays journey uncovered ${heard} stories, but ${missed} secrets were left behind. Ready to tune in and discover new mysteries today?`,
    body_zero_heard: (name: string, missed: number) => 
      `A quiet trip, ${name}? We noticed you started your journey, but ${missed} stories are still waiting to be heard. How about turning on the guide today?`
  },
  'es': {
    title: 'Tu jornada de ayer',
    body: (name: string, heard: number, missed: number) => 
      `¡Hola ${name}! Tu jornada de ayer revelo ${heard} historias, pero ${missed} secretos quedaron por el camino. ¿Que tal encender el sonido y descubrir nuevos misterios hoje?`,
    body_zero_heard: (name: string, missed: number) => 
      `¿Viaje silencioso, ${name}? Vimos que iniciaste tu jornada, pero ${missed} historias aun esperan para ser escuchadas. ¿Que tal activar el guia hoy?`
  },
  'it': {
    title: 'Il tuo viaggio di ieri',
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

    // 1. Get Candidates (those at 07:00 AM local time)
    const { data: candidates, error: candidateError } = await supabase
      .rpc('get_morning_push_candidates');

    if (candidateError) throw candidateError;
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No candidates for current hour' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${requestId}] Found ${candidates.length} candidates to notify.`);

    const notificationsToSchedule = [];
    const userIdsNotified = [];

    // 2. Prepare Notifications
    for (const user of candidates) {
      const i18n = getTranslation(user.language);
      
      // Select body based on engagement
      const messageBody = user.heard_count > 0 
        ? i18n.body(user.nickname || 'Viajante', user.heard_count, user.missed_count)
        : i18n.body_zero_heard(user.nickname || 'Viajante', user.missed_count);

      notificationsToSchedule.push({
        type: 'user',
        title: i18n.title,
        body: messageBody,
        user_ids: [user.user_id],
        status: 'pending',
        scheduled_for: new Date().toISOString(), // Send as soon as possible
        priority: 'high',
        ttl: 86400 // Valid for 24h
      });

      userIdsNotified.push(user.user_id);
    }

    // 3. Batch Insert into core.scheduled_notifications
    if (notificationsToSchedule.length > 0) {
      const { error: insertError } = await supabase
        .schema('core')
        .from('scheduled_notifications')
        .insert(notificationsToSchedule);

      if (insertError) throw insertError;

      // 4. Mark cache as notified to avoid double-send
      await supabase
        .schema('drive')
        .from('daily_user_fomo_stats')
        .update({ notified_at: new Date().toISOString() })
        .in('user_id', userIdsNotified)
        .eq('summary_date', new Date(Date.now() - 86400000).toISOString().split('T')[0]); // "Yesterday" ISO string

      console.log(`[${requestId}] ✅ Successfully scheduled ${notificationsToSchedule.length} notifications.`);
    }

    return new Response(JSON.stringify({ success: true, processed: candidates.length }), {
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
