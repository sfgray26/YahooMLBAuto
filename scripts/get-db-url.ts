/**
 * Database URL Helper
 * 
 * This script helps you set up the DATABASE_URL for UAT testing.
 * Run this after setting up your Railway project.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

console.log(`
═══════════════════════════════════════════════════════════════
  DATABASE URL SETUP HELPER
═══════════════════════════════════════════════════════════════

To run UAT tests, you need a DATABASE_URL environment variable.

OPTION 1: Use Railway Production Database (for real data testing)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Go to https://railway.app
2. Select your project
3. Click on your PostgreSQL database service
4. Go to "Variables" tab
5. Copy the DATABASE_URL value
6. Run: 

   railway variables --set DATABASE_URL="your-url-here"
   
   OR update your .env file directly

OPTION 2: Use Local Database (for development testing)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Start local PostgreSQL:

   docker-compose up -d postgres

2. The default .env file should work:

   DATABASE_URL=postgresql://cbb:cbb@localhost:5432/cbb

═══════════════════════════════════════════════════════════════
`);

// Check current .env
const envPath = join(process.cwd(), '.env');

try {
  const envContent = readFileSync(envPath, 'utf8');
  const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
  
  if (dbUrlMatch) {
    const currentUrl = dbUrlMatch[1];
    if (currentUrl.includes('localhost')) {
      console.log('✅ Current DATABASE_URL points to local database');
      console.log(`   ${currentUrl}\n`);
      console.log('To use Railway production database, update the .env file with:');
      console.log('DATABASE_URL=postgresql://user:pass@your-railway-host/railway\n');
    } else if (currentUrl.includes('railway')) {
      console.log('✅ Current DATABASE_URL appears to be a Railway URL');
      console.log(`   ${currentUrl.replace(/:([^:@]+)@/, ':***@')}\n`);
    } else {
      console.log('⚠️  Current DATABASE_URL:');
      console.log(`   ${currentUrl}\n`);
    }
  }
} catch {
  console.log('❌ No .env file found. Run: cp .env.example .env\n');
}

console.log(`
QUICK COMMANDS:
━━━━━━━━━━━━━━━
# Test with current DATABASE_URL
pnpm uat --season 2025

# Test specific category
pnpm uat --category duplicates

# For Railway (if you have Railway CLI)
railway run pnpm uat --season 2025
`);
