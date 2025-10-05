#!/usr/bin/env tsx

/**
 * POI Name Validation Script
 * 
 * This script validates and enhances POI names using Google Gemini AI.
 * It processes all POIs in the database and suggests improvements based on:
 * - OSM tags for context
 * - POI type classification
 * - Contextual descriptors
 * - Evidence-based suggestions only
 * 
 * Features:
 * - Automatic approval for high-confidence suggestions (≥70%)
 * - Manual review queue for lower confidence suggestions
 * - Complete audit trail of all changes
 * - Rate limiting for Gemini API calls
 * - Batch processing with progress tracking
 * 
 * Usage:
 *   npm run poi-validation
 *   # or with custom config
 *   npm run poi-validation -- --model=gemini-1.5-pro --batch-size=25 --threshold=80
 */

import { config } from 'dotenv'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { POIValidationService, ValidationConfig, POI, ValidationResult } from '../lib/services/poi-validation-service'
import { getSupabase } from '../lib/core/supabase-client'

// Load environment variables
config({ path: '.env' })

// Types
interface BatchProgress {
  batch_id: string
  total_pois: number
  processed: number
  failed: number
  auto_approved: number
  manual_review: number
  start_time: Date
  current_batch: number
  estimated_completion: Date | null
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
}

interface ScriptOptions {
  batchSize?: number
  threshold?: number
  resume?: boolean
  dryRun?: boolean
  maxPois?: number
}

// Configuration - Using Gemini Flash only
const DEFAULT_CONFIG: ValidationConfig = {
  gemini_model: 'gemini-1.5-flash',
  batch_size: 50,
  rate_limit_delay: 4000,
  auto_approval_threshold: 70,
  max_retries: 3
}

const PROGRESS_FILE = 'poi-validation-progress.json'

class POIValidationRunner {
  private validationService: POIValidationService
  private progress: BatchProgress
  private options: ScriptOptions
  
  constructor(options: ScriptOptions = {}) {
    this.options = options
    
    // Build configuration from options
    const config: ValidationConfig = {
      ...DEFAULT_CONFIG,
      batch_size: options.batchSize || DEFAULT_CONFIG.batch_size,
      auto_approval_threshold: options.threshold || DEFAULT_CONFIG.auto_approval_threshold
    }
    
    // Initialize service with centralized Supabase client
    const geminiApiKey = process.env.GEMINI_API_KEY!
    
    if (!geminiApiKey) {
      throw new Error('Missing required environment variable: GEMINI_API_KEY')
    }
    
    // Get centralized Supabase client
    const supabase = getSupabase('service')
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    this.validationService = new POIValidationService(
      supabaseUrl,
      supabaseKey,
      geminiApiKey,
      config
    )
    
    this.progress = this.loadProgress()
  }
  
  private loadProgress(): BatchProgress {
    if (this.options.resume && existsSync(PROGRESS_FILE)) {
      try {
        const data = JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'))
        console.log(`📂 Resuming from previous session (${data.processed}/${data.total_pois} processed)`)
        return {
          ...data,
          start_time: new Date(data.start_time),
          estimated_completion: data.estimated_completion ? new Date(data.estimated_completion) : null
        }
      } catch (error) {
        console.warn('⚠️  Failed to load progress file, starting fresh')
      }
    }
    
    return {
      batch_id: '',
      total_pois: 0,
      processed: 0,
      failed: 0,
      auto_approved: 0,
      manual_review: 0,
      start_time: new Date(),
      current_batch: 0,
      estimated_completion: null,
      status: 'pending'
    }
  }
  
  private saveProgress() {
    writeFileSync(PROGRESS_FILE, JSON.stringify(this.progress, null, 2))
  }
  
  private updateEstimatedCompletion() {
    if (this.progress.processed > 0) {
      const elapsed = Date.now() - this.progress.start_time.getTime()
      const avgTimePerPOI = elapsed / this.progress.processed
      const remaining = this.progress.total_pois - this.progress.processed
      const estimatedRemainingTime = remaining * avgTimePerPOI
      this.progress.estimated_completion = new Date(Date.now() + estimatedRemainingTime)
    }
  }
  
  private printHeader() {
    console.log('\n🚀 POI Name Validation System')
    console.log('=' .repeat(50))
    console.log(`Model: ${DEFAULT_CONFIG.gemini_model}`)
    console.log(`Batch size: ${this.options.batchSize || DEFAULT_CONFIG.batch_size}`)
    console.log(`Auto-approval threshold: ${this.options.threshold || DEFAULT_CONFIG.auto_approval_threshold}%`)
    console.log(`Dry run: ${this.options.dryRun ? 'Yes' : 'No'}`)
    if (this.options.maxPois) {
      console.log(`Max POIs to process: ${this.options.maxPois}`)
    }
    console.log('=' .repeat(50))
  }
  
  private printProgress() {
    const elapsed = Date.now() - this.progress.start_time.getTime()
    const elapsedHours = Math.floor(elapsed / (1000 * 60 * 60))
    const elapsedMinutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60))
    
    const percentage = this.progress.total_pois > 0 
      ? ((this.progress.processed / this.progress.total_pois) * 100).toFixed(1)
      : '0.0'
    
    const autoApprovalRate = this.progress.processed > 0
      ? ((this.progress.auto_approved / this.progress.processed) * 100).toFixed(1)
      : '0.0'
    
    console.log('\n📊 Progress Report')
    console.log('─'.repeat(40))
    console.log(`├─ Total POIs: ${this.progress.total_pois.toLocaleString()}`)
    console.log(`├─ Processed: ${this.progress.processed.toLocaleString()} (${percentage}%)`)
    console.log(`├─ Auto-approved: ${this.progress.auto_approved.toLocaleString()} (${autoApprovalRate}%)`)
    console.log(`├─ Manual review: ${this.progress.manual_review.toLocaleString()}`)
    console.log(`├─ Failed: ${this.progress.failed.toLocaleString()}`)
    console.log(`├─ Elapsed: ${elapsedHours}h ${elapsedMinutes}m`)
    
    if (this.progress.estimated_completion) {
      const remaining = this.progress.estimated_completion.getTime() - Date.now()
      const remainingHours = Math.floor(remaining / (1000 * 60 * 60))
      const remainingMinutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
      console.log(`└─ ETA: ${remainingHours}h ${remainingMinutes}m`)
    }
    console.log('')
  }
  
  private printFinalStats() {
    const elapsed = Date.now() - this.progress.start_time.getTime()
    const totalMinutes = Math.floor(elapsed / (1000 * 60))
    
    const autoApprovalRate = this.progress.processed > 0
      ? ((this.progress.auto_approved / this.progress.processed) * 100).toFixed(1)
      : '0.0'
    
    const manualReviewRate = this.progress.processed > 0
      ? ((this.progress.manual_review / this.progress.processed) * 100).toFixed(1)
      : '0.0'
    
    const errorRate = this.progress.processed > 0
      ? ((this.progress.failed / this.progress.processed) * 100).toFixed(1)
      : '0.0'
    
    console.log('\n🎉 POI Name Validation Complete!')
    console.log('=' .repeat(50))
    console.log('📈 Final Statistics:')
    console.log(`├─ Total processed: ${this.progress.processed.toLocaleString()}`)
    console.log(`├─ Auto-approval rate: ${autoApprovalRate}%`)
    console.log(`├─ Manual review rate: ${manualReviewRate}%`)
    console.log(`├─ Error rate: ${errorRate}%`)
    console.log(`├─ Total time: ${totalMinutes} minutes`)
    console.log(`└─ Avg time per POI: ${(totalMinutes * 60 / this.progress.processed).toFixed(1)}s`)
    console.log('=' .repeat(50))
  }
  
  async run(): Promise<void> {
    try {
      this.printHeader()
      
      // Get total POI count if not set
      if (this.progress.total_pois === 0) {
        this.progress.total_pois = await this.validationService.getTotalPOICount()
        
        // Apply max POIs limit if specified
        if (this.options.maxPois && this.options.maxPois < this.progress.total_pois) {
          this.progress.total_pois = this.options.maxPois
          console.log(`📊 Limited to ${this.options.maxPois} POIs for testing`)
        }
        
        console.log(`📊 Total POIs to process: ${this.progress.total_pois.toLocaleString()}\n`)
      }
      
      // Create batch if not exists
      if (!this.progress.batch_id) {
        this.progress.batch_id = await this.validationService.createBatch(this.progress.total_pois)
        this.progress.status = 'processing'
        console.log(`📦 Created batch: ${this.progress.batch_id}`)
      }
      
      let lastProcessedId: string | null = this.progress.last_processed_id || null
      const batchSize = this.options.batchSize || DEFAULT_CONFIG.batch_size
      
      while (this.progress.processed < this.progress.total_pois) {
        this.progress.current_batch++
        const batchEnd = Math.min(this.progress.processed + batchSize, this.progress.total_pois)
        
        console.log(`\n🔄 Processing batch ${this.progress.current_batch} (POIs ${this.progress.processed + 1}-${batchEnd})`)
        
        const pois = await this.validationService.getPOIsToProcess(lastProcessedId, batchSize)
        
        if (pois.length === 0) {
          console.log('✅ No more POIs to process')
          break
        }
        
        // Process each POI in the batch
        for (const poi of pois) {
          try {
            const result = await this.validationService.validatePOI(poi)
            
            if (!this.options.dryRun) {
              // Save validation result
              await this.validationService.saveValidationResult(result, poi)
              
              // Apply name change if auto-approved
              if (result.auto_approved && result.new_name_applied) {
                await this.validationService.applyNameChange(poi.id, result.new_name_applied)
                this.progress.auto_approved++
              } else if (result.requires_manual_review) {
                this.progress.manual_review++
              }
            } else {
              // Dry run - just count results
              if (result.auto_approved) {
                this.progress.auto_approved++
              } else {
                this.progress.manual_review++
              }
              
              console.log(`🔍 [DRY RUN] ${poi.name} → ${result.suggested_name || 'No change'} (${result.confidence_score}%)`)
            }
            
            this.progress.processed++
            
          } catch (error) {
            console.error(`❌ Failed to process POI ${poi.id}:`, error.message)
            this.progress.failed++
          }
          
          // Update progress estimates
          this.updateEstimatedCompletion()
          this.saveProgress()
          
          // Break if we've reached max POIs limit
          if (this.options.maxPois && this.progress.processed >= this.options.maxPois) {
            break
          }
        }
        
        // Update batch progress in database
        if (!this.options.dryRun) {
          await this.validationService.updateBatchProgress(this.progress.batch_id, this.progress)
        }
        
        // Print progress after each batch
        this.printProgress()
        
        // Update last processed ID for cursor-based pagination
        if (pois.length > 0) {
          lastProcessedId = pois[pois.length - 1].id
          this.progress.last_processed_id = lastProcessedId
        }
        
        // Break if we've reached max POIs limit
        if (this.options.maxPois && this.progress.processed >= this.options.maxPois) {
          break
        }
      }
      
      // Mark as completed
      this.progress.status = 'completed'
      
      if (!this.options.dryRun) {
        await this.validationService.updateBatchProgress(this.progress.batch_id, this.progress)
      }
      
      this.printFinalStats()
      
      // Show validation statistics
      if (!this.options.dryRun) {
        const stats = await this.validationService.getValidationStats()
        if (stats) {
          console.log('\n📊 Database Statistics:')
          console.log(`├─ Total validations: ${stats.total_validations}`)
          console.log(`├─ Average confidence: ${stats.avg_confidence_score?.toFixed(1)}%`)
          console.log(`├─ POIs with evidence: ${stats.pois_with_evidence}`)
          console.log(`└─ POIs with descriptors: ${stats.pois_with_descriptors}`)
        }
      }
      
      // Clean up progress file on successful completion
      if (existsSync(PROGRESS_FILE) && this.progress.status === 'completed') {
        writeFileSync(PROGRESS_FILE.replace('.json', '-completed.json'), JSON.stringify(this.progress, null, 2))
        console.log(`\n💾 Progress saved to: ${PROGRESS_FILE.replace('.json', '-completed.json')}`)
      }
      
    } catch (error) {
      console.error('\n💥 Fatal error:', error.message)
      this.progress.status = 'failed'
      this.saveProgress()
      
      if (!this.options.dryRun && this.progress.batch_id) {
        await this.validationService.updateBatchProgress(this.progress.batch_id, this.progress)
      }
      
      process.exit(1)
    }
  }
}

// Parse command line arguments
function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2)
  const options: ScriptOptions = {}
  
  for (const arg of args) {
    if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1])
    } else if (arg.startsWith('--threshold=')) {
      options.threshold = parseInt(arg.split('=')[1])
    } else if (arg === '--resume') {
      options.resume = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg.startsWith('--max-pois=')) {
      options.maxPois = parseInt(arg.split('=')[1])
    }
  }
  
  return options
}

// Main execution
async function main() {
  try {
    const options = parseArgs()
    const runner = new POIValidationRunner(options)
    await runner.run()
  } catch (error) {
    console.error('💥 Fatal error:', error.message)
    process.exit(1)
  }
}

// Handle process signals
process.on('SIGINT', () => {
  console.log('\n⚠️  Process interrupted. Progress has been saved.')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n⚠️  Process terminated. Progress has been saved.')
  process.exit(0)
})

// Help text
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
🏷️  POI Name Validation Script

Usage:
  npm run poi-validation [options]

Options:
  --batch-size=SIZE      Number of POIs per batch (default: 50)
  --threshold=PERCENT    Auto-approval confidence threshold (default: 70)
  --resume               Resume from previous session
  --dry-run              Test run without making changes
  --max-pois=COUNT       Limit number of POIs to process (for testing)
  --help, -h             Show this help message

Examples:
  npm run poi-validation
  npm run poi-validation -- --threshold=80 --batch-size=25
  npm run poi-validation -- --dry-run --max-pois=100
  npm run poi-validation -- --resume

Model: Uses Gemini 1.5 Flash (optimized for cost and speed)

Environment Variables Required:
  NEXT_PUBLIC_SUPABASE_URL     Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY    Supabase service role key
  GEMINI_API_KEY              Google Gemini API key
`)
  process.exit(0)
}

if (require.main === module) {
  main()
}

export { POIValidationRunner }