#!/usr/bin/env tsx

/**
 * POI Validation Review Script
 * 
 * This script helps manage the manual review process for POI name validations.
 * It provides tools to:
 * - View POIs requiring manual review
 * - Approve or reject validation suggestions
 * - Generate review reports
 * - Bulk approve/reject operations
 */

import { config } from 'dotenv'
import { POIValidationService } from '../lib/services/poi-validation-service'

// Load environment variables
config({ path: '.env' })

interface ReviewOptions {
  action: 'list' | 'approve' | 'reject' | 'stats' | 'bulk-approve' | 'bulk-reject'
  priority?: 'low' | 'medium' | 'high' | 'critical'
  limit?: number
  validationId?: string
  reason?: string
  confidenceThreshold?: number
  dryRun?: boolean
}

class POIValidationReviewer {
  private validationService: POIValidationService
  
  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const geminiApiKey = process.env.GEMINI_API_KEY!
    
    if (!supabaseUrl || !supabaseKey || !geminiApiKey) {
      throw new Error('Missing required environment variables')
    }
    
    this.validationService = new POIValidationService(
      supabaseUrl,
      supabaseKey,
      geminiApiKey
    )
  }
  
  async listReviewQueue(options: ReviewOptions): Promise<void> {
    console.log('\n📋 POI Review Queue')
    console.log('=' .repeat(60))
    
    try {
      const queue = await this.validationService.getReviewQueue(
        options.limit || 20,
        options.priority
      )
      
      if (queue.length === 0) {
        console.log('✅ No POIs require manual review!')
        return
      }
      
      console.log(`Found ${queue.length} POIs requiring review:\n`)
      
      for (const item of queue) {
        const priority = item.review_priority.toUpperCase().padEnd(8)
        const confidence = `${item.confidence_score}%`.padEnd(4)
        const evidence = item.evidence_found ? '✅' : '❌'
        
        console.log(`📍 ${item.current_name}`)
        console.log(`   └─ Location: ${item.city}, ${item.state || 'N/A'}`)
        console.log(`   └─ Suggested: ${item.suggested_name || 'No suggestion'}`)
        console.log(`   └─ Priority: ${priority} | Confidence: ${confidence} | Evidence: ${evidence}`)
        console.log(`   └─ Type: ${item.poi_type || 'Unknown'} | ID: ${item.id}`)
        console.log(`   └─ Reasoning: ${item.reasoning}`)
        
        if (item.evidence_source) {
          console.log(`   └─ Evidence: ${item.evidence_source}`)
        }
        
        console.log('')
      }
      
      console.log(`Showing ${queue.length} items. Use --limit to see more.`)
      
    } catch (error) {
      console.error('❌ Failed to fetch review queue:', error.message)
    }
  }
  
  async showStats(): Promise<void> {
    console.log('\n📊 Validation Statistics')
    console.log('=' .repeat(50))
    
    try {
      const stats = await this.validationService.getValidationStats()
      
      if (!stats) {
        console.log('❌ No validation statistics available')
        return
      }
      
      const autoApprovalRate = stats.total_validations > 0
        ? ((stats.auto_approved_changes / stats.total_validations) * 100).toFixed(1)
        : '0.0'
      
      const evidenceRate = stats.total_validations > 0
        ? ((stats.pois_with_evidence / stats.total_validations) * 100).toFixed(1)
        : '0.0'
      
      console.log('📈 Overall Statistics:')
      console.log(`├─ Total validations: ${stats.total_validations.toLocaleString()}`)
      console.log(`├─ Auto-approved: ${stats.auto_approved_changes.toLocaleString()} (${autoApprovalRate}%)`)
      console.log(`├─ Pending review: ${stats.pending_review.toLocaleString()}`)
      console.log(`├─ Names changed: ${stats.names_changed.toLocaleString()}`)
      console.log(`├─ Average confidence: ${stats.avg_confidence_score?.toFixed(1)}%`)
      console.log(`└─ Evidence found: ${stats.pois_with_evidence.toLocaleString()} (${evidenceRate}%)\n`)
      
      console.log('🏷️  POI Classification:')
      console.log(`├─ Classified POIs: ${stats.classified_pois.toLocaleString()}`)
      console.log(`├─ With descriptors: ${stats.pois_with_descriptors.toLocaleString()}`)
      console.log(`└─ Avg classification confidence: ${stats.avg_classification_confidence?.toFixed(1)}%\n`)
      
      console.log('📊 Confidence Distribution:')
      console.log(`├─ High (≥90%): ${stats.high_confidence.toLocaleString()}`)
      console.log(`├─ Medium (70-89%): ${stats.medium_confidence.toLocaleString()}`)
      console.log(`└─ Low (<70%): ${stats.low_confidence.toLocaleString()}\n`)
      
      console.log('⏰ Review Priority:')
      console.log(`├─ Critical: ${stats.critical_reviews.toLocaleString()}`)
      console.log(`├─ High: ${stats.high_priority_reviews.toLocaleString()}`)
      console.log(`├─ Medium: ${stats.medium_priority_reviews.toLocaleString()}`)
      console.log(`└─ Low: ${stats.low_priority_reviews.toLocaleString()}`)
      
    } catch (error) {
      console.error('❌ Failed to fetch statistics:', error.message)
    }
  }
  
  async approveValidation(validationId: string, reason?: string, dryRun = false): Promise<void> {
    try {
      if (dryRun) {
        console.log(`🔍 [DRY RUN] Would approve validation: ${validationId}`)
        return
      }
      
      await this.validationService.approveValidation(validationId, reason)
      console.log(`✅ Approved validation: ${validationId}`)
      
    } catch (error) {
      console.error(`❌ Failed to approve validation ${validationId}:`, error.message)
    }
  }
  
  async rejectValidation(validationId: string, reason: string, dryRun = false): Promise<void> {
    try {
      if (dryRun) {
        console.log(`🔍 [DRY RUN] Would reject validation: ${validationId}`)
        return
      }
      
      await this.validationService.rejectValidation(validationId, reason)
      console.log(`❌ Rejected validation: ${validationId}`)
      
    } catch (error) {
      console.error(`❌ Failed to reject validation ${validationId}:`, error.message)
    }
  }
  
  async bulkApprove(options: ReviewOptions): Promise<void> {
    console.log('\n📦 Bulk Approval Process')
    console.log('=' .repeat(40))
    
    try {
      const queue = await this.validationService.getReviewQueue(1000) // Get more items for bulk
      
      // Filter by confidence threshold if specified
      const filtered = options.confidenceThreshold 
        ? queue.filter(item => item.confidence_score >= options.confidenceThreshold!)
        : queue
      
      // Filter by priority if specified
      const priorityFiltered = options.priority
        ? filtered.filter(item => item.review_priority === options.priority)
        : filtered
      
      if (priorityFiltered.length === 0) {
        console.log('✅ No items match the bulk approval criteria')
        return
      }
      
      console.log(`Found ${priorityFiltered.length} items matching criteria:`)
      if (options.confidenceThreshold) {
        console.log(`├─ Confidence ≥ ${options.confidenceThreshold}%`)
      }
      if (options.priority) {
        console.log(`├─ Priority: ${options.priority}`)
      }
      
      if (options.dryRun) {
        console.log('\n🔍 [DRY RUN] Would approve:')
        for (const item of priorityFiltered) {
          console.log(`   ├─ ${item.current_name} → ${item.suggested_name} (${item.confidence_score}%)`)
        }
        return
      }
      
      console.log('\n🚀 Starting bulk approval...')
      let approved = 0
      let failed = 0
      
      for (const item of priorityFiltered) {
        try {
          await this.validationService.approveValidation(
            item.id, 
            `Bulk approved - confidence: ${item.confidence_score}%`
          )
          approved++
          console.log(`✅ Approved: ${item.current_name} (${approved}/${priorityFiltered.length})`)
        } catch (error) {
          failed++
          console.error(`❌ Failed: ${item.current_name} - ${error.message}`)
        }
      }
      
      console.log(`\n📊 Bulk approval complete:`)
      console.log(`├─ Approved: ${approved}`)
      console.log(`└─ Failed: ${failed}`)
      
    } catch (error) {
      console.error('❌ Bulk approval failed:', error.message)
    }
  }
  
  async run(options: ReviewOptions): Promise<void> {
    try {
      switch (options.action) {
        case 'list':
          await this.listReviewQueue(options)
          break
          
        case 'stats':
          await this.showStats()
          break
          
        case 'approve':
          if (!options.validationId) {
            console.error('❌ Validation ID required for approval')
            return
          }
          await this.approveValidation(options.validationId, options.reason, options.dryRun)
          break
          
        case 'reject':
          if (!options.validationId || !options.reason) {
            console.error('❌ Validation ID and reason required for rejection')
            return
          }
          await this.rejectValidation(options.validationId, options.reason, options.dryRun)
          break
          
        case 'bulk-approve':
          await this.bulkApprove(options)
          break
          
        default:
          console.error('❌ Invalid action. Use: list, stats, approve, reject, bulk-approve')
      }
      
    } catch (error) {
      console.error('💥 Review operation failed:', error.message)
    }
  }
}

// Parse command line arguments
function parseArgs(): ReviewOptions {
  const args = process.argv.slice(2)
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
🏷️  POI Validation Review Tool

Usage:
  npm run poi-validation:review <action> [options]

Actions:
  list                       List POIs requiring manual review
  stats                      Show validation statistics
  approve --id=ID           Approve a specific validation
  reject --id=ID --reason=R Reject a specific validation
  bulk-approve              Bulk approve based on criteria

Options:
  --priority=PRIORITY       Filter by priority (low, medium, high, critical)
  --limit=N                 Limit number of results (default: 20)
  --id=ID                   Validation ID for approve/reject
  --reason=REASON           Reason for rejection
  --confidence=N            Minimum confidence for bulk operations
  --dry-run                 Preview without making changes

Examples:
  npm run poi-validation:review list
  npm run poi-validation:review list -- --priority=high --limit=50
  npm run poi-validation:review stats
  npm run poi-validation:review approve -- --id=uuid-here --reason="Verified correct"
  npm run poi-validation:review reject -- --id=uuid-here --reason="Incorrect suggestion"
  npm run poi-validation:review bulk-approve -- --confidence=80 --dry-run
`)
    process.exit(0)
  }
  
  const options: ReviewOptions = {
    action: args[0] as ReviewOptions['action']
  }
  
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--priority=')) {
      options.priority = arg.split('=')[1] as ReviewOptions['priority']
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1])
    } else if (arg.startsWith('--id=')) {
      options.validationId = arg.split('=')[1]
    } else if (arg.startsWith('--reason=')) {
      options.reason = arg.split('=')[1]
    } else if (arg.startsWith('--confidence=')) {
      options.confidenceThreshold = parseInt(arg.split('=')[1])
    } else if (arg === '--dry-run') {
      options.dryRun = true
    }
  }
  
  return options
}

// Main execution
async function main() {
  const options = parseArgs()
  const reviewer = new POIValidationReviewer()
  await reviewer.run(options)
}

if (require.main === module) {
  main()
}

export { POIValidationReviewer }
