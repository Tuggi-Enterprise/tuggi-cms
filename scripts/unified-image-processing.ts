/**
 * Unified script to process all POIs with all available image sources
 * This script processes POIs in order of priority and tries all available sources
 * Includes quality filters to avoid social media and low-quality images
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { searchSpecializedSources } from './phase2-specialized-sources';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface POI {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  image_url: string | null;
  image_source: string | null;
  website?: string;
  osm_tags?: any;
  reference_links?: any;
  rag_sources_found?: any;
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
    format?: string;
  };
  error?: string;
}

interface ProcessingResult {
  success: boolean;
  attractionId: string;
  attractionName: string;
  oldImageSource?: string;
  newImageSource?: string;
  newImageUrl?: string;
  error?: string;
  imagesFound?: number;
  processingTime?: number;
}

interface SourceConfig {
  name: string;
  priority: number;
  condition: (poi: POI) => boolean;
  processor: (poi: POI) => Promise<ProcessingResult>;
  description: string;
}

interface ImageQualityFilter {
  minWidth: number;
  minHeight: number;
  maxFileSize: number; // in bytes
  allowedFormats: string[];
  socialMediaDomains: string[];
  lowQualityKeywords: string[];
}

// Quality filters to ensure only high-quality images are processed
const IMAGE_QUALITY_FILTER: ImageQualityFilter = {
  minWidth: 400,
  minHeight: 300,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
  socialMediaDomains: [
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
    'youtube.com', 'linkedin.com', 'pinterest.com', 'snapchat.com',
    'whatsapp.com', 'telegram.org', 'discord.com', 'reddit.com',
    'flickr.com', 'imgur.com', 'deviantart.com'
  ],
  lowQualityKeywords: [
    'avatar', 'profile', 'icon', 'logo', 'banner', 'thumbnail',
    'placeholder', 'default', 'no-image', 'coming-soon', 'under-construction',
    'social', 'share', 'like', 'follow', 'subscribe', 'advertisement',
    'sponsored', 'promo', 'sale', 'discount', 'button', 'badge'
  ]
};

// Function to check if an image URL is from social media
export function isSocialMediaImage(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    
    return IMAGE_QUALITY_FILTER.socialMediaDomains.some(socialDomain => 
      domain.includes(socialDomain) || domain.endsWith(`.${socialDomain}`)
    );
  } catch {
    return false;
  }
}

// Function to check if an image filename suggests low quality
function isLowQualityImage(filename: string, altText?: string): boolean {
  const text = `${filename} ${altText || ''}`.toLowerCase();
  
  return IMAGE_QUALITY_FILTER.lowQualityKeywords.some(keyword => 
    text.includes(keyword)
  );
}

// Function to validate image quality based on metadata
function validateImageQuality(width?: number, height?: number, fileSize?: number, format?: string): boolean {
  // Check dimensions
  if (width && height) {
    if (width < IMAGE_QUALITY_FILTER.minWidth || height < IMAGE_QUALITY_FILTER.minHeight) {
      return false;
    }
  }
  
  // Check file size
  if (fileSize && fileSize > IMAGE_QUALITY_FILTER.maxFileSize) {
    return false;
  }
  
  // Check format
  if (format && !IMAGE_QUALITY_FILTER.allowedFormats.includes(format.toLowerCase())) {
    return false;
  }
  
  return true;
}

// Advanced metadata analysis interface
interface ImageMetadata {
  photographer?: string;
  license?: string;
  captureDate?: Date;
  location?: { lat: number; lng: number };
  keywords?: string[];
  description?: string;
  copyrightStatus?: 'free' | 'restricted' | 'unknown';
  source?: string;
  lastModified?: Date;
}

// Source priority and trust scoring
const SOURCE_PRIORITY_MATRIX = {
  'government_sites': { base: 95, trust: 0.98, domains: ['gov.br', 'gov.mx', 'gob.es', 'barcelona.cat', 'rio.rj.gov.br'] },
  'tourism_boards': { base: 88, trust: 0.92, domains: ['visitbrasil.com', 'turismo.gov.br', 'embratur.gov.br'] },
  'official_website': { base: 85, trust: 0.90, domains: [] }, // Determined by context
  'wikipedia': { base: 80, trust: 0.88, domains: ['wikipedia.org', 'wikimedia.org'] },
  'wikidata': { base: 75, trust: 0.85, domains: ['wikidata.org'] },
  'wikimedia_commons': { base: 70, trust: 0.82, domains: ['commons.wikimedia.org'] },
  'museums': { base: 85, trust: 0.90, domains: ['museo', 'museum', 'museu'] },
  'universities': { base: 75, trust: 0.85, domains: ['edu', 'universidade', 'universidad'] },
  'osm': { base: 60, trust: 0.70, domains: [] }
};

// Function to determine source type from URL
export function getSourceType(url: string): keyof typeof SOURCE_PRIORITY_MATRIX {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    
    // Check each source type
    for (const [sourceType, config] of Object.entries(SOURCE_PRIORITY_MATRIX)) {
      if (config.domains.some(sourceDomain => 
        domain.includes(sourceDomain) || domain.endsWith(`.${sourceDomain}`)
      )) {
        return sourceType as keyof typeof SOURCE_PRIORITY_MATRIX;
      }
    }
    
    // Default to official_website for unknown domains
    return 'official_website';
  } catch {
    return 'osm'; // Lowest priority for invalid URLs
  }
}

// Function to analyze image metadata
function analyzeImageMetadata(
  url: string,
  filename?: string,
  altText?: string,
  metadata?: any
): ImageMetadata {
  const analysis: ImageMetadata = {
    source: url,
    lastModified: new Date()
  };
  
  // Extract metadata if available
  if (metadata) {
    analysis.photographer = metadata.author || metadata.photographer;
    analysis.license = metadata.license;
    analysis.captureDate = metadata.date ? new Date(metadata.date) : undefined;
    analysis.description = metadata.description || altText;
    analysis.keywords = metadata.keywords || [];
    
    // Determine copyright status
    if (metadata.license) {
      if (metadata.license.toLowerCase().includes('cc') || 
          metadata.license.toLowerCase().includes('creative commons') ||
          metadata.license.toLowerCase().includes('public domain')) {
        analysis.copyrightStatus = 'free';
      } else if (metadata.license.toLowerCase().includes('copyright') ||
                 metadata.license.toLowerCase().includes('all rights reserved')) {
        analysis.copyrightStatus = 'restricted';
      }
    }
    
    // Extract GPS coordinates if available
    if (metadata.gps) {
      analysis.location = {
        lat: metadata.gps.latitude,
        lng: metadata.gps.longitude
      };
    }
  }
  
  return analysis;
}

// Enhanced function to score image quality (0-100)
export function scoreImageQuality(
  url: string, 
  filename?: string, 
  altText?: string, 
  width?: number, 
  height?: number, 
  fileSize?: number, 
  format?: string,
  metadata?: ImageMetadata
): number {
  let score = 100;
  
  // 1. Source credibility scoring
  const sourceType = getSourceType(url);
  const sourceConfig = SOURCE_PRIORITY_MATRIX[sourceType];
  const sourceScore = sourceConfig.base * sourceConfig.trust;
  score = (score * 0.3) + (sourceScore * 0.7); // Weight source heavily
  
  // 2. Penalize social media images heavily
  if (isSocialMediaImage(url)) {
    score -= 80;
  }
  
  // 3. Penalize low quality keywords
  if (isLowQualityImage(filename || '', altText)) {
    score -= 60;
  }
  
  // 4. Dimension scoring
  if (width && height) {
    if (width >= 1920 && height >= 1080) score += 15; // 4K bonus
    else if (width >= 1200 && height >= 800) score += 10; // High res bonus
    else if (width >= 800 && height >= 600) score += 5; // Good res bonus
    else if (width < 400 || height < 300) score -= 40; // Too small penalty
    else if (width < 800 || height < 600) score -= 20; // Small penalty
  }
  
  // 5. File size optimization
  if (fileSize) {
    if (fileSize > 10 * 1024 * 1024) score -= 30; // Too large
    else if (fileSize > 5 * 1024 * 1024) score -= 15; // Large
    else if (fileSize < 50 * 1024) score -= 25; // Too small (likely low quality)
  }
  
  // 6. Format preference
  if (format) {
    const fmt = format.toLowerCase();
    if (fmt === 'webp') score += 5; // Modern format bonus
    else if (fmt === 'jpg' || fmt === 'jpeg') score += 3; // Standard format
    else if (fmt === 'png') score += 2; // Good format
    else if (fmt === 'gif') score -= 20; // Usually not good for photos
  }
  
  // 7. Metadata quality bonus
  if (metadata) {
    if (metadata.license && metadata.copyrightStatus === 'free') score += 10;
    if (metadata.photographer) score += 5;
    if (metadata.description && metadata.description.length > 20) score += 5;
    if (metadata.captureDate) score += 3;
    if (metadata.location) score += 8; // GPS data is valuable
  }
  
  // 8. Content relevance (basic keyword matching)
  const combinedText = `${filename || ''} ${altText || ''} ${metadata?.description || ''}`.toLowerCase();
  const relevantKeywords = ['exterior', 'facade', 'building', 'architecture', 'landmark', 'monument'];
  const irrelevantKeywords = ['interior', 'inside', 'menu', 'food', 'person', 'people'];
  
  const relevantMatches = relevantKeywords.filter(keyword => combinedText.includes(keyword)).length;
  const irrelevantMatches = irrelevantKeywords.filter(keyword => combinedText.includes(keyword)).length;
  
  score += (relevantMatches * 5);
  score -= (irrelevantMatches * 10);
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function loadAllPOIs(): Promise<POI[]> {
  console.log('📂 Loading all POIs...');
  
  try {
    const { data, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country, image_url, image_source, website, osm_tags, reference_links, rag_sources_found');

    if (error) {
      throw new Error(`Error loading POIs: ${error.message}`);
    }

    const pois = data || [];
    console.log(`✅ Loaded ${pois.length} POIs`);
    
    // Categorize POIs
    const withImages = pois.filter(poi => poi.image_url);
    const withoutImages = pois.filter(poi => !poi.image_url);
    const withWebsites = pois.filter(poi => poi.website);
    const withWikidata = pois.filter(poi => poi.osm_tags?.wikidata);
    const withWikipedia = pois.filter(poi => poi.osm_tags?.wikipedia);
    const withWikimediaCommons = pois.filter(poi => poi.osm_tags?.wikimedia_commons);
    const withOSMImages = pois.filter(poi => poi.osm_tags?.image);
    
    console.log(`\n📊 POI Analysis:`);
    console.log(`   With images: ${withImages.length}`);
    console.log(`   Without images: ${withoutImages.length}`);
    console.log(`   With websites: ${withWebsites.length}`);
    console.log(`   With Wikidata: ${withWikidata.length}`);
    console.log(`   With Wikipedia: ${withWikipedia.length}`);
    console.log(`   With Wikimedia Commons: ${withWikimediaCommons.length}`);
    console.log(`   With OSM images: ${withOSMImages.length}`);
    
    return pois;

  } catch (error) {
    console.error('💥 Error loading POIs:', error);
    throw error;
  }
}

// Function to process specialized sources (Phase 2A)
async function processSpecializedImage(poi: POI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    console.log(`   🏛️  Trying specialized sources for ${poi.country}...`);
    
    const specializedResults = await searchSpecializedSources(
      poi.name,
      poi.city,
      poi.country
    );

    if (specializedResults.length === 0) {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source,
        error: 'No specialized sources found for this country',
        processingTime: Date.now() - startTime
      };
    }

    // Find the first successful result
    const successfulResult = specializedResults.find(result => result.success);
    
    if (successfulResult) {
      // Call the specialized images Edge Function
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-specialized-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          attractionId: poi.id,
          attractionName: poi.name,
          specializedSource: successfulResult.source,
          imageUrl: successfulResult.imageUrl,
          metadata: successfulResult.metadata
        })
      });

      const data = await response.json();
      
      if (data.success) {
        return {
          success: true,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          newImageSource: `specialized_${successfulResult.source}`,
          newImageUrl: data.imageUrl,
          processingTime: Date.now() - startTime
        };
      } else {
        return {
          success: false,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          error: `Specialized source failed: ${data.error}`,
          processingTime: Date.now() - startTime
        };
      }
    }

    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: 'All specialized sources failed',
      processingTime: Date.now() - startTime
    };

  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: `Specialized sources error: ${error.message}`,
      processingTime: Date.now() - startTime
    };
  }
}

// Define all available sources with their configurations using smart priority
function getSourceConfigs(): SourceConfig[] {
  return [
    {
      name: 'specialized_sources',
      priority: 0,
      description: 'Country-specific specialized sources (museums, government, heritage)',
      condition: (poi: POI) => !!poi.country && ['BR', 'US', 'ES', 'MX', 'CL'].includes(poi.country),
      processor: processSpecializedImage
    },
    {
      name: 'government_website',
      priority: 1,
      description: 'Government and tourism board websites',
      condition: (poi: POI) => !!poi.website && getSourceType(poi.website) === 'government_sites',
      processor: processWebsiteImage
    },
    {
      name: 'tourism_website',
      priority: 2,
      description: 'Official tourism websites',
      condition: (poi: POI) => !!poi.website && getSourceType(poi.website) === 'tourism_boards',
      processor: processWebsiteImage
    },
    {
      name: 'museum_website',
      priority: 3,
      description: 'Museum and cultural institution websites',
      condition: (poi: POI) => !!poi.website && getSourceType(poi.website) === 'museums',
      processor: processWebsiteImage
    },
    {
      name: 'university_website',
      priority: 4,
      description: 'University and educational websites',
      condition: (poi: POI) => !!poi.website && getSourceType(poi.website) === 'universities',
      processor: processWebsiteImage
    },
    {
      name: 'official_website',
      priority: 5,
      description: 'Other official websites',
      condition: (poi: POI) => !!poi.website && !isSocialMediaImage(poi.website),
      processor: processWebsiteImage
    },
    {
      name: 'wikipedia',
      priority: 6,
      description: 'Wikipedia pages',
      condition: (poi: POI) => !!poi.osm_tags?.wikipedia,
      processor: processWikipediaImage
    },
    {
      name: 'wikidata',
      priority: 7,
      description: 'Wikidata entities',
      condition: (poi: POI) => !!poi.osm_tags?.wikidata,
      processor: processWikidataImage
    },
    {
      name: 'wikimedia_commons',
      priority: 8,
      description: 'Wikimedia Commons',
      condition: (poi: POI) => !!poi.osm_tags?.wikimedia_commons,
      processor: processWikimediaImage
    },
    {
      name: 'osm',
      priority: 9,
      description: 'OSM image tags',
      condition: (poi: POI) => !!poi.osm_tags?.image && !isSocialMediaImage(poi.osm_tags.image),
      processor: processOSMImage
    }
  ];
}

async function processWebsiteImage(poi: POI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    // First, check if the website URL itself is from social media
    if (isSocialMediaImage(poi.website!)) {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source,
        error: 'Website is from social media platform',
        processingTime: Date.now() - startTime
      };
    }

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-website-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        websiteUrl: poi.website,
        qualityFilter: {
          minWidth: IMAGE_QUALITY_FILTER.minWidth,
          minHeight: IMAGE_QUALITY_FILTER.minHeight,
          maxFileSize: IMAGE_QUALITY_FILTER.maxFileSize,
          allowedFormats: IMAGE_QUALITY_FILTER.allowedFormats,
          socialMediaDomains: IMAGE_QUALITY_FILTER.socialMediaDomains,
          lowQualityKeywords: IMAGE_QUALITY_FILTER.lowQualityKeywords
        }
      })
    });

    const data = await response.json();
    const processingTime = Date.now() - startTime;
    
    // Enhanced quality check with metadata analysis
    if (data.success && data.imageUrl) {
      const metadata = analyzeImageMetadata(
        data.imageUrl,
        data.filename,
        data.altText,
        data.metadata
      );
      
      const qualityScore = scoreImageQuality(
        data.imageUrl,
        data.filename,
        data.altText,
        data.width,
        data.height,
        data.fileSize,
        data.format,
        metadata
      );
      
      console.log(`   📊 Image quality score: ${qualityScore}/100 (Source: ${getSourceType(data.imageUrl)})`);
      
      if (qualityScore < 60) { // Raised threshold with better scoring
        return {
          success: false,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          error: `Image quality too low (score: ${qualityScore}/100)`,
          processingTime
        };
      }
    }
    
    return {
      success: data.success,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      newImageSource: 'website',
      newImageUrl: data.imageUrl,
      error: data.message,
      imagesFound: data.availableImages,
      processingTime
    };
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: error.message,
      processingTime: Date.now() - startTime
    };
  }
}

async function processWikidataImage(poi: POI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-wikidata-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        wikidataId: poi.osm_tags?.wikidata,
        qualityFilter: {
          minWidth: IMAGE_QUALITY_FILTER.minWidth,
          minHeight: IMAGE_QUALITY_FILTER.minHeight,
          maxFileSize: IMAGE_QUALITY_FILTER.maxFileSize,
          allowedFormats: IMAGE_QUALITY_FILTER.allowedFormats,
          socialMediaDomains: IMAGE_QUALITY_FILTER.socialMediaDomains,
          lowQualityKeywords: IMAGE_QUALITY_FILTER.lowQualityKeywords
        }
      })
    });

    const data = await response.json();
    const processingTime = Date.now() - startTime;
    
    // Quality check on the result
    if (data.success && data.images?.[0]?.url) {
      const image = data.images[0];
      const qualityScore = scoreImageQuality(
        image.url,
        image.filename,
        image.altText,
        image.width,
        image.height,
        image.fileSize,
        image.format
      );
      
      if (qualityScore < 60) { // Raised threshold with better scoring
        return {
          success: false,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          error: `Image quality too low (score: ${qualityScore})`,
          processingTime
        };
      }
    }
    
    return {
      success: data.success,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      newImageSource: 'wikidata',
      newImageUrl: data.images?.[0]?.url,
      error: data.message,
      imagesFound: data.availableImages,
      processingTime
    };
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: error.message,
      processingTime: Date.now() - startTime
    };
  }
}

async function processWikipediaImage(poi: POI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-wikipedia-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        wikipediaUrl: poi.osm_tags?.wikipedia,
        qualityFilter: {
          minWidth: IMAGE_QUALITY_FILTER.minWidth,
          minHeight: IMAGE_QUALITY_FILTER.minHeight,
          maxFileSize: IMAGE_QUALITY_FILTER.maxFileSize,
          allowedFormats: IMAGE_QUALITY_FILTER.allowedFormats,
          socialMediaDomains: IMAGE_QUALITY_FILTER.socialMediaDomains,
          lowQualityKeywords: IMAGE_QUALITY_FILTER.lowQualityKeywords
        }
      })
    });

    const data = await response.json();
    const processingTime = Date.now() - startTime;
    
    // Quality check on the result
    if (data.success && data.images?.[0]?.url) {
      const image = data.images[0];
      const qualityScore = scoreImageQuality(
        image.url,
        image.filename,
        image.altText,
        image.width,
        image.height,
        image.fileSize,
        image.format
      );
      
      if (qualityScore < 60) { // Raised threshold with better scoring
        return {
          success: false,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          error: `Image quality too low (score: ${qualityScore})`,
          processingTime
        };
      }
    }
    
    return {
      success: data.success,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      newImageSource: 'wikipedia',
      newImageUrl: data.images?.[0]?.url,
      error: data.message,
      imagesFound: data.availableImages,
      processingTime
    };
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: error.message,
      processingTime: Date.now() - startTime
    };
  }
}

async function processWikimediaImage(poi: POI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        imageSource: 'wikimedia_commons',
        wikimediaUrl: poi.osm_tags?.wikimedia_commons,
        qualityFilter: {
          minWidth: IMAGE_QUALITY_FILTER.minWidth,
          minHeight: IMAGE_QUALITY_FILTER.minHeight,
          maxFileSize: IMAGE_QUALITY_FILTER.maxFileSize,
          allowedFormats: IMAGE_QUALITY_FILTER.allowedFormats,
          socialMediaDomains: IMAGE_QUALITY_FILTER.socialMediaDomains,
          lowQualityKeywords: IMAGE_QUALITY_FILTER.lowQualityKeywords
        }
      })
    });

    const data = await response.json();
    const processingTime = Date.now() - startTime;
    
    // Quality check on the result
    if (data.success && data.imageUrl) {
      const qualityScore = scoreImageQuality(
        data.imageUrl,
        data.filename,
        data.altText,
        data.width,
        data.height,
        data.fileSize,
        data.format
      );
      
      if (qualityScore < 60) { // Raised threshold with better scoring
        return {
          success: false,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          error: `Image quality too low (score: ${qualityScore})`,
          processingTime
        };
      }
    }
    
    return {
      success: data.success,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      newImageSource: 'wikimedia_commons',
      newImageUrl: data.imageUrl,
      error: data.message,
      processingTime
    };
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: error.message,
      processingTime: Date.now() - startTime
    };
  }
}

async function processOSMImage(poi: POI): Promise<ProcessingResult> {
  const startTime = Date.now();
  
  try {
    // First, check if the OSM image URL is from social media
    if (isSocialMediaImage(poi.osm_tags?.image)) {
      return {
        success: false,
        attractionId: poi.id,
        attractionName: poi.name,
        oldImageSource: poi.image_source,
        error: 'OSM image URL is from social media platform',
        processingTime: Date.now() - startTime
      };
    }

    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/extract-osm-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        attractionId: poi.id,
        attractionName: poi.name,
        imageUrl: poi.osm_tags?.image,
        qualityFilter: {
          minWidth: IMAGE_QUALITY_FILTER.minWidth,
          minHeight: IMAGE_QUALITY_FILTER.minHeight,
          maxFileSize: IMAGE_QUALITY_FILTER.maxFileSize,
          allowedFormats: IMAGE_QUALITY_FILTER.allowedFormats,
          socialMediaDomains: IMAGE_QUALITY_FILTER.socialMediaDomains,
          lowQualityKeywords: IMAGE_QUALITY_FILTER.lowQualityKeywords
        }
      })
    });

    const data = await response.json();
    const processingTime = Date.now() - startTime;
    
    // Quality check on the result
    if (data.success && data.imageUrl) {
      const qualityScore = scoreImageQuality(
        data.imageUrl,
        data.filename,
        data.altText,
        data.width,
        data.height,
        data.fileSize,
        data.format
      );
      
      if (qualityScore < 60) { // Raised threshold with better scoring
        return {
          success: false,
          attractionId: poi.id,
          attractionName: poi.name,
          oldImageSource: poi.image_source,
          error: `Image quality too low (score: ${qualityScore})`,
          processingTime
        };
      }
    }
    
    return {
      success: data.success,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      newImageSource: 'osm',
      newImageUrl: data.imageUrl,
      error: data.message,
      processingTime
    };
  } catch (error) {
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: error.message,
      processingTime: Date.now() - startTime
    };
  }
}

async function processPOIWithAllSources(poi: POI, sourceConfigs: SourceConfig[]): Promise<ProcessingResult> {
  console.log(`🔄 Processing: ${poi.name} (${poi.city}, ${poi.state})`);
  console.log(`   Current image: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);

  // Get available sources for this POI, sorted by priority
  const availableSources = sourceConfigs
    .filter(config => config.condition(poi))
    .sort((a, b) => a.priority - b.priority);

  if (availableSources.length === 0) {
    console.log(`   ❌ No available sources`);
    return {
      success: false,
      attractionId: poi.id,
      attractionName: poi.name,
      oldImageSource: poi.image_source,
      error: 'No available sources'
    };
  }

  console.log(`   📋 Available sources: ${availableSources.map(s => s.name).join(', ')}`);

  // Try each source in order of priority
  for (const sourceConfig of availableSources) {
    console.log(`   🔍 Trying ${sourceConfig.name}...`);
    
    try {
      const result = await sourceConfig.processor(poi);
      
      if (result.success) {
        console.log(`   ✅ Success with ${sourceConfig.name}`);
        console.log(`   📸 New image: ${result.newImageUrl}`);
        console.log(`   ⏱️  Processing time: ${result.processingTime}ms`);
        if (result.imagesFound) {
          console.log(`   🖼️  Images available: ${result.imagesFound}`);
        }
        return result;
      } else {
        console.log(`   ❌ Failed with ${sourceConfig.name}: ${result.error}`);
      }
    } catch (error) {
      console.log(`   💥 Error with ${sourceConfig.name}: ${error.message}`);
    }
  }

  console.log(`   ❌ All sources failed`);
  return {
    success: false,
    attractionId: poi.id,
    attractionName: poi.name,
    oldImageSource: poi.image_source,
    error: 'All available sources failed'
  };
}

async function processBatch(
  pois: POI[], 
  sourceConfigs: SourceConfig[],
  batchSize: number = 3, 
  delayMs: number = 2000
): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];
  const totalBatches = Math.ceil(pois.length / batchSize);

  console.log(`🎯 Starting unified processing for ${pois.length} POIs`);
  console.log(`⚙️  Batch size: ${batchSize}, Delay: ${delayMs}ms`);

  for (let i = 0; i < pois.length; i += batchSize) {
    const batch = pois.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} POIs)`);

    // Process batch in parallel
    const batchPromises = batch.map(poi => processPOIWithAllSources(poi, sourceConfigs));
    const batchResults = await Promise.all(batchPromises);
    
    results.push(...batchResults);

    // Show progress
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    const progress = ((i + batch.length) / pois.length * 100).toFixed(1);
    
    console.log(`📊 Progress: ${i + batch.length}/${pois.length} (${progress}%) - Success: ${successCount}, Failed: ${failedCount}`);

    // Wait before next batch (except for the last batch)
    if (i + batchSize < pois.length) {
      console.log(`⏳ Waiting ${delayMs/1000} seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

async function saveResults(results: ProcessingResult[]): Promise<void> {
  const outputDir = join(process.cwd(), 'scripts', 'output');
  
  // Save detailed results
  const resultsFile = join(outputDir, 'unified-processing-results.json');
  await writeFile(resultsFile, JSON.stringify(results, null, 2));
  console.log(`💾 Detailed results saved to: ${resultsFile}`);

  // Save summary CSV
  const csvFile = join(outputDir, 'unified-processing-summary.csv');
  const csvHeader = 'Attraction_ID,Attraction_Name,Success,Old_Source,New_Source,New_Image_URL,Images_Found,Processing_Time_MS,Error\n';
  const csvRows = results.map(result => 
    `"${result.attractionId}","${result.attractionName}","${result.success}","${result.oldImageSource || ''}","${result.newImageSource || ''}","${result.newImageUrl || ''}","${result.imagesFound || ''}","${result.processingTime || ''}","${result.error || ''}"`
  ).join('\n');
  
  await writeFile(csvFile, csvHeader + csvRows);
  console.log(`📊 Summary CSV saved to: ${csvFile}`);
}

async function main() {
  console.log('🎯 Unified Image Processing System');
  console.log('==================================\n');

  try {
    // Load all POIs
    const pois = await loadAllPOIs();
    
    if (pois.length === 0) {
      console.log('✅ No POIs found.');
      return;
    }

    // Get source configurations
    const sourceConfigs = getSourceConfigs();
    
    console.log(`\n🔧 Available Sources:`);
    sourceConfigs.forEach((config, index) => {
      console.log(`   ${index + 1}. ${config.name} (Priority: ${config.priority}) - ${config.description}`);
    });

    // Show sample POIs
    console.log(`\n🎯 Sample POIs to process:`);
    pois.slice(0, 5).forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      Current: ${poi.image_url ? 'Yes' : 'No'} (${poi.image_source || 'unknown'})`);
      if (poi.website) console.log(`      Website: ${poi.website}`);
      if (poi.osm_tags?.wikidata) console.log(`      Wikidata: ${poi.osm_tags.wikidata}`);
      if (poi.osm_tags?.wikipedia) console.log(`      Wikipedia: ${poi.osm_tags.wikipedia}`);
      if (poi.osm_tags?.wikimedia_commons) console.log(`      Wikimedia: ${poi.osm_tags.wikimedia_commons}`);
      if (poi.osm_tags?.image) console.log(`      OSM Image: ${poi.osm_tags.image}`);
      console.log('');
    });

    // Process all POIs
    const results = await processBatch(pois, sourceConfigs, 3, 2000);

    // Save results
    await saveResults(results);

    // Show final summary
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    const totalProcessingTime = results.reduce((sum, r) => sum + (r.processingTime || 0), 0);
    
    console.log('\n🎉 Unified processing completed!');
    console.log(`📊 Final Results:`);
    console.log(`   ✅ Successfully processed: ${successCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   📈 Success rate: ${((successCount / results.length) * 100).toFixed(1)}%`);
    console.log(`   ⏱️  Total processing time: ${(totalProcessingTime / 1000).toFixed(1)}s`);

    // Show source distribution
    const sourceDistribution: { [key: string]: number } = {};
    results.filter(r => r.success).forEach(result => {
      sourceDistribution[result.newImageSource!] = (sourceDistribution[result.newImageSource!] || 0) + 1;
    });

    console.log('\n📊 Success by Source:');
    Object.entries(sourceDistribution)
      .sort(([,a], [,b]) => b - a)
      .forEach(([source, count]) => {
        console.log(`   ${source}: ${count} POIs`);
      });

    // Show improvement summary
    const improvedCount = results.filter(r => r.success && r.oldImageSource !== r.newImageSource).length;
    const newImagesCount = results.filter(r => r.success && !r.oldImageSource).length;
    
    console.log('\n🚀 Improvements:');
    console.log(`   New images added: ${newImagesCount}`);
    console.log(`   Images improved: ${improvedCount}`);
    console.log(`   Total improvements: ${newImagesCount + improvedCount}`);

    if (successCount > 0) {
      console.log('\n🎯 Successfully processed POIs:');
      results.filter(r => r.success).slice(0, 10).forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.attractionName}`);
        console.log(`      Source: ${result.newImageSource}`);
        console.log(`      Old: ${result.oldImageSource || 'none'} → New: ${result.newImageSource}`);
        console.log(`      Images found: ${result.imagesFound || 'N/A'}`);
        console.log(`      Time: ${result.processingTime}ms`);
        console.log('');
      });
      
      if (successCount > 10) {
        console.log(`   ... and ${successCount - 10} more POIs`);
      }
    }

  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}
