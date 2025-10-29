const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

// ✅ OPTIMIZATION: Validate environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
let supabaseAdmin = null; // ✅ Admin client for backend operations
let db = null;

if (supabaseUrl && supabaseAnonKey) {
  // ✅ Regular client for general operations
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  // ✅ Admin client for backend-only operations (bypasses RLS)
  if (supabaseServiceKey) {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    logger.info('✅ Connected to Supabase database with admin privileges');
  } else {
    logger.warn('⚠️ Service role key not found - some admin operations may fail');
  }
  
  logger.info('✅ Connected to Supabase database');
  
  // Create database interface
  db = {
    users: {
      async findById(id) {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('id', id)
          .single();
        if (error) throw error;
        return data;
      },
      async findByEmail(email) {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('email', email)
          .single();
        if (error) throw error;
        return data;
      },
      async create(data) {
        const { data: result, error } = await supabase
          .from('users')
          .insert(data)
          .select()
          .single();
        if (error) throw error;
        return result;
      },
      async update(id, data) {
        const { data: result, error } = await supabase
          .from('users')
          .update(data)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return result;
      },
      async findMany(filters = {}) {
        let query = supabase.from('users').select('*');
        
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
        
        const { data, error } = await query;
        if (error) throw error;
        return data;
      },
      async count(filters = {}) {
        let query = supabase.from('users').select('*', { count: 'exact', head: true });
        
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
        
        const { count, error } = await query;
        if (error) throw error;
        return count;
      }
    },
    work_readiness: {
      async create(data) {
        const { data: result, error } = await supabase
          .from('work_readiness')
          .insert(data)
          .select()
          .single();
        if (error) throw error;
        return result;
      },
      async findMany(filters = {}) {
        let query = supabase.from('work_readiness').select('*');
        
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
        
        const { data, error } = await query;
        if (error) throw error;
        return data;
      }
    }
  };
} else {
  logger.error('❌ Supabase not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY.');
  throw new Error('Supabase configuration missing');
}

// ✅ OPTIMIZATION: Export both regular and admin clients
module.exports = { 
  supabase,
  supabaseAdmin,
  db 
};
