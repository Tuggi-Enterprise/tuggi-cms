#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Authentication Testing Script
 * 
 * Tests Bearer Token authentication across edge functions
 * 
 * Usage:
 * deno run --allow-net --allow-env test-auth.ts
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables:')
  console.error('   - SUPABASE_URL')
  console.error('   - SUPABASE_ANON_KEY')
  console.error('   - SUPABASE_SERVICE_ROLE_KEY')
  Deno.exit(1)
}

// Functions to test
const FUNCTIONS_TO_TEST = [
  'generate-description',
  'generate-native-narration',
  'store-poi-audio',
  // Add more as they're implemented
]

// ════════════════════════════════════════════════════════════════════════════════
// TEST FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

interface TestResult {
  functionName: string
  testName: string
  status: 'pass' | 'fail'
  expectedStatus: number
  actualStatus: number
  error?: string
}

const results: TestResult[] = []

async function testFunctionWithoutAuth(functionName: string): Promise<TestResult> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/${functionName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ test: true })
      }
    )

    const isPass = response.status === 401
    
    return {
      functionName,
      testName: 'Without Authorization header',
      status: isPass ? 'pass' : 'fail',
      expectedStatus: 401,
      actualStatus: response.status,
      error: isPass ? undefined : `Expected 401, got ${response.status}`
    }
  } catch (error) {
    return {
      functionName,
      testName: 'Without Authorization header',
      status: 'fail',
      expectedStatus: 401,
      actualStatus: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function testFunctionWithInvalidToken(functionName: string): Promise<TestResult> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/${functionName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid.token.here'
        },
        body: JSON.stringify({ test: true })
      }
    )

    const isPass = response.status === 401
    
    return {
      functionName,
      testName: 'With invalid Bearer token',
      status: isPass ? 'pass' : 'fail',
      expectedStatus: 401,
      actualStatus: response.status,
      error: isPass ? undefined : `Expected 401, got ${response.status}`
    }
  } catch (error) {
    return {
      functionName,
      testName: 'With invalid Bearer token',
      status: 'fail',
      expectedStatus: 401,
      actualStatus: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function testFunctionWithValidToken(
  functionName: string,
  token: string
): Promise<TestResult> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/${functionName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ test: true })
      }
    )

    // With valid token, we should get 200 or 400 (if body is invalid)
    // Not 401 (Unauthorized)
    const isPass = response.status !== 401
    
    return {
      functionName,
      testName: 'With valid Bearer token',
      status: isPass ? 'pass' : 'fail',
      expectedStatus: 200,
      actualStatus: response.status,
      error: isPass ? undefined : `Got 401 Unauthorized even with valid token!`
    }
  } catch (error) {
    return {
      functionName,
      testName: 'With valid Bearer token',
      status: 'fail',
      expectedStatus: 200,
      actualStatus: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ════════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('🧪 Supabase Edge Function Authentication Tests')
  console.log('═'.repeat(60))
  console.log(`\nTesting against: ${SUPABASE_URL}`)
  console.log(`Functions to test: ${FUNCTIONS_TO_TEST.join(', ')}\n`)

  // Get a valid token
  console.log('📝 Getting valid authentication token...')
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  let validToken: string | null = null
  try {
    // Create or get test user
    const testEmail = `test-${Date.now()}@tuggi.local`
    
    const { data: createRes } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: 'TestPassword123!',
      email_confirm: true
    })

    if (createRes?.user?.id) {
      const { data: sessionRes } = await supabase.auth.admin.createSession(createRes.user.id)
      validToken = sessionRes?.session?.access_token || null
      console.log(`✅ Created test user: ${testEmail}`)
    }
  } catch (error) {
    console.warn(`⚠️ Could not create test user: ${error}`)
    console.log('   Trying with anon key instead...')
  }

  if (!validToken) {
    console.error('❌ Could not obtain a valid authentication token')
    Deno.exit(1)
  }

  console.log(`✅ Got valid token: ${validToken.substring(0, 20)}...\n`)

  // Test each function
  for (const functionName of FUNCTIONS_TO_TEST) {
    console.log(`\n🔍 Testing ${functionName}`)
    console.log('─'.repeat(60))

    // Test 1: Without auth
    console.log('  Test 1: Without Authorization header...')
    const test1 = await testFunctionWithoutAuth(functionName)
    results.push(test1)
    console.log(`    ${test1.status === 'pass' ? '✅ PASS' : '❌ FAIL'} - Got ${test1.actualStatus}`)

    // Test 2: With invalid token
    console.log('  Test 2: With invalid Bearer token...')
    const test2 = await testFunctionWithInvalidToken(functionName)
    results.push(test2)
    console.log(`    ${test2.status === 'pass' ? '✅ PASS' : '❌ FAIL'} - Got ${test2.actualStatus}`)

    // Test 3: With valid token
    console.log('  Test 3: With valid Bearer token...')
    const test3 = await testFunctionWithValidToken(functionName, validToken)
    results.push(test3)
    console.log(`    ${test3.status === 'pass' ? '✅ PASS' : '❌ FAIL'} - Got ${test3.actualStatus}`)
  }

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log('📊 TEST SUMMARY')
  console.log('═'.repeat(60))

  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  const total = results.length

  console.log(`\n${passed}/${total} tests passed`)

  if (failed > 0) {
    console.log(`\n❌ Failed tests:`)
    results
      .filter(r => r.status === 'fail')
      .forEach(r => {
        console.log(`\n  ${r.functionName} - ${r.testName}`)
        console.log(`    Expected: ${r.expectedStatus}, Got: ${r.actualStatus}`)
        if (r.error) {
          console.log(`    Error: ${r.error}`)
        }
      })
  }

  console.log(`\n${passed === total ? '✅ All tests passed!' : '❌ Some tests failed'}`)

  Deno.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  Deno.exit(1)
})
