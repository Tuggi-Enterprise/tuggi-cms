#!/usr/bin/env tsx

/**
 * Migration Script: Centralize External API Calls
 * 
 * This script automatically migrates all external API calls to use the centralized
 * APIManager instead of direct fetch calls.
 * 
 * Changes:
 * - Replace direct fetch calls with APIManager
 * - Update API URLs to use centralized configuration
 * - Maintain functionality while reducing duplication
 * - Add proper error handling and rate limiting
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const SCRIPTS_DIR = './scripts'
const LIB_DIR = './lib'
const APP_DIR = './app'
const SUPABASE_DIR = './supabase'

interface APIMigrationPattern {
  from: RegExp
  to: string
  description: string
  apiType: string
}

const API_MIGRATION_PATTERNS: APIMigrationPattern[] = [
  // Google Maps APIs
  {
    from: /fetch\(`https:\/\/maps\.googleapis\.com\/maps\/api\/([^`]+)`/g,
    to: `api.google.maps('$1', {`,
    description: 'Replace Google Maps API calls',
    apiType: 'google-maps'
  },
  
  // Google Places APIs
  {
    from: /fetch\(`https:\/\/maps\.googleapis\.com\/maps\/api\/place\/([^`]+)`/g,
    to: `api.google.places('$1', {`,
    description: 'Replace Google Places API calls',
    apiType: 'google-places'
  },
  
  // Google Elevation APIs
  {
    from: /fetch\(`https:\/\/maps\.googleapis\.com\/maps\/api\/elevation\/([^`]+)`/g,
    to: `api.google.elevation({`,
    description: 'Replace Google Elevation API calls',
    apiType: 'google-elevation'
  },
  
  // OpenStreetMap Nominatim APIs
  {
    from: /fetch\(`https:\/\/nominatim\.openstreetmap\.org\/([^`]+)`/g,
    to: `api.osm.nominatim('$1', {`,
    description: 'Replace Nominatim API calls',
    apiType: 'openstreetmap-nominatim'
  },
  
  // OpenStreetMap Overpass APIs
  {
    from: /fetch\(`https:\/\/overpass-api\.de\/api\/interpreter`/g,
    to: `api.osm.overpass(`,
    description: 'Replace Overpass API calls',
    apiType: 'openstreetmap-overpass'
  },
  
  // Open Elevation APIs
  {
    from: /fetch\(`https:\/\/api\.open-elevation\.com\/api\/v1\/([^`]+)`/g,
    to: `apiManager.request('open-elevation', '$1', {`,
    description: 'Replace Open Elevation API calls',
    apiType: 'open-elevation'
  },
  
  // GeoNames APIs
  {
    from: /fetch\(`http:\/\/api\.geonames\.org\/([^`]+)`/g,
    to: `apiManager.request('geonames', '$1', {`,
    description: 'Replace GeoNames API calls',
    apiType: 'geonames'
  },
  
  // Wikimedia APIs
  {
    from: /fetch\(`https:\/\/commons\.wikimedia\.org\/w\/api\.php\?([^`]+)`/g,
    to: `api.wiki.media({`,
    description: 'Replace Wikimedia API calls',
    apiType: 'wikimedia'
  },
  
  // Wikipedia APIs
  {
    from: /fetch\(`https:\/\/pt\.wikipedia\.org\/w\/api\.php\?([^`]+)`/g,
    to: `api.wiki.pedia({`,
    description: 'Replace Wikipedia API calls',
    apiType: 'wikipedia'
  },
  
  // Wikidata APIs
  {
    from: /fetch\(`https:\/\/www\.wikidata\.org\/w\/api\.php\?([^`]+)`/g,
    to: `api.wiki.data({`,
    description: 'Replace Wikidata API calls',
    apiType: 'wikidata'
  },
  
  // OpenAI APIs
  {
    from: /fetch\(`https:\/\/api\.openai\.com\/v1\/([^`]+)`/g,
    to: `api.ai.openai('$1', {`,
    description: 'Replace OpenAI API calls',
    apiType: 'openai'
  },
  
  // Gemini APIs (direct fetch)
  {
    from: /fetch\(`https:\/\/generativelanguage\.googleapis\.com\/v1beta\/([^`]+)`/g,
    to: `api.ai.gemini('$1', {`,
    description: 'Replace Gemini API calls',
    apiType: 'google-gemini'
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

function migrateAPICalls(filePath: string): { migrated: boolean; changes: number } {
  try {
    const content = readFileSync(filePath, 'utf8')
    let newContent = content
    let changes = 0
    
    // Add import if not present and we're making changes
    let needsImport = false
    
    // Apply all migration patterns
    for (const pattern of API_MIGRATION_PATTERNS) {
      const matches = newContent.match(pattern.from)
      if (matches) {
        newContent = newContent.replace(pattern.from, pattern.to)
        changes += matches.length
        needsImport = true
        console.log(`  ✅ ${pattern.description}: ${matches.length} replacements`)
      }
    }
    
    // Add import if needed
    if (needsImport && !newContent.includes('import { api, apiManager }')) {
      const importLine = `import { api, apiManager } from '../lib/core/api-manager'\n`
      newContent = importLine + newContent
      changes++
      console.log(`  ✅ Added APIManager import`)
    }
    
    // Fix common patterns after migration
    newContent = fixCommonPatterns(newContent)
    
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

function fixCommonPatterns(content: string): string {
  let newContent = content
  
  // Fix fetch response handling
  newContent = newContent.replace(
    /const response = await api\.(\w+)\.(\w+)\(([^)]+)\)\s*if \(!response\.ok\)/g,
    `const response = await api.$1.$2($3)
    if (!response.success)`
  )
  
  // Fix response data access
  newContent = newContent.replace(
    /const data = await response\.json\(\)/g,
    `const data = response.data`
  )
  
  // Fix error handling
  newContent = newContent.replace(
    /throw new Error\(`HTTP \$\{response\.status\}: \$\{response\.statusText\}`\)/g,
    `throw new Error(response.error || 'API request failed')`
  )
  
  return newContent
}

function main() {
  console.log('🚀 Starting External API Migration')
  console.log('==================================\n')
  
  // Get all TypeScript files
  const scriptFiles = getAllFiles(SCRIPTS_DIR)
  const libFiles = getAllFiles(LIB_DIR)
  const appFiles = getAllFiles(APP_DIR)
  const supabaseFiles = getAllFiles(SUPABASE_DIR)
  
  const allFiles = [...scriptFiles, ...libFiles, ...appFiles, ...supabaseFiles]
  
  console.log(`📁 Found ${allFiles.length} files to check`)
  console.log(`   - Scripts: ${scriptFiles.length}`)
  console.log(`   - Lib: ${libFiles.length}`)
  console.log(`   - App: ${appFiles.length}`)
  console.log(`   - Supabase: ${supabaseFiles.length}\n`)
  
  let totalMigrated = 0
  let totalChanges = 0
  
  for (const filePath of allFiles) {
    // Skip the migration script itself
    if (filePath.includes('migrate-api-calls.ts')) {
      continue
    }
    
    console.log(`🔍 Checking ${filePath}`)
    
    const result = migrateAPICalls(filePath)
    
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
    console.log('\n🎉 API migration completed successfully!')
    console.log('💡 Next steps:')
    console.log('   1. Test the migrated files')
    console.log('   2. Run type checking: npm run type-check')
    console.log('   3. Run build: npm run build')
  } else {
    console.log('\n✨ No files needed migration - already using centralized APIs!')
  }
}

if (require.main === module) {
  main()
}

export { migrateAPICalls, getAllFiles, API_MIGRATION_PATTERNS }
