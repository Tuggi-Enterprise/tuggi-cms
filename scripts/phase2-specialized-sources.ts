/**
 * Phase 2: Specialized Image Sources Integration
 * Uses country_verification_sources table for region-specific image APIs
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'fs/promises';
import { join } from 'path';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface VerificationSource {
  id: string;
  source_name: string;
  source_type: string;
  base_url: string;
  search_endpoint?: string;
  api_key_required: boolean;
  priority: number;
  is_active: boolean;
  config: any;
  country_code?: string;
}

interface ImageSearchConfig {
  source: VerificationSource;
  searchQuery: string;
  filters: {
    imageType?: string;
    license?: string;
    minWidth?: number;
    minHeight?: number;
    format?: string[];
  };
}

interface SpecializedImageResult {
  success: boolean;
  source: string;
  imageUrl?: string;
  metadata?: {
    title?: string;
    description?: string;
    license?: string;
    author?: string;
    dimensions?: { width: number; height: number };
    fileSize?: number;
    format?: string;
  };
  error?: string;
}

// Specialized source processors - mapped to actual source types in database
const SOURCE_PROCESSORS = {
  'government': processGovernmentSources,
  'heritage': processHeritageSources,
  'academic': processAcademicSources,
  'media': processMediaSources,
  'encyclopedia': processEncyclopediaSources,
  'museum': processMuseumAPIImages,
  'attraction': processGovernmentTourismImages,
  'tourism': processGovernmentTourismImages,
  'government_official': processGovernmentSources,
  'government_tourism': processGovernmentTourismImages,
  'official_museum': processMuseumAPIImages,
  'cultural_directory': processCulturalHeritageImages,
  'travel_guide': processGovernmentTourismImages,
  'travel_platform': processGovernmentTourismImages,
  'tourism_portal': processGovernmentTourismImages,
  'international_organization': processEuropeanaImages,
  'europeana': processEuropeanaImages,
  'cultural_heritage': processCulturalHeritageImages,
  'museum_api': processMuseumAPIImages,
  'national_library': processNationalLibraryImages,
  'city_portal': processCityPortalImages
};

async function getCountryVerificationSources(countryCode: string): Promise<VerificationSource[]> {
  console.log(`🔍 Loading specialized sources for country: ${countryCode}`);

  const { data: sources, error } = await supabase
    .schema('core')
    .from('country_verification_sources')
    .select(`
      *,
      countries!inner(code, name, language_code)
    `)
    .eq('countries.code', countryCode)
    .eq('is_active', true)
    .order('priority', { ascending: true });

  if (error) {
    console.error(`Error loading sources for ${countryCode}:`, error);
    return [];
  }

  return sources || [];
}

async function getCountryCodeForPOI(city: string, country: string): Promise<string> {
  // Enhanced country mapping
  const countryCodeMap: Record<string, string> = {
    'Brazil': 'BR', 'Brasil': 'BR',
    'España': 'ES', 'Spain': 'ES', 'Espanha': 'ES',
    'United States': 'US', 'USA': 'US', 'Estados Unidos': 'US',
    'Ireland': 'IE', 'Irlanda': 'IE',
    'México': 'MX', 'Mexico': 'MX',
    'Chile': 'CL',
    'Argentina': 'AR',
    'Colombia': 'CO', 'Colômbia': 'CO',
    'Peru': 'PE', 'Perú': 'PE',
    'Portugal': 'PT',
    'France': 'FR', 'França': 'FR',
    'Italy': 'IT', 'Itália': 'IT',
    'Germany': 'DE', 'Alemanha': 'DE',
    'United Kingdom': 'GB', 'Reino Unido': 'GB'
  };

  return countryCodeMap[country] || country.toUpperCase();
}

// Government sources processor (IPHAN, Ministério da Cultura, etc.)
async function processGovernmentSources(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    console.log(`🏛️  Processing government source: ${source.source_name}`);
    
    // For Brazilian government sources
    if (source.source_name.includes('IPHAN')) {
      return await processIPHANImages(config);
    }
    
    if (source.source_name.includes('Ministério da Cultura')) {
      return await processCulturaGovImages(config);
    }
    
    if (source.source_name.includes('Biblioteca Nacional')) {
      return await processBibliotecaNacionalImages(config);
    }
    
    if (source.source_name.includes('IBGE')) {
      return await processIBGEImages(config);
    }
    
    // Spanish government sources
    if (source.source_name.includes('Ministerio de Cultura')) {
      return await processSpanishCultureMinistry(config);
    }
    
    if (source.source_name.includes('Instituto del Patrimonio Cultural')) {
      return await processSpanishHeritage(config);
    }
    
    // Generic government source fallback
    return await processGenericGovernmentSource(config);
    
  } catch (error) {
    return {
      success: false,
      source: source.source_name,
      error: error.message
    };
  }
}

// Heritage sources processor (Museums, Cultural institutions)
async function processHeritageSources(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    console.log(`🏛️  Processing heritage source: ${source.source_name}`);
    
    if (source.source_name.includes('Museu Nacional')) {
      return await processMuseuNacionalImages(config);
    }
    
    if (source.source_name.includes('MASP') || source.source_name.includes('Museu de Arte de São Paulo')) {
      return await processMASPImages(config);
    }
    
    if (source.source_name.includes('Instituto Moreira Salles')) {
      return await processMoreiraSallesImages(config);
    }
    
    if (source.source_name.includes('Prado')) {
      return await processMuseoPradoImages(config);
    }
    
    if (source.source_name.includes('Reina Sofía')) {
      return await processReinaSofiaImages(config);
    }
    
    return await processGenericHeritageSource(config);
    
  } catch (error) {
    return {
      success: false,
      source: source.source_name,
      error: error.message
    };
  }
}

// Academic sources processor
async function processAcademicSources(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    console.log(`🎓 Processing academic source: ${source.source_name}`);
    
    if (source.source_name.includes('SciELO')) {
      return await processSciELOImages(config);
    }
    
    if (source.source_name.includes('CAPES')) {
      return await processCAPESImages(config);
    }
    
    if (source.source_name.includes('CSIC')) {
      return await processCSICImages(config);
    }
    
    return await processGenericAcademicSource(config);
    
  } catch (error) {
    return {
      success: false,
      source: source.source_name,
      error: error.message
    };
  }
}

// Media sources processor
async function processMediaSources(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    console.log(`📰 Processing media source: ${source.source_name}`);
    
    // Media sources typically have image archives
    if (source.source_name.includes('Agência Brasil')) {
      return await processAgenciaBrasilImages(config);
    }
    
    if (source.source_name.includes('BBC Brasil')) {
      return await processBBCBrasilImages(config);
    }
    
    return await processGenericMediaSource(config);
    
  } catch (error) {
    return {
      success: false,
      source: source.source_name,
      error: error.message
    };
  }
}

// Encyclopedia sources processor (Wikipedia, etc.)
async function processEncyclopediaSources(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    console.log(`📚 Processing encyclopedia source: ${source.source_name}`);
    
    if (source.source_name.includes('Wikipedia')) {
      return await processWikipediaSpecialized(config);
    }
    
    return await processGenericEncyclopediaSource(config);
    
  } catch (error) {
    return {
      success: false,
      source: source.source_name,
      error: error.message
    };
  }
}

// Europeana API integration (for European cultural heritage)
async function processEuropeanaImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    console.log(`🏛️  Searching Europeana for: ${searchQuery}`);
    
    // Europeana API endpoint - free API with demo key
    const apiUrl = 'https://api.europeana.eu/record/v2/search.json';
    const params = new URLSearchParams({
      wskey: process.env.EUROPEANA_API_KEY || 'DEMO_KEY',
      query: searchQuery,
      media: 'true',
      thumbnail: 'true',
      rows: '10',
      sort: 'score desc',
      qf: ['TYPE:IMAGE', 'MIME_TYPE:image/*', 'RIGHTS:http://creativecommons.org/*']
    });

    const response = await fetch(`${apiUrl}?${params}`);
    
    if (!response.ok) {
      throw new Error(`Europeana API error: ${response.status}`);
    }
    
    const data = await response.json();

    if (data.items && data.items.length > 0) {
      // Find the best quality image
      for (const item of data.items) {
        const imageUrl = item.edmPreview?.[0] || item.edmObject?.[0];
        
        if (imageUrl && !imageUrl.includes('thumbnail')) {
          // Check if it's a high-quality image
          const metadata = {
            title: Array.isArray(item.title) ? item.title[0] : item.title || 'Europeana Item',
            description: Array.isArray(item.dcDescription) ? item.dcDescription[0] : item.dcDescription || '',
            license: Array.isArray(item.rights) ? item.rights[0] : item.rights || 'Unknown',
            author: Array.isArray(item.dcCreator) ? item.dcCreator[0] : item.dcCreator || 'Unknown',
            format: 'jpg',
            source_url: item.guid || item.id
          };
          
          // Only return items with Creative Commons or public domain licenses
          if (metadata.license.includes('creativecommons.org') || 
              metadata.license.includes('publicdomain')) {
            return {
              success: true,
              source: 'Europeana',
              imageUrl,
              metadata
            };
          }
        }
      }
    }

    return { 
      success: false, 
      source: 'Europeana', 
      error: 'No suitable CC-licensed images found' 
    };

  } catch (error) {
    return { 
      success: false, 
      source: 'Europeana', 
      error: error.message 
    };
  }
}

// Government Tourism APIs (Brasil, Spain, etc.)
async function processGovernmentTourismImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    // Example for Brazilian tourism API
    if (source.config.country === 'BR') {
      return await processBrazilianTourismAPI(config);
    }
    
    // Generic government tourism processing
    const searchUrl = `${source.base_url}${source.search_endpoint}`;
    const params = {
      q: searchQuery,
      type: 'image',
      format: 'json'
    };

    // Add API key if required
    if (source.api_key_required && source.config.api_key) {
      params['key'] = source.config.api_key;
    }

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    const data = await response.json();
    
    // Process government tourism response
    if (data.results && data.results.length > 0) {
      const result = data.results[0];
      return {
        success: true,
        source: 'government_tourism',
        imageUrl: result.imageUrl || result.url,
        metadata: {
          title: result.title,
          description: result.description,
          license: 'government_public_domain',
          format: result.format || 'jpg'
        }
      };
    }

    return { success: false, source: 'government_tourism', error: 'No images found' };

  } catch (error) {
    return { 
      success: false, 
      source: 'government_tourism', 
      error: error.message 
    };
  }
}

// Brazilian Tourism API specific implementation
async function processBrazilianTourismAPI(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  // Implementation for Brazilian government tourism sources
  // This would integrate with Embratur, state tourism boards, etc.
  return { 
    success: false, 
    source: 'brazil_tourism', 
    error: 'Not implemented yet' 
  };
}

// Cultural Heritage APIs
async function processCulturalHeritageImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return { 
    success: false, 
    source: 'cultural_heritage', 
    error: 'Not implemented yet' 
  };
}

// Museum APIs (for museum POIs)
async function processMuseumAPIImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    // Smithsonian Open Access API
    // Documentation: https://www.si.edu/openaccess/devtools
    console.log(`🏛️  Searching Smithsonian Open Access for: ${searchQuery}`);
    
    const apiUrl = 'https://api.si.edu/openaccess/api/v1.0/search';
    const params = new URLSearchParams({
      'api_key': process.env.SMITHSONIAN_API_KEY || 'DEMO_KEY',
      'q': searchQuery,
      'media.type': 'Images',
      'online_media_type': 'Images',
      'rows': '10',
      'sort': 'relevancy desc'
    });

    const response = await fetch(`${apiUrl}?${params}`);
    
    if (!response.ok) {
      throw new Error(`Smithsonian API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.response && data.response.rows && data.response.rows.length > 0) {
      const item = data.response.rows[0];
      
      // Find the best quality image
      let imageUrl = null;
      let imageMetadata = {};
      
      if (item.content && item.content.descriptiveNonRepeating && item.content.descriptiveNonRepeating.online_media) {
        const media = item.content.descriptiveNonRepeating.online_media.media[0];
        if (media && media.content) {
          imageUrl = media.content;
          imageMetadata = {
            title: item.title || 'Smithsonian Collection Item',
            description: item.content?.freetext?.notes?.[0]?.content || '',
            license: 'CC0 - Public Domain',
            author: item.content?.descriptiveNonRepeating?.data_source || 'Smithsonian Institution',
            format: media.mime_type?.split('/')?.[1] || 'jpg',
            dimensions: {
              width: media.width || 0,
              height: media.height || 0
            }
          };
        }
      }
      
      if (imageUrl) {
        return {
          success: true,
          source: 'Smithsonian',
          imageUrl,
          metadata: imageMetadata
        };
      }
    }

    return {
      success: false,
      source: 'Smithsonian',
      error: 'No suitable images found in collection'
    };

  } catch (error) {
    return {
      success: false,
      source: 'Smithsonian',
      error: error.message
    };
  }
}

// National Library APIs (Library of Congress, Biblioteca Nacional, etc.)
async function processNationalLibraryImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    // Check if it's Library of Congress
    if (source.base_url.includes('loc.gov')) {
      return await processLibraryOfCongressImages(config);
    }
    
    // Check if it's Biblioteca Nacional Digital (Brazil)
    if (source.base_url.includes('bn.gov.br') || source.source_name.includes('Biblioteca Nacional')) {
      return await processBibliotecaNacionalDigital(config);
    }
    
    // Generic national library fallback
    console.log(`📚 Searching ${source.source_name} for: ${searchQuery}`);
    
    return {
      success: false,
      source: source.source_name,
      error: 'Generic national library integration not implemented'
    };
    
  } catch (error) {
    return {
      success: false,
      source: source.source_name,
      error: error.message
    };
  }
}

// Library of Congress API integration
async function processLibraryOfCongressImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    console.log(`📚 Searching Library of Congress for: ${searchQuery}`);
    
    // Library of Congress API - free, no key required
    const apiUrl = 'https://www.loc.gov/search/';
    const params = new URLSearchParams({
      q: searchQuery,
      fo: 'json',
      c: 'photos',
      fa: 'online-format:image',
      sb: 'relevance',
      sp: '1'
    });

    const response = await fetch(`${apiUrl}?${params}`);
    
    if (!response.ok) {
      throw new Error(`Library of Congress API error: ${response.status}`);
    }
    
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      for (const item of data.results) {
        // Look for items with images
        if (item.image_url && item.image_url.length > 0) {
          const imageUrl = item.image_url[0];
          
          const metadata = {
            title: item.title || 'Library of Congress Item',
            description: item.description?.[0] || '',
            license: 'Public Domain',
            author: item.contributor?.[0] || 'Library of Congress',
            format: 'jpg',
            source_url: item.id,
            date: item.date
          };
          
          return {
            success: true,
            source: 'Library of Congress',
            imageUrl,
            metadata
          };
        }
      }
    }

    return {
      success: false,
      source: 'Library of Congress',
      error: 'No images found in collection'
    };

  } catch (error) {
    return {
      success: false,
      source: 'Library of Congress',
      error: error.message
    };
  }
}

// Biblioteca Nacional Digital (Brazil) integration
async function processBibliotecaNacionalDigital(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    console.log(`📚 Searching Biblioteca Nacional Digital for: ${searchQuery}`);
    
    // Biblioteca Nacional has digital collections but limited API
    // This would need specific implementation based on their system
    return {
      success: false,
      source: 'Biblioteca Nacional Digital',
      error: 'API integration requires specific BN Digital access - not publicly available'
    };
    
  } catch (error) {
    return {
      success: false,
      source: 'Biblioteca Nacional Digital',
      error: error.message
    };
  }
}

// City Portal APIs
async function processCityPortalImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return { 
    success: false, 
    source: 'city_portal', 
    error: 'Not implemented yet' 
  };
}

// =====================================
// SPECIFIC SOURCE IMPLEMENTATIONS
// =====================================

// Brazilian Government Sources
async function processIPHANImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    console.log(`🏛️  Searching IPHAN website for: ${searchQuery}`);
    
    // Use our IPHAN crawler Edge Function
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-iphan-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: 'temp-iphan-search',
        attractionName: searchQuery.split(' ')[0], // Use first word as attraction name
        searchQuery: searchQuery
      })
    });

    if (!response.ok) {
      throw new Error(`IPHAN crawler error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success && data.imageUrl) {
      return {
        success: true,
        source: 'IPHAN - Instituto do Patrimônio Histórico e Artístico Nacional',
        imageUrl: data.imageUrl,
        metadata: {
          title: data.results?.[0]?.title || 'Patrimônio Histórico Brasileiro',
          description: data.results?.[0]?.description || 'Imagem oficial do IPHAN',
          license: 'Domínio Público - Governo Federal',
          author: 'IPHAN - Instituto do Patrimônio Histórico e Artístico Nacional',
          format: 'jpg'
        }
      };
    }

    return {
      success: false,
      source: 'IPHAN',
      error: data.message || 'No heritage images found on IPHAN website'
    };
    
  } catch (error) {
    return {
      success: false,
      source: 'IPHAN',
      error: error.message
    };
  }
}

async function processCulturaGovImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: 'Ministério da Cultura',
    error: 'API integration not implemented'
  };
}

async function processBibliotecaNacionalImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    // Biblioteca Nacional has digital collections
    console.log(`📚 Searching Biblioteca Nacional for: ${searchQuery}`);
    
    return {
      success: false,
      source: 'Biblioteca Nacional',
      error: 'API integration not implemented - requires BN Digital API access'
    };
    
  } catch (error) {
    return {
      success: false,
      source: 'Biblioteca Nacional',
      error: error.message
    };
  }
}

async function processIBGEImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: 'IBGE',
    error: 'API integration not implemented'
  };
}

// Spanish Government Sources
async function processSpanishCultureMinistry(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: 'Ministerio de Cultura y Deporte',
    error: 'API integration not implemented'
  };
}

async function processSpanishHeritage(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: 'Instituto del Patrimonio Cultural de España',
    error: 'API integration not implemented'
  };
}

// Heritage/Museum Sources
async function processMuseuNacionalImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: 'Museu Nacional',
    error: 'API integration not implemented'
  };
}

async function processMASPImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    // MASP has a digital collection API
    console.log(`🎨 Searching MASP collection for: ${searchQuery}`);
    
    return {
      success: false,
      source: 'MASP',
      error: 'API integration not implemented - requires MASP collection API'
    };
    
  } catch (error) {
    return {
      success: false,
      source: 'MASP',
      error: error.message
    };
  }
}

async function processMoreiraSallesImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: 'Instituto Moreira Salles',
    error: 'API integration not implemented'
  };
}

async function processMuseoPradoImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    // Museo del Prado has an API for their collection
    console.log(`🎨 Searching Museo del Prado for: ${searchQuery}`);
    
    // Prado has a public API: https://www.museodelprado.es/aprende/centro-de-estudios/centro-de-estudios-digital/api
    return {
      success: false,
      source: 'Museo del Prado',
      error: 'API integration not implemented - requires Prado API implementation'
    };
    
  } catch (error) {
    return {
      success: false,
      source: 'Museo del Prado',
      error: error.message
    };
  }
}

async function processReinaSofiaImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: 'Museo Reina Sofía',
    error: 'API integration not implemented'
  };
}

// Academic Sources
async function processSciELOImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: 'SciELO',
    error: 'Academic sources typically do not provide tourist images'
  };
}

async function processCAPESImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: 'CAPES',
    error: 'Academic sources typically do not provide tourist images'
  };
}

async function processCSICImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: 'CSIC',
    error: 'Academic sources typically do not provide tourist images'
  };
}

// Media Sources
async function processAgenciaBrasilImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    // Agência Brasil has news images that could be relevant
    console.log(`📰 Searching Agência Brasil for: ${searchQuery}`);
    
    return {
      success: false,
      source: 'Agência Brasil',
      error: 'API integration not implemented - requires news API access'
    };
    
  } catch (error) {
    return {
      success: false,
      source: 'Agência Brasil',
      error: error.message
    };
  }
}

async function processBBCBrasilImages(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: 'BBC Brasil',
    error: 'API integration not implemented'
  };
}

// Wikipedia specialized
async function processWikipediaSpecialized(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  const { source, searchQuery } = config;
  
  try {
    // Use existing Wikipedia integration but with specialized search
    console.log(`📚 Searching Wikipedia PT for: ${searchQuery}`);
    
    // This could leverage our existing Wikipedia image extraction
    // but with Portuguese-specific searches
    return {
      success: false,
      source: 'Wikipedia PT',
      error: 'Use existing Wikipedia integration from Phase 1'
    };
    
  } catch (error) {
    return {
      success: false,
      source: 'Wikipedia PT',
      error: error.message
    };
  }
}

// Generic fallback processors
async function processGenericGovernmentSource(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: config.source.source_name,
    error: 'Generic government source processor not implemented'
  };
}

async function processGenericHeritageSource(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: config.source.source_name,
    error: 'Generic heritage source processor not implemented'
  };
}

async function processGenericAcademicSource(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: config.source.source_name,
    error: 'Academic sources typically do not provide tourist images'
  };
}

async function processGenericMediaSource(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: config.source.source_name,
    error: 'Generic media source processor not implemented'
  };
}

async function processGenericEncyclopediaSource(config: ImageSearchConfig): Promise<SpecializedImageResult> {
  return {
    success: false,
    source: config.source.source_name,
    error: 'Generic encyclopedia source processor not implemented'
  };
}

// Main function to search specialized sources for a POI
async function searchSpecializedSources(
  poiName: string,
  city: string,
  country: string,
  category?: string
): Promise<SpecializedImageResult[]> {
  const countryCode = await getCountryCodeForPOI(city, country);
  const sources = await getCountryVerificationSources(countryCode);
  
  if (sources.length === 0) {
    console.log(`❌ No specialized sources found for ${countryCode}`);
    return [];
  }

  console.log(`🔍 Found ${sources.length} specialized sources for ${countryCode}`);
  
  const results: SpecializedImageResult[] = [];
  const searchQuery = `${poiName} ${city}`;

  for (const source of sources) {
    console.log(`🔄 Trying ${source.source_name} (${source.source_type})`);
    
    const processor = SOURCE_PROCESSORS[source.source_type];
    if (!processor) {
      console.log(`⚠️  No processor available for ${source.source_type}`);
      continue;
    }

    const config: ImageSearchConfig = {
      source,
      searchQuery,
      filters: {
        imageType: 'photo',
        license: 'free',
        minWidth: 400,
        minHeight: 300,
        format: ['jpg', 'jpeg', 'png', 'webp']
      }
    };

    try {
      const result = await processor(config);
      results.push(result);
      
      if (result.success) {
        console.log(`✅ Success with ${source.source_name}`);
        break; // Use first successful result
      } else {
        console.log(`❌ Failed with ${source.source_name}: ${result.error}`);
      }
    } catch (error) {
      console.log(`💥 Error with ${source.source_name}: ${error.message}`);
      results.push({
        success: false,
        source: source.source_name,
        error: error.message
      });
    }
  }

  return results;
}

// Test function
async function testSpecializedSources() {
  console.log('🧪 Testing Specialized Sources Integration');
  console.log('==========================================\n');

  // Test with different countries
  const testCases = [
    { name: 'Cristo Redentor', city: 'Rio de Janeiro', country: 'Brazil' },
    { name: 'Sagrada Família', city: 'Barcelona', country: 'España' },
    { name: 'Louvre Museum', city: 'Paris', country: 'France' }
  ];

  for (const testCase of testCases) {
    console.log(`\n🔍 Testing: ${testCase.name} (${testCase.city}, ${testCase.country})`);
    
    const results = await searchSpecializedSources(
      testCase.name,
      testCase.city,
      testCase.country
    );

    console.log(`📊 Results: ${results.length} sources tried`);
    results.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.source}: ${result.success ? '✅ Success' : `❌ ${result.error}`}`);
      if (result.success && result.imageUrl) {
        console.log(`      Image: ${result.imageUrl}`);
        console.log(`      License: ${result.metadata?.license}`);
      }
    });
  }
}

// Check current country sources in database
async function analyzeCurrentSources() {
  console.log('📊 Analyzing Current Country Verification Sources');
  console.log('================================================\n');

  const { data: sources, error } = await supabase
    .schema('core')
    .from('country_verification_sources')
    .select(`
      *,
      countries!inner(code, name)
    `)
    .eq('is_active', true)
    .order('countries(code)', { ascending: true });

  if (error) {
    console.error('Error loading sources:', error);
    return;
  }

  if (!sources || sources.length === 0) {
    console.log('❌ No country verification sources found');
    return;
  }

  // Group by country
  const sourcesByCountry = sources.reduce((acc, source) => {
    const country = source.countries.code;
    if (!acc[country]) acc[country] = [];
    acc[country].push(source);
    return acc;
  }, {});

  console.log(`📋 Found sources for ${Object.keys(sourcesByCountry).length} countries:\n`);

  Object.entries(sourcesByCountry).forEach(([countryCode, countrySources]: [string, any[]]) => {
    const countryName = countrySources[0].countries.name;
    console.log(`🏳️  ${countryName} (${countryCode}): ${countrySources.length} sources`);
    
    countrySources.forEach((source, index) => {
      console.log(`   ${index + 1}. ${source.source_name} (${source.source_type}) - Priority: ${source.priority}`);
      console.log(`      URL: ${source.base_url}`);
      console.log(`      API Key Required: ${source.api_key_required ? 'Yes' : 'No'}`);
      if (source.config && Object.keys(source.config).length > 0) {
        console.log(`      Config: ${JSON.stringify(source.config, null, 2)}`);
      }
    });
    console.log('');
  });
}

async function main() {
  console.log('🎯 Phase 2: Specialized Image Sources');
  console.log('=====================================\n');

  try {
    // First, analyze what sources we have
    await analyzeCurrentSources();
    
    // Then test the integration
    await testSpecializedSources();

    console.log('\n✅ Phase 2 analysis completed!');
    console.log('\n📋 Next Steps:');
    console.log('1. 🔧 Configure specialized APIs in country_verification_sources');
    console.log('2. 🚀 Implement specific processors for each source type');
    console.log('3. 🔄 Integrate with unified image processing script');
    console.log('4. 🧪 Test with real POIs and API keys');

  } catch (error) {
    console.error('💥 Error:', error);
    process.exit(1);
  }
}

// Export functions for integration
export {
  searchSpecializedSources,
  getCountryVerificationSources,
  SOURCE_PROCESSORS
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
