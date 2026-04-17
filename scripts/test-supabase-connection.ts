import { getSupabaseService } from '../lib/core/supabase-client'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

async function testConnection() {
  console.log('🚀 Starting Supabase Connection Test...')
  console.log('--- Environment Check ---')
  console.log(`URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(`Publishable Key Set: ${!!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`)
  console.log(`Secret Key Set: ${!!process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_SECRET_KEY !== 'your_sb_secret_key_here'}`)
  
  const supabase = getSupabaseService()
  
  try {
    console.log('\n--- Attempting to fetch current user (auth check) ---')
    // A simple query to test connection
    const { data, error } = await supabase.from('cms_users').select('count', { count: 'exact', head: true })
    
    if (error) {
      console.error('❌ Connection failed with Supabase error:')
      console.error(JSON.stringify(error, null, 2))
      
      if (error.message?.includes('fetch failed')) {
        console.log('\n💡 DIAGNOSIS: This is a network error (DNS or connection refused).')
        console.log('The domain tysnkzmljlmmqpbotkxv.supabase.co might be down or your project is paused.')
      }
    } else {
      console.log('✅ Success! Connected to Supabase successfully.')
      console.log(`Found ${data} records in core.cms_users (as service role).`)
    }
  } catch (err: any) {
    console.error('\n❌ Unexpected error during connection test:')
    console.error(err.message || err)
    
    if (err.message?.includes('fetch failed') || err.message?.includes('ENOTFOUND')) {
      console.log('\n💡 DIAGNOSIS: Network/DNS failure. The host cannot be resolved.')
    }
  }
}

testConnection()
