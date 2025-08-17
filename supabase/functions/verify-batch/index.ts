import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import crypto from 'https://deno.land/std@0.168.0/node/crypto.ts';

// Import verification libraries
import { extractClaims } from '../../lib/claims/extract.ts';
import { checkClaimWithEscalation } from '../../lib/claims/check.ts';
import { getContextForClaims } from '../../lib/rag/wiki.ts';
import { getContextFromAttractionSources } from '../../lib/rag/attraction-sources.ts';
import { evaluateText } from '../../lib/text/evaluate.ts';
import { computeVerificationScores, determineVerificationStatus, getVerificationSettings } from '../../lib/score/compute.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log('Received request body:', body);
    
    const { description_id, description, attraction_id, force_reprocess = false } = body;

    if (!description_id || !description || !attraction_id) {
      console.error('Missing required parameters:', { description_id, description: !!description, attraction_id });
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if description is original and get attraction_id
    const { data: descData, error: descError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('is_original, description_hash, attraction_id')
      .eq('id', description_id)
      .single();

    if (descError || !descData) {
      return new Response(
        JSON.stringify({ error: 'Description not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!descData.is_original && !force_reprocess) {
      return new Response(
        JSON.stringify({ error: 'Only original descriptions can be verified' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use the attraction_id from the database instead of the one passed in
    const actualAttractionId = descData.attraction_id;

    // Calculate description hash
    const descriptionHash = crypto
      .createHash('sha256')
      .update(description)
      .digest('hex');

    // Check if we already have a recent score for this hash
    if (!force_reprocess) {
      const { data: existingScore } = await supabase
        .schema('core')
        .from('description_scores')
        .select('id')
        .eq('description_hash', descriptionHash)
        .order('processed_at', { ascending: false })
        .limit(1)
        .single();

      if (existingScore) {
        return new Response(
          JSON.stringify({ 
            message: 'Description already verified with this hash',
            score_id: existingScore.id 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Step 1: Extract claims from description
    console.log(`Extracting claims from description ${description_id}`);
    const claimsResult = await extractClaims(description);
    
    if (!claimsResult.claims || claimsResult.claims.length === 0) {
      console.log(`No claims extracted from description ${description_id}`);
    }

    // Step 2: Get context for claims
    console.log(`Getting context for ${claimsResult.claims.length} claims`);
    
    // Buscar informações completas da atração (incluindo fontes)
    const { data: attractionData } = await supabase
      .schema('core')
      .from('attractions')
      .select('name, website, reference_links, city, country')
      .eq('id', actualAttractionId)
      .single();
    
    const attractionName = attractionData?.name;
    
    // Buscar fontes primárias da atração
    let attractionSources: any[] = [];
    if (attractionData && (attractionData.website || attractionData.reference_links)) {
      console.log(`🔍 Buscando fontes primárias: website=${!!attractionData.website}, ref_links=${attractionData.reference_links?.length || 0}`);
      
      try {
        attractionSources = await getContextFromAttractionSources(attractionData, claimsResult.claims.map(c => c.text));
        console.log(`✅ Encontradas ${attractionSources.length} fontes primárias`);
      } catch (error) {
        console.error('❌ Erro ao buscar fontes primárias:', error);
        // Continuar com fontes externas apenas
      }
    }
    
    // Limitar claims para evitar timeout (máximo 3 claims por descrição)
    const claimsToProcess = claimsResult.claims.slice(0, 3);
    const context = await getContextForClaims(
      claimsToProcess.map(c => c.text), 
      attractionName, 
      attractionSources,
      { city: attractionData?.city, country: attractionData?.country },
      supabase
    );

    // Step 3: Check each claim
    console.log(`Checking ${claimsToProcess.length} claims with ${context.length} context sources`);
    console.log(`Context sources: ${context.map(c => c.source).join(', ')}`);
    const checkedClaims = [];
    
    for (const claim of claimsToProcess) {
      try {
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Convert context array to string for LLM
        const contextString = context.map(ctx => 
          `Source: ${ctx.source}\nTitle: ${ctx.title}\nContent: ${ctx.content}\nURL: ${ctx.url || 'N/A'}\n`
        ).join('\n---\n');
        
        const checkResult = await checkClaimWithEscalation(claim.text, contextString);
        
        // Extract evidence from context based on claim verification
        const evidence = context
          .filter(ctx => ctx.relevance > 0.3) // Only relevant sources
          .map(ctx => ({
            source: ctx.source,
            page_title: ctx.title,
            url: ctx.url || '',
            quote: ctx.content?.substring(0, 200) || 'N/A',
            relevance_score: ctx.relevance || 0.5
          }))
          .slice(0, 3); // Limit to 3 evidence items
        
        console.log(`✅ Claim verificado: "${claim.text}" - Status: ${checkResult.status}, Evidence: ${evidence.length}`);
        
        checkedClaims.push({
          ...claim,
          status: checkResult.status,
          confidence: checkResult.confidence,
          evidence: evidence,
          reasoning: checkResult.reasoning
        });
      } catch (error) {
        console.error(`Error checking claim "${claim.text}":`, error);
        checkedClaims.push({
          ...claim,
          status: 'not_found',
          confidence: 0.0,
          evidence: [],
          reasoning: 'Error occurred during verification'
        });
      }
    }

    // Step 4: Evaluate text quality
    console.log(`Evaluating text quality for description ${description_id}`);
    const textEvaluation = evaluateText(description);

    // Step 5: Compute verification scores
    console.log(`Computing verification scores for description ${description_id}`);
    
    // Calculate real scores based on claims verification
    const supportedClaims = checkedClaims.filter(c => c.status === 'supported').length;
    const contradictedClaims = checkedClaims.filter(c => c.status === 'contradicted').length;
    const notFoundClaims = checkedClaims.filter(c => c.status === 'not_found').length;
    const totalClaims = checkedClaims.length;
    
    // Calculate factuality score (0-100)
    let factualityScore = 0;
    if (totalClaims > 0) {
      const supportedWeight = supportedClaims * 100;
      const contradictedWeight = contradictedClaims * -50; // Penalize contradicted claims heavily
      const notFoundWeight = notFoundClaims * 0; // Neutral for not found
      factualityScore = Math.max(0, Math.min(100, (supportedWeight + contradictedWeight + notFoundWeight) / totalClaims));
    } else {
      // If no claims extracted, give a neutral score based on text quality
      factualityScore = 50; // Neutral score when no claims to verify
    }
    
    // Calculate TTS clarity score based on text evaluation
    const ttsScore = Math.round((textEvaluation.tts_clarity || 0.75) * 100);
    
    // Calculate rules score based on text evaluation
    const rulesScore = Math.round((textEvaluation.rules_score || 0.75) * 100);
    
    // Coherence score (more dynamic based on text evaluation)
    let coherenceScore = 70; // Base score
    
    // Adjust based on description length
    if (description.length >= 100 && description.length <= 300) {
      coherenceScore += 20; // Good length
    } else if (description.length > 300) {
      coherenceScore += 10; // Acceptable length
    } else if (description.length < 50) {
      coherenceScore -= 20; // Too short
    }
    
    // Adjust based on text evaluation issues
    if (textEvaluation.issues && textEvaluation.issues.length > 0) {
      coherenceScore -= Math.min(20, textEvaluation.issues.length * 5); // Penalize issues
    }
    
    // Bonus for good structure
    if (textEvaluation.suggestions && textEvaluation.suggestions.length === 0) {
      coherenceScore += 10; // No suggestions means good structure
    }
    
    coherenceScore = Math.max(0, Math.min(100, coherenceScore));
    
    // Check for contradictions and issues
    const flags = [];
    if (contradictedClaims > 0) {
      flags.push('contradiction');
    }
    if (totalClaims === 0) {
      flags.push('no_claims_extracted');
    }
    if (supportedClaims === 0 && totalClaims > 0) {
      flags.push('no_supported_claims');
    }
    
    // Add flags based on text evaluation
    if (textEvaluation.issues && textEvaluation.issues.length > 0) {
      flags.push(`text_issues:${textEvaluation.issues.length}`);
    }
    
    // Add quality indicators
    if (factualityScore >= 80) {
      flags.push('high_factuality');
    } else if (factualityScore <= 20) {
      flags.push('low_factuality');
    }
    
    if (coherenceScore >= 80) {
      flags.push('high_coherence');
    } else if (coherenceScore <= 20) {
      flags.push('low_coherence');
    }
    
    // Calculate overall score using configured weights
    const settings = await getVerificationSettings();
    const weights = settings.scorer_weights;
    
    const overallScore = Math.round(
      (factualityScore * weights.factuality) +
      (coherenceScore * weights.coherence) +
      (ttsScore * weights.tts_clarity) +
      (rulesScore * weights.rules)
    );
    
    const verificationScores = {
      score_overall: overallScore,
      subscores: {
        factuality: Math.round(factualityScore),
        coherence: Math.round(coherenceScore),
        tts_clarity: Math.round(ttsScore),
        rules: Math.round(rulesScore)
      },
      flags,
      confidence: totalClaims > 0 ? (supportedClaims / totalClaims) : 0,
      reasoning: {
        total_claims: totalClaims,
        supported_claims: supportedClaims,
        contradicted_claims: contradictedClaims,
        not_found_claims: notFoundClaims,
        description_length: description.length,
        weights_used: weights
      }
    };
    
    console.log(`📊 Calculated scores:`, {
      overall: overallScore,
      factuality: factualityScore,
      supported: supportedClaims,
      total: totalClaims,
      flags
    });

    // Step 6: Determine verification status
    const verificationStatus = await determineVerificationStatus(
      verificationScores.subscores.factuality / 100, // Convert from percentage to 0-1
      verificationScores.flags
    );

    // Step 7: Save verification score
    console.log(`Saving verification score for description ${description_id}`);
    
    const { data: scoreData, error: scoreError } = await supabase
      .schema('core')
      .from('description_scores')
      .insert({
        description_id,
        attraction_id: actualAttractionId,
        lang: 'pt-BR',
        description_hash: descriptionHash,
        score_overall: verificationScores.score_overall,
        subscores: verificationScores.subscores,
        flags: flags,
        verifier_version: 'v2.0',
        llm_model: 'gemini-2.0-flash-thinking',
        confidence: verificationScores.confidence
      })
      .select()
      .single();

    if (scoreError) {
      console.error('Error saving verification score:', scoreError);
      return new Response(
        JSON.stringify({ error: 'Failed to save verification score' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 8: Save claims and evidence
    if (checkedClaims.length > 0) {
      console.log(`Saving ${checkedClaims.length} claims for description ${description_id}`);
      
      for (const claim of checkedClaims) {
        // Insert claim
        const { data: claimData, error: claimError } = await supabase
          .schema('core')
          .from('description_claims')
          .insert({
            description_id,
            score_id: scoreData.id,
            claim_type: claim.type,
            slot: claim.type, // Using claim type as slot for now
            value: claim.text,
            status: claim.status,
            weight: claim.confidence
          })
          .select()
          .single();

        if (claimError) {
          console.error('Error saving claim:', claimError);
          continue;
        }

                  // Insert evidence for this claim
          if (claim.evidence && claim.evidence.length > 0) {
            console.log(`💾 Salvando ${claim.evidence.length} evidências para claim: ${claim.text}`);
            
            const evidenceData = claim.evidence.map(evidence => {
              // Determine verdict based on claim status and relevance
              let verdict = 'not_found';
              if (claim.status === 'supported' && evidence.relevance_score > 0.5) {
                verdict = 'supported';
              } else if (claim.status === 'contradicted') {
                verdict = 'contradicted';
              }
              
              return {
                claim_id: claimData.id,
                source: evidence.source || 'unknown',
                page: evidence.page_title || evidence.title || 'N/A',
                url: evidence.url || '',
                quote: evidence.quote ? evidence.quote.substring(0, 200) : 'N/A',
                verdict: verdict
              };
            });

            const { error: evidenceError } = await supabase
              .schema('core')
              .from('description_claim_evidence')
              .insert(evidenceData);

            if (evidenceError) {
              console.error('Error saving evidence:', evidenceError);
            }
          }
      }
    }

    // Step 9: Update description hash
    await supabase
      .schema('core')
      .from('attraction_descriptions')
      .update({ description_hash: descriptionHash })
      .eq('id', description_id);

    console.log(`Successfully processed description ${description_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        description_id,
        score_id: scoreData.id,
        score_overall: verificationScores.score_overall,
        subscores: verificationScores.subscores,
        claims_processed: checkedClaims.length,
        reasoning: verificationScores.reasoning,
        flags: verificationScores.flags
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in verify-batch function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper function to get verification settings
async function getVerificationSettings() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: settings } = await supabase
    .schema('core')
    .from('verify_settings')
    .select('key, value')
    .in('key', ['scorer_weights', 'factuality_thresholds']);

  const settingsMap = new Map(settings?.map(s => [s.key, s.value]) || []);

  return {
    scorer_weights: settingsMap.get('scorer_weights') || {
      factuality: 0.4,
      coherence: 0.2,
      tts_clarity: 0.2,
      rules: 0.2
    },
    factuality_thresholds: settingsMap.get('factuality_thresholds') || {
      excellent: 0.9,
      good: 0.7,
      acceptable: 0.5,
      poor: 0.3
    }
  };
}
