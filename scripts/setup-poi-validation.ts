#!/usr/bin/env tsx

/**
 * POI Validation Setup Script
 * 
 * This script sets up the POI name validation system by:
 * - Checking environment variables
 * - Running database migrations
 * - Testing API connections
 * - Creating initial configuration
 * - Running validation tests
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { existsSync, readFileSync } from 'fs'
import { POIValidationService } from '../lib/services/poi-validation-service'

// Load environment variables
config({ path: '.env' })

interface SetupResult {
  step: string
  status: 'success' | 'error' | 'warning'
  message: string
  details?: any
}

class POIValidationSetup {
  private results: SetupResult[] = []
  
  private addResult(step: string, status: 'success' | 'error' | 'warning', message: string, details?: any) {
    this.results.push({ step, status, message, details })
    
    const icon = status === 'success' ? '✅' : status === 'error' ? '❌' : '⚠️'
    console.log(`${icon} ${step}: ${message}`)
    
    if (details && status === 'error') {
      console.log(`   Details: ${details}`)
    }
  }
  
  private checkEnvironmentVariables(): boolean {
    console.log('\n🔧 Checking Environment Variables...')
    
    const requiredVars = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'GEMINI_API_KEY'
    ]
    
    let allPresent = true
    
    for (const varName of requiredVars) {
      if (process.env[varName]) {
        this.addResult('Environment', 'success', `${varName} is set`)
      } else {
        this.addResult('Environment', 'error', `${varName} is missing`)
        allPresent = false
      }
    }
    
    // Check .env file
    if (existsSync('.env')) {
      this.addResult('Environment', 'success', '.env file found')
    } else {
      this.addResult('Environment', 'warning', '.env file not found')
    }
    
    return allPresent
  }
  
  private async testSupabaseConnection(): Promise<boolean> {
    console.log('\n🗄️  Testing Supabase Connection...')
    
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      
      // Test basic connection
      const { data, error } = await supabase.schema('core').from('attractions').select('count', { count: 'exact', head: true })
      
      if (error) {
        this.addResult('Supabase', 'error', 'Connection failed', error.message)
        return false
      }
      
      const count = data?.length || 0
      this.addResult('Supabase', 'success', `Connected successfully (${count} POIs found)`)
      
      // Test required tables
      const tables = ['attractions', 'poi_name_validations', 'poi_validation_batches']
      
      for (const table of tables) {
        try {
          const { error: tableError } = await supabase.schema('core').from(table).select('*', { head: true, count: 'exact' })
          
          if (tableError) {
            this.addResult('Database', 'error', `Table '${table}' not accessible`, tableError.message)
            return false
          } else {
            this.addResult('Database', 'success', `Table '${table}' is accessible`)
          }
        } catch (err) {
          this.addResult('Database', 'error', `Table '${table}' check failed`, err.message)
          return false
        }
      }
      
      return true
    } catch (error) {
      this.addResult('Supabase', 'error', 'Connection test failed', error.message)
      return false
    }
  }
  
  private async testGeminiConnection(): Promise<boolean> {
    console.log('\n🤖 Testing Gemini API Connection...')
    
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
      
      // Test with a simple prompt
      const testPrompt = 'Respond with exactly: "API connection successful"'
      const result = await model.generateContent(testPrompt)
      const response = await result.response
      const text = response.text()
      
      if (text.includes('API connection successful')) {
        this.addResult('Gemini', 'success', 'API connection successful')
        return true
      } else {
        this.addResult('Gemini', 'warning', 'API connected but unexpected response', text)
        return true
      }
    } catch (error) {
      this.addResult('Gemini', 'error', 'API connection failed', error.message)
      return false
    }
  }
  
  private async checkDatabaseSchema(): Promise<boolean> {
    console.log('\n📋 Checking Database Schema...')
    
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      
      // Check if validation tables exist and have correct structure
      const { data: validationColumns, error: validationError } = await supabase
        .schema('core')
        .from('poi_name_validations')
        .select('*', { head: true })
      
      if (validationError) {
        this.addResult('Schema', 'error', 'poi_name_validations table not found or inaccessible', validationError.message)
        return false
      }
      
      this.addResult('Schema', 'success', 'poi_name_validations table is accessible')
      
      // Check views (simplified - just try to access one view)
      try {
        const { error: viewError } = await supabase
          .schema('core')
          .from('poi_validation_stats')
          .select('*', { head: true })
        
        if (viewError) {
          this.addResult('Schema', 'warning', 'Some validation views may be missing')
        } else {
          this.addResult('Schema', 'success', 'Validation views are accessible')
        }
      } catch (error) {
        this.addResult('Schema', 'warning', 'Could not verify views')
      }
      
      return true
    } catch (error) {
      this.addResult('Schema', 'error', 'Schema check failed', error.message)
      return false
    }
  }
  
  private async runValidationTest(): Promise<boolean> {
    console.log('\n🧪 Running Validation Test...')
    
    try {
      const validationService = new POIValidationService(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        process.env.GEMINI_API_KEY!,
        {
          gemini_model: 'gemini-1.5-flash',
          batch_size: 1,
          rate_limit_delay: 2000,
          auto_approval_threshold: 70,
          max_retries: 2
        }
      )
      
      // Get a sample POI for testing
      const pois = await validationService.getPOIsToProcess(0, 1)
      
      if (pois.length === 0) {
        this.addResult('Test', 'warning', 'No POIs available for testing')
        return true
      }
      
      const testPOI = pois[0]
      this.addResult('Test', 'success', `Found test POI: ${testPOI.name}`)
      
      // Run validation test
      const startTime = Date.now()
      const result = await validationService.validatePOI(testPOI)
      const duration = Date.now() - startTime
      
      this.addResult('Test', 'success', `Validation completed in ${duration}ms`)
      this.addResult('Test', 'success', `Confidence score: ${result.confidence_score}%`)
      this.addResult('Test', 'success', `POI type: ${result.poi_type || 'Not classified'}`)
      this.addResult('Test', 'success', `Evidence found: ${result.evidence_found ? 'Yes' : 'No'}`)
      
      if (result.suggested_name) {
        this.addResult('Test', 'success', `Suggested name: ${result.suggested_name}`)
      }
      
      return true
    } catch (error) {
      this.addResult('Test', 'error', 'Validation test failed', error.message)
      return false
    }
  }
  
  private async checkSystemResources(): Promise<boolean> {
    console.log('\n💻 Checking System Resources...')
    
    try {
      // Check Node.js version
      const nodeVersion = process.version
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0])
      
      if (majorVersion >= 18) {
        this.addResult('System', 'success', `Node.js version: ${nodeVersion}`)
      } else {
        this.addResult('System', 'error', `Node.js version too old: ${nodeVersion} (required: >=18)`)
        return false
      }
      
      // Check memory usage
      const memUsage = process.memoryUsage()
      const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024)
      
      this.addResult('System', 'success', `Memory usage: ${memUsageMB}MB`)
      
      // Check package.json for required dependencies
      if (existsSync('package.json')) {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies }
        
        const requiredPackages = [
          '@supabase/supabase-js',
          '@google/generative-ai',
          'dotenv'
        ]
        
        for (const pkg of requiredPackages) {
          if (dependencies[pkg]) {
            this.addResult('Dependencies', 'success', `${pkg} is installed`)
          } else {
            this.addResult('Dependencies', 'error', `${pkg} is missing`)
            return false
          }
        }
      }
      
      return true
    } catch (error) {
      this.addResult('System', 'error', 'System check failed', error.message)
      return false
    }
  }
  
  private printSummary() {
    console.log('\n📊 Setup Summary')
    console.log('=' .repeat(50))
    
    const successCount = this.results.filter(r => r.status === 'success').length
    const errorCount = this.results.filter(r => r.status === 'error').length
    const warningCount = this.results.filter(r => r.status === 'warning').length
    
    console.log(`✅ Successful checks: ${successCount}`)
    console.log(`❌ Failed checks: ${errorCount}`)
    console.log(`⚠️  Warnings: ${warningCount}`)
    
    if (errorCount === 0) {
      console.log('\n🎉 Setup completed successfully!')
      console.log('You can now run the POI validation script:')
      console.log('  npm run poi-validation')
      console.log('  npm run poi-validation -- --dry-run --max-pois=10  # Test run')
    } else {
      console.log('\n❌ Setup failed. Please fix the errors above before running validation.')
    }
    
    if (warningCount > 0) {
      console.log('\n⚠️  Please review the warnings above.')
    }
  }
  
  async run(): Promise<void> {
    console.log('🏷️  POI Name Validation System Setup')
    console.log('=' .repeat(50))
    
    try {
      // Run all setup checks
      const envOk = this.checkEnvironmentVariables()
      
      if (!envOk) {
        console.log('\n❌ Environment setup failed. Please check your .env.local file.')
        this.printSummary()
        return
      }
      
      const supabaseOk = await this.testSupabaseConnection()
      const geminiOk = await this.testGeminiConnection()
      const schemaOk = await this.checkDatabaseSchema()
      const systemOk = await this.checkSystemResources()
      
      if (supabaseOk && geminiOk && schemaOk && systemOk) {
        await this.runValidationTest()
      }
      
      this.printSummary()
      
    } catch (error) {
      console.error('\n💥 Setup failed with error:', error.message)
      this.addResult('Setup', 'error', 'Unexpected error during setup', error.message)
      this.printSummary()
    }
  }
}

// Main execution
async function main() {
  const setup = new POIValidationSetup()
  await setup.run()
}

if (require.main === module) {
  main()
}

export { POIValidationSetup }
