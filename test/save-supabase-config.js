import { storage } from '../src/engine/storage.js';

const updated = storage.updateConfig({
  supabaseUrl: 'https://fzjjztbobwtuywohwmfe.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6amp6dGJvYnd0dXl3b2h3bWZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3ODUxNDcsImV4cCI6MjEwMjM2MTE0N30.XVIo0uTuFd7p66DaufjLXu1PqGJuLVkEEfY5a32kQ28'
});

console.log('✅ Supabase configuration saved permanently to ReviewEasy storage:', {
  supabaseUrl: updated.supabaseUrl,
  hasAnonKey: !!updated.supabaseAnonKey
});
