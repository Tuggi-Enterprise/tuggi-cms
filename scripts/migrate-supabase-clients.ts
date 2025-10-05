#!/usr/bin/env tsx

/**
 * Migration Script: Centralize Supabase Clients
 * 
 * This script automatically migrates all scripts to use the centralized
 * SupabaseClientManager instead of creating individual clients.
 * 
 * Changes:
 * - Replace `createClient` imports with centralized client
 * - Update client initialization patterns
 * - Maintain functionality while reducing duplication
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const SCRIPTS_DIR = './scripts'
const LIB_DIR = './lib'
const APP_DIR = './app'

interface MigrationPattern {
  from: RegExp
  to: string
  description: string
}

const MIGRATION_PATTERNS: MigrationPattern[] = [
  // Pattern 1: Direct createClient import
  {
    from: /import\s*{\s*createClient\s*}\s*from\s*['"]@supabase\/supabase-js['"]/g,
    to: `import { getSupabase } from '../lib/core/supabase-client'`,
    description: 'Replace createClient import with centralized client'
  },
  
  // Pattern 2: createClient initialization
  {
    from: /const\s+supabase\s*=\s*createClient\(\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL!,\s*process\.env\.SUPABASE_SERVICE_ROLE_KEY!\s*\)/g,
    to: `const supabase = getSupabase('service')`,
    description: 'Replace service client initialization'
  },
  
  // Pattern 3: createClient with anon key
  {
    from: /const\s+supabase\s*=\s*createClient\(\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL!,\s*process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY!\s*\)/g,
    to: `const supabase = getSupabase('server')`,
    description: 'Replace server client initialization'
  },
  
  // Pattern 4: Edge Functions createClient
  {
    from: /const\s+supabase\s*=\s*createClient\(\s*Deno\.env\.get\('SUPABASE_URL'\)!,\s*Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)!\s*\)/g,
    to: `const supabase = getSupabase('edge')`,
    description: 'Replace Edge Function client initialization'
  },
  
  // Pattern 5: Complex initialization with options
  {
    from: /const\s+supabase\s*=\s*createClient\(\s*[^,]+,\s*[^,]+,\s*\{[^}]*auth[^}]*\}\s*\)/g,
    to: `const supabase = getSupabase('service')`,
    description: 'Replace complex client initialization'
  }
]

function getAllFiles(dir: string, extensions: string[] = ['.ts', '.tsx', '.js', '.jsx']): string[] {
  const files: string[] = []
  
  try {
    const items = readdirSync(dir)
    
    for (const item of items) {
      const fullPath = join(dir, item)
      const stat = statSync(fullPath)
      
      if (stat.isDirectory()) {
        // Skip node_modules and .next directories
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

function migrateFile(filePath: string): { migrated: boolean; changes: number } {
  try {
    const content = readFileSync(filePath, 'utf8')
    let newContent = content
    let changes = 0
    
    // Apply all migration patterns
    for (const pattern of MIGRATION_PATTERNS) {
      const matches = newContent.match(pattern.from)
      if (matches) {
        newContent = newContent.replace(pattern.from, pattern.to)
        changes += matches.length
        console.log(`  ✅ ${pattern.description}: ${matches.length} replacements`)
      }
    }
    
    // Only write if changes were made
    if (changes > 0) {
      writeFileSync(filePath, newContent, 'utf8')
      return { migrated: true, changes }
    }
    
    return { migrated: false, changes: 0 }
  } catch (error) {
    console.error(`❌ Error migrating ${filePath}:`, error)
    return { migrated: false, changes: 0 }
  }
}

function main() {
  console.log('🚀 Starting Supabase Client Migration')
  console.log('=====================================\n')
  
  // Get all TypeScript files
  const scriptFiles = getAllFiles(SCRIPTS_DIR)
  const libFiles = getAllFiles(LIB_DIR)
  const appFiles = getAllFiles(APP_DIR)
  
  const allFiles = [...scriptFiles, ...libFiles, ...appFiles]
  
  console.log(`📁 Found ${allFiles.length} files to check`)
  console.log(`   - Scripts: ${scriptFiles.length}`)
  console.log(`   - Lib: ${libFiles.length}`)
  console.log(`   - App: ${appFiles.length}\n`)
  
  let totalMigrated = 0
  let totalChanges = 0
  
  for (const filePath of allFiles) {
    // Skip the migration script itself
    if (filePath.includes('migrate-supabase-clients.ts')) {
      continue
    }
    
    // Skip files that already use centralized client
    if (filePath.includes('supabase-client.ts')) {
      continue
    }
    
    console.log(`🔍 Checking ${filePath}`)
    
    const result = migrateFile(filePath)
    
    if (result.migrated) {
      totalMigrated++
      totalChanges += result.changes
      console.log(`  ✅ Migrated: ${result.changes} changes\n`)
    } else {
      console.log(`  ⏭️  No changes needed\n`)
    }
  }
  
  console.log('📊 Migration Summary')
  console.log('===================')
  console.log(`✅ Files migrated: ${totalMigrated}`)
  console.log(`📝 Total changes: ${totalChanges}`)
  console.log(`📁 Files checked: ${allFiles.length}`)
  
  if (totalMigrated > 0) {
    console.log('\n🎉 Migration completed successfully!')
    console.log('💡 Next steps:')
    console.log('   1. Test the migrated files')
    console.log('   2. Run type checking: npm run type-check')
    console.log('   3. Run build: npm run build')
  } else {
    console.log('\n✨ No files needed migration - already using centralized client!')
  }
}

if (require.main === module) {
  main()
}

export { migrateFile, getAllFiles, MIGRATION_PATTERNS }
