/**
 * Enhanced monitoring script for unified image processing
 * Shows detailed quality metrics and source distribution
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface QualityMetrics {
  total: number;
  withImages: number;
  withoutImages: number;
  sourceDistribution: Record<string, number>;
  qualityDistribution: Record<string, number>;
  recentlyUpdated: number;
}

async function getImageQualityMetrics(): Promise<QualityMetrics> {
  console.log('📊 Analyzing image quality metrics...\n');

  // Get all attractions with image data
  const { data: attractions, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, state, image_url, image_source, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Error loading attractions: ${error.message}`);
  }

  const metrics: QualityMetrics = {
    total: attractions.length,
    withImages: attractions.filter(a => a.image_url).length,
    withoutImages: attractions.filter(a => !a.image_url).length,
    sourceDistribution: {},
    qualityDistribution: {},
    recentlyUpdated: 0
  };

  // Calculate source distribution
  attractions.forEach(attraction => {
    const source = attraction.image_source || 'unknown';
    metrics.sourceDistribution[source] = (metrics.sourceDistribution[source] || 0) + 1;
  });

  // Calculate recent updates (last 24 hours)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  metrics.recentlyUpdated = attractions.filter(a => 
    new Date(a.updated_at) > yesterday
  ).length;

  // Quality distribution based on source reliability
  const sourceQuality = {
    'government_sites': 'excellent',
    'tourism_boards': 'excellent', 
    'museums': 'very_good',
    'universities': 'very_good',
    'wikipedia': 'good',
    'wikidata': 'good',
    'wikimedia_commons': 'good',
    'website': 'fair',
    'osm': 'fair',
    'unknown': 'poor'
  };

  attractions.forEach(attraction => {
    if (attraction.image_url) {
      const source = attraction.image_source || 'unknown';
      const quality = sourceQuality[source as keyof typeof sourceQuality] || 'poor';
      metrics.qualityDistribution[quality] = (metrics.qualityDistribution[quality] || 0) + 1;
    }
  });

  return metrics;
}

async function showTopQualityImages(): Promise<void> {
  console.log('🏆 Top Quality Images by Source:\n');

  const sources = ['government_sites', 'tourism_boards', 'museums', 'universities', 'wikipedia', 'wikidata'];
  
  for (const source of sources) {
    const { data: topImages, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('name, city, state, image_url, updated_at')
      .eq('image_source', source)
      .not('image_url', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(3);

    if (error) continue;

    if (topImages && topImages.length > 0) {
      console.log(`📸 ${source.toUpperCase().replace('_', ' ')}:`);
      topImages.forEach((image, index) => {
        console.log(`   ${index + 1}. ${image.name} (${image.city}, ${image.state})`);
        console.log(`      Updated: ${new Date(image.updated_at).toLocaleString()}`);
      });
      console.log('');
    }
  }
}

async function showRecentProcessing(): Promise<void> {
  console.log('⚡ Recent Processing Activity:\n');

  const { data: recent, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('name, city, state, image_source, updated_at')
    .not('image_url', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error loading recent activity:', error.message);
    return;
  }

  if (recent && recent.length > 0) {
    recent.forEach((item, index) => {
      const timeAgo = Math.round((Date.now() - new Date(item.updated_at).getTime()) / (1000 * 60));
      console.log(`${index + 1}. ${item.name} (${item.city}, ${item.state})`);
      console.log(`   Source: ${item.image_source}`);
      console.log(`   Updated: ${timeAgo} minutes ago\n`);
    });
  }
}

async function showProcessingProgress(): Promise<void> {
  console.log('📈 Processing Progress by City:\n');

  const { data: cityStats, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('city, state, image_url, image_source')
    .order('city');

  if (error) {
    console.error('Error loading city stats:', error.message);
    return;
  }

  // Group by city
  const cityGroups: Record<string, any[]> = {};
  cityStats?.forEach(attraction => {
    const key = `${attraction.city}, ${attraction.state}`;
    if (!cityGroups[key]) cityGroups[key] = [];
    cityGroups[key].push(attraction);
  });

  // Show top cities by completion rate
  const cityCompletionRates = Object.entries(cityGroups)
    .map(([city, attractions]) => ({
      city,
      total: attractions.length,
      withImages: attractions.filter(a => a.image_url).length,
      completionRate: (attractions.filter(a => a.image_url).length / attractions.length) * 100
    }))
    .sort((a, b) => b.completionRate - a.completionRate)
    .slice(0, 10);

  cityCompletionRates.forEach((city, index) => {
    console.log(`${index + 1}. ${city.city}: ${city.withImages}/${city.total} (${city.completionRate.toFixed(1)}%)`);
  });
}

async function main() {
  console.log('🎯 Unified Image Processing Monitor');
  console.log('===================================\n');

  try {
    // Get overall metrics
    const metrics = await getImageQualityMetrics();

    console.log('📊 Overall Statistics:');
    console.log(`   Total POIs: ${metrics.total.toLocaleString()}`);
    console.log(`   With images: ${metrics.withImages.toLocaleString()} (${((metrics.withImages / metrics.total) * 100).toFixed(1)}%)`);
    console.log(`   Without images: ${metrics.withoutImages.toLocaleString()} (${((metrics.withoutImages / metrics.total) * 100).toFixed(1)}%)`);
    console.log(`   Recently updated: ${metrics.recentlyUpdated.toLocaleString()} (last 24h)\n`);

    console.log('🔍 Source Distribution:');
    const sortedSources = Object.entries(metrics.sourceDistribution)
      .sort(([,a], [,b]) => b - a);
    
    sortedSources.forEach(([source, count]) => {
      const percentage = ((count / metrics.total) * 100).toFixed(1);
      console.log(`   ${source.padEnd(20)}: ${count.toString().padStart(6)} (${percentage}%)`);
    });
    console.log('');

    console.log('⭐ Quality Distribution:');
    const qualityOrder = ['excellent', 'very_good', 'good', 'fair', 'poor'];
    qualityOrder.forEach(quality => {
      const count = metrics.qualityDistribution[quality] || 0;
      if (count > 0) {
        const percentage = ((count / metrics.withImages) * 100).toFixed(1);
        console.log(`   ${quality.padEnd(15)}: ${count.toString().padStart(6)} (${percentage}%)`);
      }
    });
    console.log('');

    // Show detailed breakdowns
    await showTopQualityImages();
    await showRecentProcessing();
    await showProcessingProgress();

    console.log('✅ Monitoring complete!');

  } catch (error) {
    console.error('💥 Error:', error);
    process.exit(1);
  }
}

// Run the monitor
if (require.main === module) {
  main().catch(console.error);
}
