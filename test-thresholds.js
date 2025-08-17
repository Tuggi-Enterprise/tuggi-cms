const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testThresholds() {
  console.log('🔍 Verificando thresholds de aprovação...\n');

  try {
    // 1. Buscar configurações atuais
    const { data: settings, error: settingsError } = await supabase
      .schema('core')
      .from('verify_settings')
      .select('*');

    if (settingsError) {
      console.error('❌ Erro ao buscar configurações:', settingsError);
      return;
    }

    console.log('📊 Configurações atuais:');
    settings.forEach(setting => {
      console.log(`   ${setting.key}: ${JSON.stringify(setting.value)}`);
    });

    // 2. Testar lógica de determinação de status
    const testCases = [
      { factuality: 100, description: 'Factuality 100% (deveria ser approved)' },
      { factuality: 90, description: 'Factuality 90% (deveria ser approved)' },
      { factuality: 80, description: 'Factuality 80% (deveria ser needs_review)' },
      { factuality: 70, description: 'Factuality 70% (deveria ser needs_review)' },
      { factuality: 60, description: 'Factuality 60% (deveria ser rejected)' },
      { factuality: 50, description: 'Factuality 50% (deveria ser rejected)' },
      { factuality: 0, description: 'Factuality 0% (deveria ser rejected)' }
    ];

    console.log('\n🧪 Testando lógica de thresholds:');
    
    const factualityThresholds = settings.find(s => s.key === 'factuality_thresholds')?.value || { approve: 90, review: 70 };
    
    testCases.forEach(testCase => {
      let status;
      if (testCase.factuality >= factualityThresholds.approve) {
        status = 'approved';
      } else if (testCase.factuality >= factualityThresholds.review) {
        status = 'needs_review';
      } else {
        status = 'rejected';
      }
      
      console.log(`   ${testCase.description} → ${status}`);
    });

    // 3. Verificar scores recentes e seus status
    console.log('\n📊 Verificando scores recentes e status:');
    
    const { data: recentScores, error: scoresError } = await supabase
      .schema('core')
      .from('description_scores')
      .select('score_overall, subscores')
      .order('created_at', { ascending: false })
      .limit(10);

    if (!scoresError && recentScores) {
      recentScores.forEach((score, idx) => {
        const factuality = score.subscores?.factuality || 0;
        let expectedStatus;
        if (factuality >= factualityThresholds.approve) {
          expectedStatus = 'approved';
        } else if (factuality >= factualityThresholds.review) {
          expectedStatus = 'needs_review';
        } else {
          expectedStatus = 'rejected';
        }
        
        console.log(`   ${idx + 1}. Overall: ${score.score_overall}%, Factuality: ${factuality}% → Esperado: ${expectedStatus}`);
      });
    }

    // 4. Verificar status atual das descrições
    console.log('\n📋 Verificando status atual das descrições:');
    
    const { data: descriptions, error: descError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('verification_status, score')
      .not('verification_status', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(20);

    if (!descError && descriptions) {
      const statusCounts = descriptions.reduce((acc, desc) => {
        acc[desc.verification_status] = (acc[desc.verification_status] || 0) + 1;
        return acc;
      }, {});
      
      console.log(`   Status counts: ${JSON.stringify(statusCounts)}`);
      
      descriptions.slice(0, 10).forEach((desc, idx) => {
        console.log(`   ${idx + 1}. Status: ${desc.verification_status}, Score: ${desc.score}%`);
      });
    }

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

testThresholds();
