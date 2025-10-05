/**
 * Script to analyze additional image sources for POIs
 */

import { config } from 'dotenv';
import { getSupabase } from '../lib/core/supabase-client';

// Load environment variables
config();

const supabase = getSupabase('service');

interface POIImageAnalysis {
  id: string;
  name: string;
  city: string;
  state: string;
  image_url: string | null;
  image_source: string | null;
  osm_wikipedia_url: string | null;
  osm_wikidata_id: string | null;
  website: string | null;
  reference_links: string | null;
  rag_wikipedia_links: string | null;
  rag_official_sources: string | null;
  has_wikipedia: boolean;
  has_wikidata: boolean;
  has_website: boolean;
  has_reference_links: boolean;
  has_rag_links: boolean;
  potential_sources: string[];
}

async function analyzeAdditionalImageSources(): Promise<POIImageAnalysis[]> {
  console.log('🔍 Analyzing additional image sources for POIs...\n');

  try {
    // Query POIs with various potential image sources
    const { data: pois, error } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id, name, city, state, 
        image_url, image_source,
        osm_wikipedia_url, osm_wikidata_id,
        website, reference_links,
        rag_wikipedia_links, rag_official_sources
      `)
      .not('id', 'is', null);

    if (error) {
      throw new Error(`Error querying POIs: ${error.message}`);
    }

    console.log(`✅ Found ${pois?.length || 0} POIs to analyze`);

    // Analyze each POI for potential image sources
    const analysis: POIImageAnalysis[] = pois?.map(poi => {
      const hasWikipedia = !!poi.osm_wikipedia_url;
      const hasWikidata = !!poi.osm_wikidata_id;
      const hasWebsite = !!poi.website;
      const hasReferenceLinks = !!poi.reference_links;
      const hasRagLinks = !!(poi.rag_wikipedia_links || poi.rag_official_sources);

      const potentialSources: string[] = [];
      
      if (hasWikipedia) potentialSources.push('wikipedia');
      if (hasWikidata) potentialSources.push('wikidata');
      if (hasWebsite) potentialSources.push('website');
      if (hasReferenceLinks) potentialSources.push('reference_links');
      if (hasRagLinks) potentialSources.push('rag_sources');

      return {
        ...poi,
        has_wikipedia: hasWikipedia,
        has_wikidata: hasWikidata,
        has_website: hasWebsite,
        has_reference_links: hasReferenceLinks,
        has_rag_links: hasRagLinks,
        potential_sources: potentialSources
      };
    }) || [];

    return analysis;

  } catch (error) {
    console.error('💥 Error analyzing image sources:', error);
    throw error;
  }
}

async function generateAnalysisReport(analysis: POIImageAnalysis[]): Promise<void> {
  console.log('\n📊 Analysis Report - Additional Image Sources:\n');

  // Current image source distribution
  const currentSources = new Map<string, number>();
  analysis.forEach(poi => {
    const source = poi.image_source || 'none';
    currentSources.set(source, (currentSources.get(source) || 0) + 1);
  });

  console.log('📈 Current Image Source Distribution:');
  Array.from(currentSources.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([source, count]) => {
      const percentage = ((count / analysis.length) * 100).toFixed(1);
      console.log(`   ${source}: ${count} POIs (${percentage}%)`);
    });

  // Potential sources analysis
  const potentialSources = new Map<string, number>();
  analysis.forEach(poi => {
    poi.potential_sources.forEach(source => {
      potentialSources.set(source, (potentialSources.get(source) || 0) + 1);
    });
  });

  console.log('\n🎯 Potential Image Sources Available:');
  Array.from(potentialSources.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([source, count]) => {
      const percentage = ((count / analysis.length) * 100).toFixed(1);
      console.log(`   ${source}: ${count} POIs (${percentage}%)`);
    });

  // POIs without images but with potential sources
  const poisWithoutImages = analysis.filter(poi => !poi.image_url);
  const poisWithoutImagesButWithSources = poisWithoutImages.filter(poi => poi.potential_sources.length > 0);

  console.log(`\n📷 POIs without images: ${poisWithoutImages.length}`);
  console.log(`🎯 POIs without images but with potential sources: ${poisWithoutImagesButWithSources.length}`);

  // Analyze by potential source
  console.log('\n🔍 Detailed Analysis by Source:');

  // Wikipedia
  const wikipediaPOIs = analysis.filter(poi => poi.has_wikipedia);
  const wikipediaWithoutImages = wikipediaPOIs.filter(poi => !poi.image_url);
  console.log(`\n📚 Wikipedia:`);
  console.log(`   Total POIs with Wikipedia: ${wikipediaPOIs.length}`);
  console.log(`   Without images: ${wikipediaWithoutImages.length}`);

  // Wikidata
  const wikidataPOIs = analysis.filter(poi => poi.has_wikidata);
  const wikidataWithoutImages = wikidataPOIs.filter(poi => !poi.image_url);
  console.log(`\n🗃️  Wikidata:`);
  console.log(`   Total POIs with Wikidata: ${wikidataPOIs.length}`);
  console.log(`   Without images: ${wikidataWithoutImages.length}`);

  // Website
  const websitePOIs = analysis.filter(poi => poi.has_website);
  const websiteWithoutImages = websitePOIs.filter(poi => !poi.image_url);
  console.log(`\n🌐 Website:`);
  console.log(`   Total POIs with website: ${websitePOIs.length}`);
  console.log(`   Without images: ${websiteWithoutImages.length}`);

  // Reference links
  const referencePOIs = analysis.filter(poi => poi.has_reference_links);
  const referenceWithoutImages = referencePOIs.filter(poi => !poi.image_url);
  console.log(`\n🔗 Reference Links:`);
  console.log(`   Total POIs with reference links: ${referencePOIs.length}`);
  console.log(`   Without images: ${referenceWithoutImages.length}`);

  // RAG sources
  const ragPOIs = analysis.filter(poi => poi.has_rag_links);
  const ragWithoutImages = ragPOIs.filter(poi => !poi.image_url);
  console.log(`\n🤖 RAG Sources:`);
  console.log(`   Total POIs with RAG sources: ${ragPOIs.length}`);
  console.log(`   Without images: ${ragWithoutImages.length}`);

  // Show sample POIs for each source
  console.log('\n📋 Sample POIs by Source:');

  // Wikipedia samples
  if (wikipediaWithoutImages.length > 0) {
    console.log('\n📚 Wikipedia POIs without images (first 5):');
    wikipediaWithoutImages.slice(0, 5).forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      Wikipedia: ${poi.osm_wikipedia_url}`);
    });
  }

  // Wikidata samples
  if (wikidataWithoutImages.length > 0) {
    console.log('\n🗃️  Wikidata POIs without images (first 5):');
    wikidataWithoutImages.slice(0, 5).forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      Wikidata: ${poi.osm_wikidata_id}`);
    });
  }

  // Website samples
  if (websiteWithoutImages.length > 0) {
    console.log('\n🌐 Website POIs without images (first 5):');
    websiteWithoutImages.slice(0, 5).forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      Website: ${poi.website}`);
    });
  }

  // Reference links samples
  if (referenceWithoutImages.length > 0) {
    console.log('\n🔗 Reference Links POIs without images (first 5):');
    referenceWithoutImages.slice(0, 5).forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      Reference Links: ${poi.reference_links}`);
    });
  }

  // RAG sources samples
  if (ragWithoutImages.length > 0) {
    console.log('\n🤖 RAG Sources POIs without images (first 5):');
    ragWithoutImages.slice(0, 5).forEach((poi, index) => {
      console.log(`   ${index + 1}. ${poi.name} (${poi.city}, ${poi.state})`);
      console.log(`      RAG Wikipedia: ${poi.rag_wikipedia_links}`);
      console.log(`      RAG Official: ${poi.rag_official_sources}`);
    });
  }
}

async function saveAnalysisResults(analysis: POIImageAnalysis[]): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const outputDir = path.join(process.cwd(), 'scripts', 'output');
  await fs.mkdir(outputDir, { recursive: true });
  
  // Save full analysis
  const analysisFile = path.join(outputDir, 'additional-image-sources-analysis.json');
  await fs.writeFile(analysisFile, JSON.stringify(analysis, null, 2));
  console.log(`💾 Full analysis saved to: ${analysisFile}`);
  
  // Save POIs without images but with potential sources
  const poisWithoutImages = analysis.filter(poi => !poi.image_url && poi.potential_sources.length > 0);
  const candidatesFile = path.join(outputDir, 'image-source-candidates.json');
  await fs.writeFile(candidatesFile, JSON.stringify(poisWithoutImages, null, 2));
  console.log(`🎯 Image source candidates saved to: ${candidatesFile}`);
  
  // Save CSV summary
  const csvFile = path.join(outputDir, 'additional-image-sources-summary.csv');
  const csvHeader = 'ID,Name,City,State,Current_Image_URL,Current_Source,Wikipedia_URL,Wikidata_ID,Website,Reference_Links,RAG_Wikipedia,RAG_Official,Potential_Sources\n';
  const csvRows = analysis.map(poi => 
    `"${poi.id}","${poi.name}","${poi.city}","${poi.state}","${poi.image_url || ''}","${poi.image_source || ''}","${poi.osm_wikipedia_url || ''}","${poi.osm_wikidata_id || ''}","${poi.website || ''}","${poi.reference_links || ''}","${poi.rag_wikipedia_links || ''}","${poi.rag_official_sources || ''}","${poi.potential_sources.join(';')}"`
  ).join('\n');
  
  await fs.writeFile(csvFile, csvHeader + csvRows);
  console.log(`📊 CSV summary saved to: ${csvFile}`);
}

async function main() {
  console.log('🎯 Additional Image Sources Analysis');
  console.log('===================================\n');

  try {
    // Analyze POIs
    const analysis = await analyzeAdditionalImageSources();
    
    if (analysis.length === 0) {
      console.log('❌ No POIs found for analysis.');
      return;
    }

    // Generate report
    await generateAnalysisReport(analysis);
    
    // Save results
    await saveAnalysisResults(analysis);
    
    console.log('\n✅ Analysis completed successfully!');
    console.log(`📊 Analyzed ${analysis.length} POIs`);
    
    // Show summary
    const poisWithoutImages = analysis.filter(poi => !poi.image_url);
    const poisWithPotentialSources = poisWithoutImages.filter(poi => poi.potential_sources.length > 0);
    
    console.log(`🎯 Opportunities:`);
    console.log(`   POIs without images: ${poisWithoutImages.length}`);
    console.log(`   POIs with potential sources: ${poisWithPotentialSources.length}`);
    console.log(`   Potential for additional images: ${((poisWithPotentialSources.length / poisWithoutImages.length) * 100).toFixed(1)}%`);
    
  } catch (error) {
    console.error('💥 Analysis failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

export { analyzeAdditionalImageSources, generateAnalysisReport };
