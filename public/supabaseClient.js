// public/supabaseClient.js
//import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

//export const supabase = createClient('https://fktxolwcqbwovlbfxevx.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrdHhvbHdjcWJ3b3ZsYmZ4ZXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI3NDQ5ODEsImV4cCI6MjA2ODMyMDk4MX0.T9fYsjhHm8zgTH-mfVWv9ZXUlB_Z0qlbNyQbiEXisg4');



//import { createClient } from '@supabase/supabase-js'

//const supabaseUrl = 'https://fktxolwcqbwovlbfxevx.supabase.co'
//const supabaseKey = process.env.SUPABASE_KEY
//const supabase = createClient(supabaseUrl, supabaseKey)


// public/supabaseClient.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

export const supabase = createClient(
  'https://fktxolwcqbwovlbfxevx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrdHhvbHdjcWJ3b3ZsYmZ4ZXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI3NDQ5ODEsImV4cCI6MjA2ODMyMDk4MX0.T9fYsjhHm8zgTH-mfVWv9ZXUlB_Z0qlbNyQbiEXisg4' // Paste your Supabase anon key here directly
);
