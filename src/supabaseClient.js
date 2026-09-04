import { createClient } from '@supabase/supabase-js';

// Pegamos directamente los valores de tu proyecto en Supabase:
const supabaseUrl = 'https://vhogjsnhfyngezxmrocw.supabase.co';
const supabaseAnonKey = 'sb_publishable_lm-ueSEkHUFv_HbscqmvBg_UPhGhxZb'; 

export const supabase = createClient(supabaseUrl, supabaseAnonKey);