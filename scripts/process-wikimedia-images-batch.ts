/**
 * Batch processing script for Wikimedia Commons images
 * 
 * This script processes all identified POIs with Wikimedia Commons images
 * and extracts them to the Supabase Storage bucket.
 */

import { config } from 'dotenv';
import { getSupabase } from '../lib/core/supabase-client';
import { readFile } from 'fs/promises';
import { join } from 'path';

// Load environment variables
config();

const supabase = getSupabase('service');

interface POIWithWikimedia {
  id: string;
  name: string;
  city: string;
  state: string;
  image_url: string | null;
  osm_tags: string | null;
  wikimedia_commons_url?: string;
  has_image_url: boolean;
  has_osm_tags: boolean;
}

interface ProcessingResult {
  poiId: string;
  poiName: string;
  success: boolean;
  imageId?: string;
  imageUrl?: string;
  error?: string;
  processingTime: number;
}

interface BatchStats {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  startTime: Date;
  endTime?: Date;
  totalTime?: number;
}

class WikimediaImageProcessor {
  private stats: BatchStats;
  private results: ProcessingResult[] = [];
  private delayBetweenRequests: number = 1000; // 1 second delay
  private batchSize: number = 10; // Process 10 at a time

  constructor() {
    this.stats = {
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      startTime: new Date()
    };
  }

  async loadPOIs(): Promise<POIWithWikimedia[]> {
    console.log('📂 Loading POIs from identification results...');
    
    try {
      const outputPath = join(process.cwd(), 'scripts', 'output', 'wikimedia-pois.json');
      const data = await readFile(outputPath, 'utf-8');
      const pois = JSON.parse(data) as POIWithWikimedia[];
      
      console.log(`✅ Loaded ${pois.length} POIs`);
      return pois;
    } catch (error) {
      console.error('❌ Failed to load POIs:', error);
      throw error;
    }
  }

  async processPOI(poi: POIWithWikimedia): Promise<ProcessingResult> {
    const startTime = Date.now();
    
    try {
      console.log(`🔄 Processing: ${poi.name} (${poi.city}, ${poi.state})`);
      
      // Check if POI already has a processed image
      const { data: existingImages } = await supabase
        .schema('core')
        .from('attraction_image')
        .select('id, image_url')
        .eq('attraction_id', poi.id)
        .limit(1);

      if (existingImages && existingImages.length > 0) {
        console.log(`⏭️  Skipping ${poi.name} - already has image`);
        return {
          poiId: poi.id,
          poiName: poi.name,
          success: true,
          imageUrl: existingImages[0].image_url,
          processingTime: Date.now() - startTime
        };
      }

      // Prepare request for edge function
      const requestBody = {
        attractionId: poi.id,
        attractionName: poi.name,
        imageSource: 'wikimedia_commons' as const,
        wikimediaUrl: poi.wikimedia_commons_url
      };

      // Call the edge function
      const { data, error } = await supabase.functions.invoke('store-poi-images', {
        body: requestBody
      });

      if (error) {
        throw new Error(`Edge function error: ${error.message}`);
      }

      if (!data.success || !data.images || data.images.length === 0) {
        throw new Error(`No image processed: ${data.errors?.join(', ') || 'Unknown error'}`);
      }

      const image = data.images[0];
      console.log(`✅ Success: ${poi.name} - Image ID: ${image.id}`);

      return {
        poiId: poi.id,
        poiName: poi.name,
        success: true,
        imageId: image.id,
        imageUrl: image.url,
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed: ${poi.name} - ${errorMessage}`);
      
      return {
        poiId: poi.id,
        poiName: poi.name,
        success: false,
        error: errorMessage,
        processingTime: Date.now() - startTime
      };
    }
  }

  async processBatch(pois: POIWithWikimedia[]): Promise<void> {
    console.log(`\n🚀 Processing batch of ${pois.length} POIs...`);
    
    for (let i = 0; i < pois.length; i++) {
      const poi = pois[i];
      const result = await this.processPOI(poi);
      
      this.results.push(result);
      this.stats.processed++;
      
      if (result.success) {
        if (result.imageId) {
          this.stats.successful++;
        } else {
          this.stats.skipped++;
        }
      } else {
        this.stats.failed++;
      }

      // Progress update
      const progress = ((this.stats.processed / this.stats.total) * 100).toFixed(1);
      console.log(`📊 Progress: ${this.stats.processed}/${this.stats.total} (${progress}%) - Success: ${this.stats.successful}, Failed: ${this.stats.failed}, Skipped: ${this.stats.skipped}`);

      // Delay between requests to avoid overwhelming the API
      if (i < pois.length - 1) {
        await this.delay(this.delayBetweenRequests);
      }
    }
  }

  async processAllPOIs(pois: POIWithWikimedia[]): Promise<void> {
    this.stats.total = pois.length;
    console.log(`\n🎯 Starting batch processing of ${this.stats.total} POIs`);
    console.log(`⚙️  Batch size: ${this.batchSize}, Delay: ${this.delayBetweenRequests}ms\n`);

    // Process in batches
    for (let i = 0; i < pois.length; i += this.batchSize) {
      const batch = pois.slice(i, i + this.batchSize);
      const batchNumber = Math.floor(i / this.batchSize) + 1;
      const totalBatches = Math.ceil(pois.length / this.batchSize);
      
      console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} POIs)`);
      await this.processBatch(batch);
      
      // Longer delay between batches
      if (i + this.batchSize < pois.length) {
        console.log(`⏳ Waiting 5 seconds before next batch...`);
        await this.delay(5000);
      }
    }

    this.stats.endTime = new Date();
    this.stats.totalTime = this.stats.endTime.getTime() - this.stats.startTime.getTime();
  }

  async saveResults(): Promise<void> {
    const outputDir = join(process.cwd(), 'scripts', 'output');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Save detailed results
    const resultsFile = join(outputDir, `wikimedia-processing-results-${timestamp}.json`);
    await import('fs/promises').then(fs => 
      fs.writeFile(resultsFile, JSON.stringify({
        stats: this.stats,
        results: this.results
      }, null, 2))
    );
    
    // Save summary CSV
    const csvFile = join(outputDir, `wikimedia-processing-summary-${timestamp}.csv`);
    const csvHeader = 'POI_ID,POI_Name,City,State,Success,Image_ID,Image_URL,Error,Processing_Time_MS\n';
    const csvRows = this.results.map(result => 
      `"${result.poiId}","${result.poiName}","","","${result.success}","${result.imageId || ''}","${result.imageUrl || ''}","${result.error || ''}","${result.processingTime}"`
    ).join('\n');
    
    await import('fs/promises').then(fs => 
      fs.writeFile(csvFile, csvHeader + csvRows)
    );
    
    console.log(`\n💾 Results saved:`);
    console.log(`   📄 Detailed: ${resultsFile}`);
    console.log(`   📊 Summary: ${csvFile}`);
  }

  printFinalStats(): void {
    console.log('\n🎉 Batch Processing Complete!');
    console.log('================================');
    console.log(`📊 Total POIs: ${this.stats.total}`);
    console.log(`✅ Successful: ${this.stats.successful}`);
    console.log(`❌ Failed: ${this.stats.failed}`);
    console.log(`⏭️  Skipped: ${this.stats.skipped}`);
    console.log(`⏱️  Total Time: ${this.formatTime(this.stats.totalTime || 0)}`);
    console.log(`📈 Success Rate: ${((this.stats.successful / this.stats.total) * 100).toFixed(1)}%`);
    
    if (this.stats.failed > 0) {
      console.log('\n❌ Failed POIs:');
      this.results
        .filter(r => !r.success)
        .slice(0, 10) // Show first 10 failures
        .forEach(result => {
          console.log(`   • ${result.poiName}: ${result.error}`);
        });
      
      if (this.stats.failed > 10) {
        console.log(`   ... and ${this.stats.failed - 10} more`);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

async function main() {
  console.log('🎯 Wikimedia Commons Image Batch Processing');
  console.log('==========================================\n');

  try {
    const processor = new WikimediaImageProcessor();
    
    // Load POIs
    const pois = await processor.loadPOIs();
    
    if (pois.length === 0) {
      console.log('❌ No POIs found to process.');
      return;
    }

    // Process all POIs
    await processor.processAllPOIs(pois);
    
    // Save results
    await processor.saveResults();
    
    // Print final stats
    processor.printFinalStats();
    
  } catch (error) {
    console.error('💥 Batch processing failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

export { WikimediaImageProcessor };
