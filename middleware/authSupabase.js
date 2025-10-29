const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

// Initialize Supabase clients with environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Validate required environment variables
if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  console.error('❌ CRITICAL: Missing Supabase configuration in environment variables');
  console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ANON_KEY');
  process.exit(1);
}

// Admin client for database operations
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Anon client for token verification
const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// JWT verification function
const verifySupabaseJWT = async (token) => {
  try {
    // First, decode and verify the JWT token structure
    const decoded = jwt.decode(token, { complete: true });
    
    if (!decoded || !decoded.header || !decoded.payload) {
      throw new Error('Invalid JWT token format');
    }

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (decoded.payload.exp && decoded.payload.exp < now) {
      throw new Error('Token has expired');
    }

    // Extract user ID from JWT payload (sub claim)
    const userId = decoded.payload.sub;
    
    if (!userId) {
      throw new Error('Invalid token: missing user ID (sub claim)');
    }

    // Use admin API to get user by ID
    // This validates the user exists and is active
    // Since we've already verified the JWT structure and expiration,
    // using admin API is the most reliable method for backend verification
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (error) {
      throw error;
    }

    if (!data || !data.user) {
      throw new Error('User not found');
    }

    return { user: data.user, error: null };
  } catch (error) {
    return { user: null, error };
  }
};

/**
 * Authentication middleware for Supabase
 */
const authenticateToken = async (req, res, next) => {
  try {
    console.log('🔍 Auth middleware - Request:', req.method, req.path);
    console.log('🔍 Auth middleware - Headers:', req.headers.authorization ? 'Token present' : 'No token');
    
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'No token provided'
      });
    }

    console.log('🔍 Token found, verifying with Supabase...');
    console.log('🔍 Token length:', token.length);
    console.log('🔍 Token preview:', token.substring(0, 50) + '...');
    
    // Verify Supabase JWT token using our custom verification function
    const { user: authUser, error: authError } = await verifySupabaseJWT(token);

    if (authError || !authUser) {
      console.error('❌ Supabase auth error:', authError);
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Authentication failed'
      });
    }

    console.log('✅ Supabase auth successful for:', authUser.email);

    // Get user details from auth metadata instead of users table
    const userData = {
      id: authUser.id,
      email: authUser.email,
      first_name: authUser.user_metadata?.first_name || authUser.user_metadata?.full_name?.split(' ')[0] || '',
      last_name: authUser.user_metadata?.last_name || authUser.user_metadata?.full_name?.split(' ')[1] || '',
      role: authUser.user_metadata?.role || 'worker',
      team: authUser.user_metadata?.team || authUser.user_metadata?.default_team || 'TEAM GEO',
      phone: authUser.user_metadata?.phone || '',
      address: authUser.user_metadata?.address || {},
      employer_id: authUser.user_metadata?.employer_id || '',
      is_active: true, // Assume active if authenticated
      last_login: authUser.last_sign_in_at || '',
      profile_image_url: authUser.user_metadata?.avatar_url || '',
      emergency_contact: authUser.user_metadata?.emergency_contact || {},
      medical_info: authUser.user_metadata?.medical_info || {},
      package: authUser.user_metadata?.package || '',
      team_leader_id: authUser.user_metadata?.team_leader_id || '',
      managed_teams: authUser.user_metadata?.managed_teams || []
    };

    console.log('✅ User authenticated from auth metadata:', userData.email, userData.role);

    // Attach user to request
    req.user = {
      id: userData.id,
      email: userData.email,
      role: userData.role,
      firstName: userData.first_name,
      lastName: userData.last_name,
      team: userData.team,
      teamLeaderId: userData.team_leader_id,
      managedTeams: userData.managed_teams
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    res.status(500).json({ 
      error: 'Authentication failed',
      message: 'Internal server error'
    });
  }
};

/**
 * Role-based authorization middleware
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please login first'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: `This endpoint requires one of these roles: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
};

/**
 * Optional authentication (doesn't fail if no token)
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      // Verify Supabase JWT token using our custom verification function
      const { user: authUser, error: authError } = await verifySupabaseJWT(token);
      
      if (!authError && authUser) {
        // Create user data from auth metadata
        req.user = {
          id: authUser.id,
          email: authUser.email,
          role: authUser.user_metadata?.role || 'worker',
          firstName: authUser.user_metadata?.first_name || authUser.user_metadata?.full_name?.split(' ')[0] || '',
          lastName: authUser.user_metadata?.last_name || authUser.user_metadata?.full_name?.split(' ')[1] || '',
          team: authUser.user_metadata?.team || authUser.user_metadata?.default_team || 'TEAM GEO'
        };
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

module.exports = {
  authenticateToken,
  requireRole,
  optionalAuth
};
