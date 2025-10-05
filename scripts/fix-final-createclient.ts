#!/usr/bin/env tsx

/**
 * Final Fix for Remaining createClient References
 * 
 * This script fixes the last remaining createClient references that weren't caught
 * by the previous migration scripts.
 */

import { readFileSync, writeFileSync } from 'fs'

const FILES_TO_FIX = [
  'lib/services/dynamic-sources.ts',
  'lib/services/poi-processing/auth.service.ts',
  'lib/services/poi-processing/city-correction.service.ts',
  'lib/services/poi-processing/description.service.ts',
  'lib/services/poi-processing/osm-enrichment.service.ts',
  'lib/services/poi-processing/trigger-points-data-driven.service.ts',
  'lib/services/poi-processing/trigger-points.service.ts',
  'lib/services/poi-validation-service.ts',
  'lib/services/pov-embedding-service.ts',
  'lib/services/pov-pattern-extractor.ts'
]

function fixFile(filePath: string): { fixed: boolean; changes: number } {
  try {
    const content = readFileSync(filePath, 'utf8')
    let newContent = content
    let changes = 0
    
    // Add import if not present
    if (!newContent.includes('import { getSupabase }')) {
      const importLine = `import { getSupabase } from '../core/supabase-client'\n`
      newContent = importLine + newContent
      changes++
      console.log(`  ✅ Added getSupabase import`)
    }
    
    // Fix createClient calls
    const createClientPattern = /createClient\s*\([^)]+\)/g
    const matches = newContent.match(createClientPattern)
    
    if (matches) {
      // Determine client type based on file context
      let clientType = 'service'
      if (filePath.includes('auth.service.ts')) {
        clientType = 'server'
      }
      
      newContent = newContent.replace(createClientPattern, `getSupabase('${clientType}')`)
      changes += matches.length
      console.log(`  ✅ Fixed createClient calls: ${matches.length} replacements (type: ${clientType})`)
    }
    
    // Only write if changes were made
    if (changes > 0) {
      writeFileSync(filePath, newContent, 'utf8')
      return { fixed: true, changes }
    }
    
    return { fixed: false, changes: 0 }
  } catch (error) {
    console.error(`❌ Error fixing ${filePath}:`, error)
    return { fixed: false, changes: 0 }
  }
}

function main() {
  console.log('🔧 Final Fix for Remaining createClient References')
  console.log('================================================\n')
  
  let totalFixed = 0
  let totalChanges = 0
  
  for (const filePath of FILES_TO_FIX) {
    console.log(`🔍 Fixing ${filePath}`)
    
    const result = fixFile(filePath)
    
    if (result.fixed) {
      totalFixed++
      totalChanges += result.changes
      console.log(`  ✅ Fixed: ${result.changes} changes\n`)
    } else {
      console.log(`  ⏭️  No changes needed\n`)
    }
  }
  
  console.log('📊 Final Fix Summary')
  console.log('===================')
  console.log(`✅ Files fixed: ${totalFixed}`)
  console.log(`📝 Total changes: ${totalChanges}`)
  console.log(`📁 Files processed: ${FILES_TO_FIX.length}`)
  
  if (totalFixed > 0) {
    console.log('\n🎉 Final createClient references fixed!')
  } else {
    console.log('\n✨ No remaining createClient references found!')
  }
}

if (require.main === module) {
  main()
}

export { fixFile }
