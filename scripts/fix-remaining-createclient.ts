#!/usr/bin/env tsx

/**
 * Fix Remaining createClient References
 * 
 * This script fixes any remaining createClient references that weren't caught
 * by the initial migration script.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

function getAllFiles(dir: string, extensions: string[] = ['.ts', '.tsx', '.js', '.jsx']): string[] {
  const files: string[] = []
  
  try {
    const items = readdirSync(dir)
    
    for (const item of items) {
      const fullPath = join(dir, item)
      const stat = statSync(fullPath)
      
      if (stat.isDirectory()) {
        if (!['node_modules', '.next', 'dist', 'build'].includes(item)) {
          files.push(...getAllFiles(fullPath, extensions))
        }
      } else if (stat.isFile()) {
        const ext = item.substring(item.lastIndexOf('.'))
        if (extensions.includes(ext)) {
          files.push(fullPath)
        }
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read directory ${dir}:`, error)
  }
  
  return files
}

function fixCreateClientReferences(filePath: string): { fixed: boolean; changes: number } {
  try {
    const content = readFileSync(filePath, 'utf8')
    let newContent = content
    let changes = 0
    
    // Pattern 1: Direct createClient calls
    const createClientPattern = /const\s+supabase\s*=\s*createClient\s*\([^)]+\)/g
    const createClientMatches = newContent.match(createClientPattern)
    
    if (createClientMatches) {
      // Determine the appropriate client type based on context
      let clientType = 'server'
      
      if (filePath.includes('service') || filePath.includes('admin') || filePath.includes('bulk')) {
        clientType = 'service'
      } else if (filePath.includes('edge') || filePath.includes('supabase/functions')) {
        clientType = 'edge'
      } else if (filePath.includes('component') || filePath.includes('page.tsx') || filePath.includes('layout.tsx')) {
        clientType = 'client'
      }
      
      newContent = newContent.replace(createClientPattern, `const supabase = getSupabase('${clientType}')`)
      changes += createClientMatches.length
      console.log(`  ✅ Fixed createClient calls: ${createClientMatches.length} replacements (type: ${clientType})`)
    }
    
    // Pattern 2: createClient in function calls
    const functionCreateClientPattern = /createClient\s*\([^)]+\)/g
    const functionMatches = newContent.match(functionCreateClientPattern)
    
    if (functionMatches && !newContent.includes('getSupabase')) {
      // Add import if not present
      if (!newContent.includes('import { getSupabase }')) {
        const importLine = `import { getSupabase } from '../lib/core/supabase-client'\n`
        newContent = importLine + newContent
        changes++
        console.log(`  ✅ Added getSupabase import`)
      }
      
      // Replace createClient calls
      newContent = newContent.replace(functionCreateClientPattern, `getSupabase('service')`)
      changes += functionMatches.length
      console.log(`  ✅ Fixed function createClient calls: ${functionMatches.length} replacements`)
    }
    
    // Pattern 3: Fix lib/supabase.ts specifically
    if (filePath.includes('lib/supabase.ts')) {
      newContent = newContent.replace(
        /import\s*{\s*getSupabase\s*}\s*from\s*['"]core\/supabase-client['"]/g,
        `import { getSupabase } from './core/supabase-client'`
      )
      newContent = newContent.replace(
        /const\s+supabase\s*=\s*createClient\s*\([^)]+\)/g,
        `const supabase = getSupabase('server')`
      )
      changes++
      console.log(`  ✅ Fixed lib/supabase.ts`)
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
  console.log('🔧 Fixing Remaining createClient References')
  console.log('===========================================\n')
  
  // Get all TypeScript files
  const scriptFiles = getAllFiles('./scripts')
  const libFiles = getAllFiles('./lib')
  const appFiles = getAllFiles('./app')
  
  const allFiles = [...scriptFiles, ...libFiles, ...appFiles]
  
  console.log(`📁 Found ${allFiles.length} files to check`)
  console.log(`   - Scripts: ${scriptFiles.length}`)
  console.log(`   - Lib: ${libFiles.length}`)
  console.log(`   - App: ${appFiles.length}\n`)
  
  let totalFixed = 0
  let totalChanges = 0
  
  for (const filePath of allFiles) {
    // Skip the fix script itself and the supabase-client file
    if (filePath.includes('fix-remaining-createclient.ts') || filePath.includes('supabase-client.ts')) {
      continue
    }
    
    console.log(`🔍 Checking ${filePath}`)
    
    const result = fixCreateClientReferences(filePath)
    
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
  console.log(`📁 Files checked: ${allFiles.length}`)
  
  if (totalFixed > 0) {
    console.log('\n🎉 Remaining createClient references fixed!')
  } else {
    console.log('\n✨ No remaining createClient references found!')
  }
}

if (require.main === module) {
  main()
}

export { fixCreateClientReferences, getAllFiles }
