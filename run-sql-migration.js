#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// Get Supabase project credentials from environment
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment');
  process.exit(1);
}

// Read SQL file
const sqlFile = process.argv[2] || 'scripts/sql-fixes/fix_poi_stats_direct.sql';
if (!fs.existsSync(sqlFile)) {
  console.error(`SQL file not found: ${sqlFile}`);
  process.exit(1);
}

const sql = fs.readFileSync(sqlFile, 'utf-8');
console.log(`📝 Loaded SQL from ${sqlFile} (${sql.length} bytes)`);

// Parse URL
const url = new URL(supabaseUrl);
const projectId = url.hostname.split('.')[0];

console.log(`🌐 Connecting to Supabase: ${projectId}`);
console.log(`📊 Executing SQL...`);

// Use RPC to execute raw SQL via Supabase's internal functions
// Option: Call via REST API using function execution

const requestData = JSON.stringify({
  query: sql
});

const options = {
  hostname: url.hostname,
  port: 443,
  path: `/rest/v1/rpc/pg_catalog.sql_exec`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${supabaseServiceKey}`,
    'Content-Length': Buffer.byteLength(requestData)
  }
};

// Actually, Supabase doesn't expose raw SQL exec via API
// Instead, use the admin API or direct psql

console.log(`\n⚠️  Note: Supabase REST API doesn't expose raw SQL execution.`);
console.log(`Please execute the SQL manually in Supabase SQL Editor:`);
console.log(`https://app.supabase.com/project/${projectId}/sql/new\n`);

console.log('SQL to execute:');
console.log('='.repeat(80));
console.log(sql);
console.log('='.repeat(80));
