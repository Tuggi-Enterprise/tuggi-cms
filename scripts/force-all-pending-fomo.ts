
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// --- Tuggi Voice Translations (Same as EF) ---
const TRANSLATIONS: any = {
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
      `Ehi ${name}! Il tuo viaggio di ieri ha svelato ${heard} storie, ma ${missed} segreti sono rimasti lungo a strada. Che ne dici di accendere il suono e scoprire novos misteri oggi?`,
    body_zero_heard: (name: string, missed: number) => 
      `Viaggio silenzioso, ${name}? Abbiamo notato que hai iniziato il tuo viaggio, mas ${missed} storie aspettano ancora di essere ascoltate. Che ne dici di attivare la guida hoje?`
  },
  'en': {
    title: 'Your journey yesterday',
    body: (name: string, heard: number, missed: number) => 
      `Hey ${name}! Yesterdays journey uncovered ${heard} stories, but ${missed} secrets were left behind. Ready to tune in and discover new mysteries today?`,
    body_zero_heard: (name: string, missed: number) => 
      `A quiet trip, ${name}? We noticed you started your journey, but ${missed} stories are still waiting to be heard. How about turning on the guide today?`
  }
};

const getTranslation = (lang: string) => {
  const code = (lang || 'pt-br').toLowerCase();
  if (code.startsWith('pt-br')) return TRANSLATIONS['pt-br'];
  if (code.startsWith('pt-pt')) return TRANSLATIONS['pt-pt'];
  if (code.startsWith('pt')) return TRANSLATIONS['pt-br'];
  if (code.startsWith('es')) return TRANSLATIONS['es']; 
  if (code.startsWith('it')) return TRANSLATIONS['it'];
  return TRANSLATIONS['en'];
};

async function forceAllPendingFomoPushes() {
  console.log('🚀 [FORCE ALL] Starting catch-up for ALL pending entries...\n');
  
  const { data: candidates, error: candError } = await supabase
    .schema('drive')
    .from('daily_user_fomo_stats')
    .select('user_id, summary_date, nickname, language, heard_count, missed_count')
    .is('notified_at', null);

  if (candError) {
    console.error('❌ Error finding candidates:', candError.message);
    return;
  }

  if (!candidates || candidates.length === 0) {
    console.log('✅ No pending candidates found. Everything is up to date!');
    return;
  }

  console.log(`🎯 Found ${candidates.length} pending pushes to send.`);

  const pushUrl = `${supabaseUrl}/functions/v1/firebase-push-notification/send`;

  for (const user of candidates) {
    const i18n = getTranslation(user.language);
    const body = user.heard_count > 0 
        ? i18n.body(user.nickname || 'Viajante', user.heard_count, user.missed_count)
        : i18n.body_zero_heard(user.nickname || 'Viajante', user.missed_count);

    console.log(`📤 Sending to ${user.nickname} (${user.user_id}) - Date: ${user.summary_date}...`);
    
    try {
        const response = await fetch(pushUrl, {
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
                    body: body,
                    data: { source: 'manual-force-all', date: user.summary_date }
                },
                priority: 'high',
                ttl: 86400
            })
        });

        if (response.ok) {
            console.log(`✅ Push sent to ${user.user_id}`);
            // Mark individual as notified immediately to avoid issues if script crashes
            await supabase
                .schema('drive')
                .from('daily_user_fomo_stats')
                .update({ notified_at: new Date().toISOString() })
                .eq('user_id', user.user_id)
                .eq('summary_date', user.summary_date);
            
        } else {
            const err = await response.json();
            console.error(`❌ Failed for ${user.user_id}:`, JSON.stringify(err));
        }
    } catch (e: any) {
        console.error(`❌ Fatal error for ${user.user_id}:`, e.message);
    }
  }

  console.log('\n🎉 Finished processing all pending pushes.');
}

forceAllPendingFomoPushes().catch(console.error);
