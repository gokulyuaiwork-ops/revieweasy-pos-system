import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const SUPABASE_URL = 'https://fzjjztbobwtuywohwmfe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6amp6dGJvYnd0dXl3b2h3bWZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3ODUxNDcsImV4cCI6MjEwMjM2MTE0N30.XVIo0uTuFd7p66DaufjLXu1PqGJuLVkEEfY5a32kQ28';

console.log('========================================================================');
console.log('☁️ TESTING LIVE SUPABASE BACKEND CONNECTIVITY');
console.log('========================================================================\n');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket }
});

async function testConnection() {
  console.log('1. Pinging Supabase Database...');
  
  // Test reading from bills table
  const { data: billsData, error: billsError } = await supabase.from('bills').select('*').limit(5);
  
  if (billsError) {
    console.error('⚠️  Bills query result:', billsError.message);
    if (billsError.code === '42P01' || billsError.message?.includes('does not exist') || billsError.message?.includes('relation "public.bills" does not exist')) {
      console.log('👉 ACTION NEEDED: Please run supabase_schema.sql in the Supabase SQL editor to create the tables!');
    }
  } else {
    console.log('✅ Successfully connected to Supabase PostgreSQL!');
    console.log('Found bills records:', billsData.length);
  }

  // Test reading from stores table
  const { data: storesData, error: storesError } = await supabase.from('stores').select('*').limit(5);
  if (storesError) {
    console.error('⚠️  Stores query result:', storesError.message);
  } else {
    console.log('✅ Stores table accessible. Found stores:', storesData.length);
  }
}

testConnection();
