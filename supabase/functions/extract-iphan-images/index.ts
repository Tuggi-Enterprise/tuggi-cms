import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from "../_shared/cors.ts";

const PROJECT_URL = Deno.env.get('PROJECT_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || '';

// Use service role for admin operations
const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

interface RequestBody {
  attractionId: string;
  attractionName: string;
  searchQuery: string;
}

interface IPHANResult {
  title: string;
  description: string;
  imageUrl: string;
  source: string;
  location?: string;
}

// Function to search IPHAN website for heritage information
async function searchIPHANHeritage(searchQuery: string): Promise<IPHANResult[]> {
  const results: IPHANResult[] = [];
  
  try {
    console.log(`🔍 Searching IPHAN for: ${searchQuery}`);
    
    // Extract individual search terms for more specific searches
    const searchTerms = searchQuery.toLowerCase().split(' ').filter(term => 
      term.length > 2 && 
      !['de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nas', 'nos'].includes(term)
    );
    
    // Try multiple search strategies
    const searchStrategies = [
      // 1. Exact POI name search
      searchQuery,
      // 2. Individual significant terms
      ...searchTerms.slice(0, 2), // First 2 significant terms
      // 3. City-specific heritage search
      `${searchTerms[0]} patrimônio histórico`,
      // 4. Heritage type search
      `${searchTerms[0]} monumento`,
      `${searchTerms[0]} museu`,
      `${searchTerms[0]} igreja`,
      `${searchTerms[0]} teatro`
    ];
    
    // IPHAN search endpoints
    const searchUrls = [
      // Main IPHAN search
      `https://www.gov.br/iphan/pt-br/assuntos/noticias`,
      // Heritage database search  
      `https://www.gov.br/iphan/pt-br/patrimonio-cultural/patrimonio-material`,
      // Archaeological sites
      `https://sicg.iphan.gov.br/sicg/busca`
    ];

    for (const strategy of searchStrategies.slice(0, 3)) { // Limit to first 3 strategies
      for (const baseUrl of searchUrls) {
        try {
          const url = `${baseUrl}?q=${encodeURIComponent(strategy)}`;
          console.log(`   Trying: ${strategy} -> ${url}`);
          
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Tuggi-CMS/1.0 (https://tuggi.app; contact@tuggi.app)',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
              'Accept-Encoding': 'gzip, deflate, br',
              'Connection': 'keep-alive',
              'Upgrade-Insecure-Requests': '1'
            }
          });

          if (!response.ok) {
            console.log(`   ❌ HTTP ${response.status}: ${response.statusText}`);
            continue;
          }

          const html = await response.text();
          
          // Parse HTML to find images and heritage information
          const heritageData = parseIPHANHTML(html, strategy);
          
          // Filter results to be more specific to the search query
          const filteredData = heritageData.filter(result => 
            isRelevantToSearch(result, searchQuery, strategy)
          );
          
          results.push(...filteredData);
          
          console.log(`   ✅ Found ${filteredData.length} relevant heritage items`);
          
          // If we found specific results, we can stop here
          if (filteredData.length > 0 && isSpecificResult(filteredData[0], searchQuery)) {
            console.log(`   🎯 Found specific result, stopping search`);
            return results;
          }
          
          // Be respectful - wait between requests
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.log(`   💥 Error with ${strategy}: ${error.message}`);
        }
      }
    }

    return results;

  } catch (error) {
    console.error('Error searching IPHAN:', error);
    return [];
  }
}

// Parse IPHAN HTML to extract heritage information and images
function parseIPHANHTML(html: string, searchQuery: string): IPHANResult[] {
  const results: IPHANResult[] = [];
  
  try {
    // Look for heritage items in the HTML
    // IPHAN typically uses specific patterns for heritage listings
    
    // Pattern 1: Heritage cards with images
    const heritageCardPattern = /<div[^>]*class="[^"]*heritage[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
    const heritageCards = html.match(heritageCardPattern) || [];
    
    for (const card of heritageCards) {
      const result = extractHeritageFromCard(card, searchQuery);
      if (result) {
        results.push(result);
      }
    }
    
    // Pattern 2: News/notices with heritage images
    const newsPattern = /<article[^>]*>[\s\S]*?<\/article>/gi;
    const newsItems = html.match(newsPattern) || [];
    
    for (const item of newsItems) {
      const result = extractHeritageFromNews(item, searchQuery);
      if (result) {
        results.push(result);
      }
    }
    
    // Pattern 3: Direct image links in content
    const imagePattern = /<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi;
    let match;
    while ((match = imagePattern.exec(html)) !== null) {
      const [, src, alt] = match;
      
      // Check if image is related to heritage
      if (isHeritageRelated(src, alt, searchQuery)) {
        results.push({
          title: alt || `Patrimônio relacionado a ${searchQuery}`,
          description: `Imagem do patrimônio histórico brasileiro relacionado a ${searchQuery}`,
          imageUrl: src.startsWith('http') ? src : `https://www.gov.br${src}`,
          source: 'IPHAN - Instituto do Patrimônio Histórico e Artístico Nacional'
        });
      }
    }
    
  } catch (error) {
    console.error('Error parsing IPHAN HTML:', error);
  }
  
  return results;
}

// Extract heritage information from a card element
function extractHeritageFromCard(cardHTML: string, searchQuery: string): IPHANResult | null {
  try {
    // Look for title
    const titleMatch = cardHTML.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    
    // Look for description
    const descMatch = cardHTML.match(/<p[^>]*>([^<]+)<\/p>/i);
    const description = descMatch ? descMatch[1].trim() : '';
    
    // Look for image
    const imgMatch = cardHTML.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
    const imageUrl = imgMatch ? imgMatch[1] : '';
    
    if (title && imageUrl && isHeritageRelated(imageUrl, title, searchQuery)) {
      return {
        title: title,
        description: description || `Patrimônio histórico brasileiro: ${title}`,
        imageUrl: imageUrl.startsWith('http') ? imageUrl : `https://www.gov.br${imageUrl}`,
        source: 'IPHAN - Instituto do Patrimônio Histórico e Artístico Nacional'
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Extract heritage information from news/notice element
function extractHeritageFromNews(newsHTML: string, searchQuery: string): IPHANResult | null {
  try {
    // Look for title
    const titleMatch = newsHTML.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    
    // Look for image
    const imgMatch = newsHTML.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
    const imageUrl = imgMatch ? imgMatch[1] : '';
    
    if (title && imageUrl && isHeritageRelated(imageUrl, title, searchQuery)) {
      return {
        title: title,
        description: `Notícia do IPHAN sobre patrimônio: ${title}`,
        imageUrl: imageUrl.startsWith('http') ? imageUrl : `https://www.gov.br${imageUrl}`,
        source: 'IPHAN - Instituto do Patrimônio Histórico e Artístico Nacional'
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Check if image/content is related to heritage
function isHeritageRelated(imageUrl: string, text: string, searchQuery: string): boolean {
  const heritageKeywords = [
    'patrimônio', 'heritage', 'histórico', 'cultural', 'monumento', 'monument',
    'museu', 'museum', 'igreja', 'church', 'catedral', 'cathedral',
    'fortaleza', 'fort', 'castelo', 'castle', 'palácio', 'palace',
    'teatro', 'theater', 'biblioteca', 'library', 'arquivo', 'archive'
  ];
  
  const searchTerms = searchQuery.toLowerCase().split(' ');
  const combinedText = `${text} ${imageUrl}`.toLowerCase();
  
  // Check if any heritage keyword is present
  const hasHeritageKeyword = heritageKeywords.some(keyword => 
    combinedText.includes(keyword)
  );
  
  // Check if search terms are present
  const hasSearchTerms = searchTerms.some(term => 
    combinedText.includes(term.toLowerCase())
  );
  
  // Check if it's not a generic government image
  const isNotGeneric = !imageUrl.includes('logo') && 
                      !imageUrl.includes('banner') && 
                      !imageUrl.includes('icon') &&
                      !text.includes('logo') &&
                      !text.includes('banner');
  
  return (hasHeritageKeyword || hasSearchTerms) && isNotGeneric;
}

// Check if a result is relevant to the specific search query
function isRelevantToSearch(result: IPHANResult, originalQuery: string, searchStrategy: string): boolean {
  const queryTerms = originalQuery.toLowerCase().split(' ').filter(term => term.length > 2);
  const resultText = `${result.title} ${result.description}`.toLowerCase();
  
  // Check if the result contains significant terms from the original query
  const hasSignificantTerms = queryTerms.some(term => 
    resultText.includes(term.toLowerCase())
  );
  
  // Avoid generic IPHAN content
  const isNotGeneric = !result.title.includes('Biblioteca Amadeu Amaral') &&
                      !result.title.includes('Escritório Técnico') &&
                      !result.title.includes('Andanças do Patrimônio') &&
                      !result.title.includes('Iphan promove') &&
                      !result.title.includes('Iphan recebe') &&
                      !result.title.includes('Seminário') &&
                      !result.title.includes('Patrimônio Material') &&
                      !result.title.includes('Mapa do Patrimônio');
  
  return hasSignificantTerms && isNotGeneric;
}

// Check if a result is specific enough to stop searching
function isSpecificResult(result: IPHANResult, searchQuery: string): boolean {
  const queryTerms = searchQuery.toLowerCase().split(' ').filter(term => term.length > 2);
  const resultText = `${result.title} ${result.description}`.toLowerCase();
  
  // Check if the result title contains the main search terms
  const hasMainTerms = queryTerms.slice(0, 2).every(term => 
    resultText.includes(term.toLowerCase())
  );
  
  // Check if it's not a generic result
  const isNotGeneric = !result.title.includes('Biblioteca Amadeu Amaral') &&
                      !result.title.includes('Escritório Técnico') &&
                      !result.title.includes('Andanças do Patrimônio') &&
                      !result.title.includes('Iphan promove') &&
                      !result.title.includes('Iphan recebe') &&
                      !result.title.includes('Seminário') &&
                      !result.title.includes('Patrimônio Material') &&
                      !result.title.includes('Mapa do Patrimônio');
  
  return hasMainTerms && isNotGeneric;
}

// Download and store IPHAN image
async function downloadAndStoreIPHANImage(
  imageUrl: string, 
  attractionId: string, 
  title: string
): Promise<string> {
  try {
    console.log(`📥 Downloading IPHAN image: ${imageUrl}`);
    
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Tuggi-CMS/1.0 (https://tuggi.app; contact@tuggi.app)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    const imageData = await response.arrayBuffer();
    
    // Generate filename
    const timestamp = Date.now();
    const cleanTitle = title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const fileName = `${attractionId}_iphan_${cleanTitle}_${timestamp}.jpg`;
    
    // Store in bucket
    const storagePath = `attractions/${attractionId}/iphan/${fileName}`;
    
    const { error } = await supabaseAdmin.storage
      .from('travel-app-images')
      .upload(storagePath, imageData, {
        contentType: 'image/jpeg',
        upsert: true
      });
    
    if (error) {
      throw new Error(`Failed to upload image: ${error.message}`);
    }
    
    return storagePath;
    
  } catch (error) {
    throw new Error(`Failed to download and store IPHAN image: ${error.message}`);
  }
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  console.log(`[${requestId}] extract-iphan-images function called`);

  try {
    if (req.method !== 'POST') {
      throw new Error('Method not allowed');
    }

    const body: RequestBody = await req.json();
    console.log(`[${requestId}] Request body:`, JSON.stringify(body, null, 2));

    const { attractionId, attractionName, searchQuery } = body;

    // Validate required fields
    if (!attractionId || !attractionName || !searchQuery) {
      throw new Error('Missing required fields: attractionId, attractionName, searchQuery');
    }

    console.log(`[${requestId}] Searching IPHAN for: ${attractionName}`);

    // Search IPHAN for heritage information
    const heritageResults = await searchIPHANHeritage(searchQuery);

    if (heritageResults.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'No heritage information found on IPHAN website',
          results: []
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // Try to download and store the first suitable image
    let storedImageUrl = null;
    let storedImagePath = null;

    for (const result of heritageResults) {
      try {
        console.log(`[${requestId}] Trying to store image: ${result.title}`);
        
        storedImagePath = await downloadAndStoreIPHANImage(
          result.imageUrl,
          attractionId,
          result.title
        );
        
        // Generate public URL
        const { data: publicUrlData } = supabaseAdmin.storage
          .from('travel-app-images')
          .getPublicUrl(storedImagePath);
        
        storedImageUrl = publicUrlData.publicUrl;
        
        console.log(`[${requestId}] Successfully stored IPHAN image: ${storedImagePath}`);
        break;
        
      } catch (error) {
        console.log(`[${requestId}] Failed to store image: ${error.message}`);
        continue;
      }
    }

    if (storedImageUrl) {
      // Update attraction with IPHAN image
      await supabaseAdmin
        .schema('core')
        .from('attractions')
        .update({ 
          image_url: storedImageUrl,
          image_source: 'iphan'
        })
        .eq('id', attractionId);
      
      console.log(`[${requestId}] Updated attraction ${attractionId} with IPHAN image`);
    }

    return new Response(
      JSON.stringify({
        success: storedImageUrl ? true : false,
        message: storedImageUrl ? 'IPHAN image extracted and stored successfully' : 'IPHAN data found but no suitable images could be stored',
        imageUrl: storedImageUrl,
        results: heritageResults,
        stored: storedImageUrl ? 1 : 0,
        found: heritageResults.length
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );

  } catch (error) {
    console.error(`[${requestId}] Error in extract-iphan-images function:`, error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
