#!/usr/bin/env tsx

/**
 * Fix Import Paths Script
 * 
 * This script fixes the import paths for the centralized Supabase client
 * based on the file location relative to the lib/core directory.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, relative, dirname } from 'path'

const LIB_CORE_PATH = './lib/core/supabase-client'

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

function fixImportPath(filePath: string): { fixed: boolean; changes: number } {
  try {
    const content = readFileSync(filePath, 'utf8')
    let newContent = content
    let changes = 0
    
    // Calculate relative path from file to lib/core/supabase-client
    const relativePath = relative(dirname(filePath), LIB_CORE_PATH)
    const correctImport = `import { getSupabase } from '${relativePath}'`
    
    // Fix the import path
    const importPattern = /import\s*{\s*getSupabase\s*}\s*from\s*['"][^'"]*supabase-client['"]/g
    const matches = newContent.match(importPattern)
    
    if (matches) {
      newContent = newContent.replace(importPattern, correctImport)
      changes += matches.length
      console.log(`  ✅ Fixed import path: ${matches.length} replacements`)
    }
    
    // Also fix any remaining createClient references that weren't caught
    const createClientPattern = /createClient\s*\(/g
    const createClientMatches = newContent.match(createClientPattern)
    
    if (createClientMatches && !newContent.includes('getSupabase')) {
      console.log(`  ⚠️  Found createClient usage but no getSupabase import - manual fix needed`)
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
  console.log('🔧 Fixing Supabase Client Import Paths')
  console.log('======================================\n')
  
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
    if (filePath.includes('fix-import-paths.ts') || filePath.includes('supabase-client.ts')) {
      continue
    }
    
    console.log(`🔍 Checking ${filePath}`)
    
    const result = fixImportPath(filePath)
    
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
    console.log('\n🎉 Import paths fixed successfully!')
  } else {
    console.log('\n✨ No import paths needed fixing!')
  }
}

if (require.main === module) {
  main()
}

export { fixImportPath, getAllFiles }
