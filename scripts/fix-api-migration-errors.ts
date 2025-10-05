#!/usr/bin/env tsx

/**
 * Fix API Migration Errors Script
 * 
 * This script fixes common errors that occur during API migration,
 * such as malformed template literals and duplicate code.
 */

import { readFileSync, writeFileSync } from 'fs'

const FILES_TO_FIX = [
  'app/api/poi-boundaries/detect/route.ts',
  'lib/services/poi-processing/description.service.ts',
  'lib/services/poi-processing/trigger-points-data-driven.service.ts',
  'lib/services/poi-processing/trigger-points.service.ts'
]

function fixFile(filePath: string): { fixed: boolean; changes: number } {
  try {
    const content = readFileSync(filePath, 'utf8')
    let newContent = content
    let changes = 0
    
    // Fix malformed template literals in API calls
    const templateLiteralPattern = /api\.(\w+)\.(\w+)\(`([^`]+)`\s*,\s*\{/g
    const templateMatches = newContent.match(templateLiteralPattern)
    
    if (templateMatches) {
      newContent = newContent.replace(templateLiteralPattern, (match, apiType, method, url) => {
        // Extract parameters from URL
        const urlObj = new URL(`https://example.com/${url}`)
        const params: Record<string, string> = {}
        
        for (const [key, value] of urlObj.searchParams) {
          params[key] = value
        }
        
        return `api.${apiType}.${method}('${urlObj.pathname.substring(1)}', {`
      })
      changes += templateMatches.length
      console.log(`  ✅ Fixed template literals: ${templateMatches.length} replacements`)
    }
    
    // Fix duplicate code after API calls
    const duplicatePattern = /api\.(\w+)\.(\w+)\([^)]+\)\s*,\s*\{[^}]*\}\s*,\s*\{/g
    const duplicateMatches = newContent.match(duplicatePattern)
    
    if (duplicateMatches) {
      newContent = newContent.replace(duplicatePattern, (match) => {
        // Remove the duplicate part
        const firstBrace = match.indexOf('{')
        const secondBrace = match.indexOf('{', firstBrace + 1)
        return match.substring(0, secondBrace)
      })
      changes += duplicateMatches.length
      console.log(`  ✅ Fixed duplicate code: ${duplicateMatches.length} replacements`)
    }
    
    // Fix malformed object syntax
    const malformedPattern = /,\s*\{[^}]*\}\s*,\s*\{/g
    const malformedMatches = newContent.match(malformedPattern)
    
    if (malformedMatches) {
      newContent = newContent.replace(malformedPattern, '')
      changes += malformedMatches.length
      console.log(`  ✅ Fixed malformed objects: ${malformedMatches.length} replacements`)
    }
    
    // Fix response handling
    newContent = newContent.replace(
      /if \(!response\.ok\)/g,
      'if (!response.success)'
    )
    
    newContent = newContent.replace(
      /const data = await response\.json\(\)/g,
      'const data = response.data'
    )
    
    // Fix error handling
    newContent = newContent.replace(
      /throw new Error\(`HTTP \$\{response\.status\}: \$\{response\.statusText\}`\)/g,
      'throw new Error(response.error || \'API request failed\')'
    )
    
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
  console.log('🔧 Fixing API Migration Errors')
  console.log('===============================\n')
  
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
  
  console.log('📊 Fix Summary')
  console.log('==============')
  console.log(`✅ Files fixed: ${totalFixed}`)
  console.log(`📝 Total changes: ${totalChanges}`)
  console.log(`📁 Files processed: ${FILES_TO_FIX.length}`)
  
  if (totalFixed > 0) {
    console.log('\n🎉 API migration errors fixed!')
  } else {
    console.log('\n✨ No API migration errors found!')
  }
}

if (require.main === module) {
  main()
}

export { fixFile }
