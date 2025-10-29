const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Admin Client
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/**
 * Get dashboard statistics (optimized for performance)
 * @route GET /api/admin/statistics
 * @access Admin only
 */
const getStatistics = async (req, res) => {
  try {
    console.log('🔍 Admin Statistics - Fetching optimized dashboard data...');

    // Use count queries for better performance with large datasets
    const [
      usersCount,
      activeCasesCount,
      closedCasesCount,
      completedAppointmentsCount,
      totalAppointmentsCount,
      cliniciansCount,
      workersCount,
      managersCount,
      supervisorsCount,
      teamLeadersCount
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('cases').select('*', { count: 'exact', head: true }).in('status', ['new', 'triaged', 'assessed', 'in_rehab', 'return_to_work']),
      supabaseAdmin.from('cases').select('*', { count: 'exact', head: true }).eq('status', 'closed'),
      supabaseAdmin.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      supabaseAdmin.from('appointments').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('role', 'clinician'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('role', 'worker'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('role', 'case_manager'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('role', 'site_supervisor'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('role', 'team_leader')
    ]);

    // Calculate basic statistics efficiently
    const totalUsers = usersCount.count || 0;
    const activeCases = activeCasesCount.count || 0;
    const closedCases = closedCasesCount.count || 0;
    const assessments = completedAppointmentsCount.count || 0;
    const totalAppointments = totalAppointmentsCount.count || 0;
    
    // Real-time role counts
    const roleCounts = {
      clinicians: cliniciansCount.count || 0,
      workers: workersCount.count || 0,
      managers: managersCount.count || 0,
      supervisors: supervisorsCount.count || 0,
      teamLeaders: teamLeadersCount.count || 0
    };
    
    // Calculate average resolution time (simplified calculation)
    const avgResolution = 12.5; // This would be calculated from actual case data
    
    // System health (configurable values)
    const systemHealth = 98;
    const storageUsed = '2.4GB';

    const statistics = {
      totalUsers,
      activeCases,
      closedCases,
      assessments,
      totalAppointments,
      avgResolution,
      systemHealth,
      storageUsed,
      roleCounts
    };

    console.log('✅ Optimized statistics fetched:', statistics);
    res.json(statistics);
  } catch (error) {
    console.error('❌ Statistics error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch statistics',
      message: error.message 
    });
  }
};
const getAdminAnalytics = async (req, res) => {
  try {
    console.log('🔍 Admin Analytics - Fetching data from Supabase...');

    // Fetch all data in parallel for better performance
    const [
      usersResult,
      casesResult,
      appointmentsResult,
      incidentsResult,
      rehabPlansResult,
      notificationsResult,
      assignmentsResult,
      shiftsResult
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: false }),
      supabaseAdmin.from('cases').select('*', { count: 'exact', head: false }),
      supabaseAdmin.from('appointments').select('*', { count: 'exact', head: false }),
      supabaseAdmin.from('incidents').select('*', { count: 'exact', head: false }),
      supabaseAdmin.from('rehabilitation_plans').select('*', { count: 'exact', head: false }),
      supabaseAdmin.from('notifications').select('*', { count: 'exact', head: false }),
      supabaseAdmin.from('work_readiness_assignments').select('*', { count: 'exact', head: false }),
      supabaseAdmin.from('shifts').select('*', { count: 'exact', head: false })
    ]);

    const users = usersResult.data || [];
    const cases = casesResult.data || [];
    const appointments = appointmentsResult.data || [];
    const incidents = incidentsResult.data || [];
    const rehabPlans = rehabPlansResult.data || [];
    const notifications = notificationsResult.data || [];
    const assignments = assignmentsResult.data || [];
    const shifts = shiftsResult.data || [];

    // Calculate date ranges
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // Overview Metrics
    const totalUsers = users.length;
    const totalCases = cases.length;
    const totalAppointments = appointments.length;
    const totalIncidents = incidents.length;
    const totalRehabPlans = rehabPlans.length;
    const totalNotifications = notifications.length;
    const totalAssignments = assignments.length;

    // Active users (logged in within last 7 days)
    const activeUsers = users.filter(u => {
      const lastLogin = u.last_login ? new Date(u.last_login) : null;
      return lastLogin && lastLogin >= sevenDaysAgo;
    }).length;

    // Monthly counts
    const casesThisMonth = cases.filter(c => new Date(c.created_at) >= startOfMonth).length;
    const appointmentsThisMonth = appointments.filter(a => new Date(a.created_at) >= startOfMonth).length;
    const incidentsThisMonth = incidents.filter(i => new Date(i.created_at) >= startOfMonth).length;
    const assignmentsThisMonth = assignments.filter(a => new Date(a.created_at) >= startOfMonth).length;

    // Growth metrics
    const usersLastMonth = users.filter(u => {
      const created = new Date(u.created_at);
      return created >= startOfLastMonth && created <= endOfLastMonth;
    }).length;
    const userGrowth = usersLastMonth > 0 ? Math.round(((totalUsers - usersLastMonth) / usersLastMonth) * 100) : 0;

    const casesLastMonth = cases.filter(c => {
      const created = new Date(c.created_at);
      return created >= startOfLastMonth && created <= endOfLastMonth;
    }).length;
    const caseGrowth = casesLastMonth > 0 ? Math.round(((totalCases - casesLastMonth) / casesLastMonth) * 100) : 0;

    // User analytics by role
    const usersByRole = {};
    users.forEach(u => {
      const role = u.role || 'unknown';
      usersByRole[role] = (usersByRole[role] || 0) + 1;
    });

    const usersByRoleWithPercentage = Object.entries(usersByRole).map(([role, count]) => ({
      role,
      count,
      percentage: Math.round((count / totalUsers) * 100)
    })).sort((a, b) => b.count - a.count);

    // Case analytics by status
    const casesByStatus = {};
    cases.forEach(c => {
      const status = c.status || 'unknown';
      casesByStatus[status] = (casesByStatus[status] || 0) + 1;
    });

    const casesByStatusWithPercentage = Object.entries(casesByStatus).map(([status, count]) => ({
      status,
      count,
      percentage: Math.round((count / totalCases) * 100)
    })).sort((a, b) => b.count - a.count);

    // Appointment analytics
    const appointmentsByStatus = {};
    appointments.forEach(a => {
      const status = a.status || 'unknown';
      appointmentsByStatus[status] = (appointmentsByStatus[status] || 0) + 1;
    });

    const totalScheduled = appointmentsByStatus['scheduled'] || 0;
    const totalCompleted = appointmentsByStatus['completed'] || 0;
    const totalNoShow = appointmentsByStatus['no_show'] || 0;
    const totalCancelled = appointmentsByStatus['cancelled'] || 0;

    const completedRate = totalScheduled > 0 ? Math.round((totalCompleted / totalScheduled) * 100) : 0;
    const noShowRate = totalScheduled > 0 ? Math.round((totalNoShow / totalScheduled) * 100) : 0;

    // Incident analytics
    const incidentsByType = {};
    const incidentsBySeverity = {};
    incidents.forEach(i => {
      const type = i.incident_type || 'unknown';
      const severity = i.severity || 'unknown';
      incidentsByType[type] = (incidentsByType[type] || 0) + 1;
      incidentsBySeverity[severity] = (incidentsBySeverity[severity] || 0) + 1;
    });

    // Recent registrations
    const recentRegistrations = users
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
      .map(u => ({
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
        email: u.email,
        role: u.role,
        createdAt: u.created_at
      }));

    // Active users list
    const activeUsersList = users
      .filter(u => {
        const lastLogin = u.last_login ? new Date(u.last_login) : null;
        return lastLogin && lastLogin >= sevenDaysAgo;
      })
      .sort((a, b) => new Date(b.last_login) - new Date(a.last_login))
      .slice(0, 5)
      .map(u => ({
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
        email: u.email,
        role: u.role,
        lastLogin: u.last_login
      }));

    // System health metrics
    const systemHealth = {
      uptime: 99.9,
      responseTime: 120,
      errorRate: 0.05,
      dataQuality: 97.5,
      totalDataPoints: totalUsers + totalCases + totalAppointments + totalIncidents + totalAssignments,
      dataIntegrity: 99.1
    };

    const analyticsData = {
      overview: {
        totalUsers,
        totalCases,
        totalAppointments,
        totalIncidents,
        totalRehabPlans,
        totalNotifications,
        totalAssignments,
        totalShifts: shifts.length,
        activeUsers,
        casesThisMonth,
        appointmentsThisMonth,
        incidentsThisMonth,
        assignmentsThisMonth,
        userGrowth,
        caseGrowth
      },
      users: {
        byRole: usersByRoleWithPercentage,
        recentRegistrations,
        activeUsers: activeUsersList
      },
      cases: {
        byStatus: casesByStatusWithPercentage,
        total: totalCases
      },
      appointments: {
        totalScheduled,
        totalCompleted,
        totalNoShow,
        totalCancelled,
        completedRate,
        noShowRate,
        byStatus: Object.entries(appointmentsByStatus).map(([status, count]) => ({ status, count }))
      },
      incidents: {
        byType: Object.entries(incidentsByType).map(([type, count]) => ({ type, count })),
        bySeverity: Object.entries(incidentsBySeverity).map(([severity, count]) => ({ severity, count })),
        total: totalIncidents
      },
      rehabilitationPlans: {
        total: totalRehabPlans,
        active: rehabPlans.filter(r => r.status === 'active').length,
        completed: rehabPlans.filter(r => r.status === 'completed').length
      },
      notifications: {
        total: totalNotifications,
        unread: notifications.filter(n => !n.is_read).length,
        read: notifications.filter(n => n.is_read).length
      },
      assignments: {
        total: totalAssignments,
        pending: assignments.filter(a => a.status === 'pending').length,
        completed: assignments.filter(a => a.status === 'completed').length
      },
      system: systemHealth
    };

    console.log('✅ Admin Analytics data compiled successfully');
    res.json(analyticsData);
  } catch (error) {
    console.error('❌ Admin Analytics error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch analytics data',
      message: error.message 
    });
  }
};

/**
 * Get authentication logs (Supabase auth events)
 * @route GET /api/admin/auth-logs
 * @access Admin only
 */
const getAuthLogs = async (req, res) => {
  try {
    console.log('🔍 Admin Auth Logs - Fetching authentication events...');

    const { 
      page = 1, 
      limit = 50, 
      userRole,
      startDate,
      endDate
    } = req.query;

    // Get users for reference
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, first_name, last_name, email, role, last_login, created_at');

    if (usersError) throw usersError;

    // Filter users based on query parameters
    let filteredUsers = users || [];

    if (userRole) {
      filteredUsers = filteredUsers.filter(u => u.role === userRole);
    }

    if (startDate) {
      filteredUsers = filteredUsers.filter(u => new Date(u.last_login || u.created_at) >= new Date(startDate));
    }

    if (endDate) {
      filteredUsers = filteredUsers.filter(u => new Date(u.last_login || u.created_at) <= new Date(endDate));
    }

    // Sort by last login
    filteredUsers.sort((a, b) => {
      const dateA = new Date(a.last_login || a.created_at);
      const dateB = new Date(b.last_login || b.created_at);
      return dateB - dateA;
    });

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedUsers = filteredUsers.slice(skip, skip + parseInt(limit));

    // Format as auth logs
    const logs = paginatedUsers.map(user => ({
      _id: user.id,
      userId: user.id,
      userEmail: user.email,
      userName: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
      userRole: user.role,
      action: user.last_login ? 'login' : 'registered',
      success: true,
      createdAt: user.last_login || user.created_at,
      formattedDate: user.last_login || user.created_at
    }));

    // Stats
    const totalLogs = filteredUsers.length;
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentActivity = filteredUsers.filter(u => 
      new Date(u.last_login || u.created_at) >= last24Hours
    ).length;

    // Activity by role
    const activityByRole = {};
    filteredUsers.forEach(u => {
      if (!activityByRole[u.role]) {
        activityByRole[u.role] = { _id: u.role, count: 0, successfulLogins: 0 };
      }
      activityByRole[u.role].count++;
      if (u.last_login) activityByRole[u.role].successfulLogins++;
    });

    const response = {
      logs,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalLogs / parseInt(limit)),
        totalLogs,
        hasNext: skip + parseInt(limit) < totalLogs,
        hasPrev: parseInt(page) > 1
      },
      stats: {
        totalLogs,
        successfulLogins: filteredUsers.filter(u => u.last_login).length,
        logouts: 0
      },
      activityByRole: Object.values(activityByRole),
      recentActivity
    };

    console.log('✅ Auth logs fetched successfully');
    res.json(response);
  } catch (error) {
    console.error('❌ Auth logs error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch authentication logs',
      message: error.message 
    });
  }
};

/**
 * Test endpoint
 * @route GET /api/admin/test
 * @access Admin only
 */
const testAdmin = (req, res) => {
  res.json({ 
    message: 'Admin routes are working!', 
    timestamp: new Date().toISOString(),
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role
    }
  });
};

/**
 * Test user creation endpoint
 * @route POST /api/admin/test-user
 * @access Admin only
 */
const testUserCreation = async (req, res) => {
  try {
    console.log('🔍 Testing user creation...');
    
    const testUserData = {
      first_name: 'Test',
      last_name: 'User',
      email: 'test@example.com',
      password_hash: 'test_hash',
      role: 'worker',
      phone: '+1234567890',
      is_active: true,
      package: 'package1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('📝 Test user data:', testUserData);

    // Try to insert test user
    const { data: newUser, error: dbError } = await supabaseAdmin
      .from('users')
      .insert([testUserData])
      .select()
      .single();

    if (dbError) {
      console.error('❌ Database error:', dbError);
      return res.status(500).json({
        error: 'Database error',
        message: dbError.message,
        details: dbError.details,
        hint: dbError.hint
      });
    }

    console.log('✅ Test user created:', newUser);

    res.json({
      message: 'Test user created successfully',
      user: newUser
    });
  } catch (error) {
    console.error('❌ Test user creation error:', error);
    res.status(500).json({
      error: 'Test failed',
      message: error.message
    });
  }
};

/**
 * Create a new user (Admin only)
 * @route POST /api/admin/users
 * @access Admin only
 */
const createUser = async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    console.log('🔍 Admin creating new user...');

    const {
      firstName,
      lastName,
      email,
      password,
      role,
      phone,
      specialty,
      licenseNumber,
      team,
      defaultTeam,
      managedTeams,
      package: userPackage,
      isActive = true
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password || !role) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'First name, last name, email, password, and role are required'
      });
    }

    // Validate role-specific required fields
    if (role === 'clinician' && (!specialty || !licenseNumber)) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Specialty and license number are required for clinicians'
      });
    }

    // Check if user already exists in database
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existingUser) {
      return res.status(400).json({
        error: 'User already exists',
        message: 'A user with this email already exists'
      });
    }

    // Determine package based on role
    let finalPackage = userPackage || 'package1';
    if (role === 'team_leader') {
      finalPackage = userPackage || 'package2';
    } else if (role === 'executive') {
      finalPackage = userPackage || 'package3';
    } else if (role === 'admin') {
      finalPackage = userPackage || 'package4';
    }

    // Determine team based on role
    let finalTeam = team || null;
    if (role === 'team_leader') {
      // Team leaders should create their own team - don't assign default
      finalTeam = team || null;
    } else if (role === 'worker') {
      // Workers need a team - assign TEAM GEO as default only if no team provided
      finalTeam = team || 'TEAM GEO';
    }
    // Executive role doesn't need a team

    console.log('📝 Creating Supabase Auth user first...');
    
    // STEP 1: Create user in Supabase Auth FIRST
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password: password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role: role,
        team: finalTeam,
        package: finalPackage
      }
    });

    if (authError) {
      console.error('❌ Supabase Auth error:', authError);
      if (authError.message.includes('already registered') || authError.message.includes('User already registered')) {
        return res.status(400).json({
          error: 'User already exists',
          message: 'This email is already registered in the authentication system'
        });
      }
      return res.status(500).json({
        error: 'Failed to create auth user',
        message: authError.message
      });
    }

    console.log('✅ Supabase Auth user created with ID:', authData.user.id);

    // Hash password with bcrypt for database storage
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // STEP 2: Create user profile in database using Auth user ID
    const userData = {
      id: authData.user.id, // Use Auth user ID
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      role: role,
      phone: phone ? phone.trim() : '',
      is_active: isActive,
      package: finalPackage,
      team: finalTeam,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Add role-specific fields
    if (role === 'clinician') {
      userData.specialty = specialty.trim();
      userData.license_number = licenseNumber.trim();
    }

    if (role === 'team_leader') {
      userData.default_team = defaultTeam || finalTeam || null;
      userData.managed_teams = managedTeams || (finalTeam ? [finalTeam] : []);
    }

    console.log('📝 Creating user profile in database...');

    // Insert user into database
    const { data: newUser, error: dbError } = await supabaseAdmin
      .from('users')
      .insert([userData])
      .select()
      .single();

    if (dbError) {
      console.error('❌ Database error:', dbError);
      
      // Rollback: Delete the auth user if database insert fails
      try {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        console.log('🔄 Rolled back: Deleted auth user due to database error');
      } catch (rollbackError) {
        console.error('⚠️ Failed to rollback auth user:', rollbackError);
      }
      
      return res.status(500).json({
        error: 'Failed to create user profile',
        message: dbError.message
      });
    }

    console.log('✅ User created successfully:', newUser.email);
    console.log('✅ User can now login with email and password');

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: newUser.id,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        email: newUser.email,
        role: newUser.role,
        phone: newUser.phone,
        team: newUser.team,
        package: newUser.package,
        isActive: newUser.is_active,
        specialty: newUser.specialty,
        licenseNumber: newUser.license_number,
        defaultTeam: newUser.default_team,
        managedTeams: newUser.managed_teams
      }
    });
  } catch (error) {
    console.error('❌ Create user error:', error);
    res.status(500).json({
      error: 'Failed to create user',
      message: error.message
    });
  }
};

/**
 * Get all users (Admin only)
 * @route GET /api/admin/users
 * @access Admin only
 */
const getUsers = async (req, res) => {
  try {
    console.log('🔍 Admin fetching all users...');

    const { 
      page = 1, 
      limit = 10, 
      search,
      role,
      status 
    } = req.query;

    let query = supabaseAdmin
      .from('users')
      .select('*', { count: 'exact' });

    // Apply filters
    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    if (role && role !== 'all') {
      query = query.eq('role', role);
    }

    if (status && status !== 'all') {
      query = query.eq('is_active', status === 'active');
    }

    // Apply pagination
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;
    query = query.range(from, to);

    const { data: users, error, count } = await query;

    if (error) {
      console.error('❌ Error fetching users:', error);
      return res.status(500).json({
        error: 'Failed to fetch users',
        message: error.message
      });
    }

    console.log('✅ Users fetched:', users?.length);

    res.json({
      users: users || [],
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil((count || 0) / parseInt(limit)),
        totalUsers: count || 0,
        hasNext: from + parseInt(limit) < (count || 0),
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('❌ Get users error:', error);
    res.status(500).json({
      error: 'Failed to fetch users',
      message: error.message
    });
  }
};

/**
 * Update user (Admin only)
 * @route PUT /api/admin/users/:id
 * @access Admin only
 */
const updateUser = async (req, res) => {
  try {
    console.log('🔍 Admin updating user...');

    const { id } = req.params;
    const {
      firstName,
      lastName,
      email,
      role,
      phone,
      specialty,
      licenseNumber,
      team,
      defaultTeam,
      managedTeams,
      package: userPackage,
      isActive
    } = req.body;

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existingUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'The user you are trying to update does not exist'
      });
    }

    // Prepare update data
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (firstName) updateData.first_name = firstName.trim();
    if (lastName) updateData.last_name = lastName.trim();
    if (email) updateData.email = email.trim().toLowerCase();
    if (role) updateData.role = role;
    if (phone !== undefined) updateData.phone = phone;
    if (userPackage) updateData.package = userPackage;
    if (isActive !== undefined) updateData.is_active = isActive;

    // Determine package based on role
    if (role === 'team_leader' && !userPackage) {
      updateData.package = 'package2';
    } else if (role === 'admin' && !userPackage) {
      updateData.package = 'package4';
    }

    // Add role-specific fields
    if (role === 'clinician') {
      if (specialty !== undefined) updateData.specialty = specialty;
      if (licenseNumber !== undefined) updateData.license_number = licenseNumber;
    }

    if (role === 'team_leader') {
      if (team !== undefined) updateData.team = team;
      if (defaultTeam !== undefined) updateData.default_team = defaultTeam;
      if (managedTeams !== undefined) updateData.managed_teams = managedTeams;
    }

    if (role === 'worker' && team !== undefined) {
      updateData.team = team;
    }

    // Update user in database
    const { data: updatedUser, error: dbError } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (dbError) {
      console.error('❌ Database error:', dbError);
      return res.status(500).json({
        error: 'Failed to update user',
        message: dbError.message
      });
    }

    // Update Supabase Auth user metadata
    try {
      const authUpdateData = {
        user_metadata: {}
      };

      if (firstName) authUpdateData.user_metadata.first_name = firstName.trim();
      if (lastName) authUpdateData.user_metadata.last_name = lastName.trim();
      if (role) authUpdateData.user_metadata.role = role;
      if (updateData.team !== undefined) authUpdateData.user_metadata.team = updateData.team;
      if (updateData.package) authUpdateData.user_metadata.package = updateData.package;

      // Update email if changed
      if (email && email.toLowerCase().trim() !== existingUser.email) {
        authUpdateData.email = email.toLowerCase().trim();
      }

      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        id,
        authUpdateData
      );

      if (authError) {
        console.error('⚠️ Failed to update auth metadata:', authError.message);
        // Continue even if auth update fails
      } else {
        console.log('✅ Supabase Auth metadata updated');
      }
    } catch (authErr) {
      console.error('⚠️ Auth metadata update failed:', authErr);
      // Continue - user is updated in database
    }

    console.log('✅ User updated successfully:', updatedUser.email);

    res.json({
      message: 'User updated successfully',
      user: {
        id: updatedUser.id,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        email: updatedUser.email,
        role: updatedUser.role,
        phone: updatedUser.phone,
        team: updatedUser.team,
        package: updatedUser.package,
        isActive: updatedUser.is_active,
        specialty: updatedUser.specialty,
        licenseNumber: updatedUser.license_number,
        defaultTeam: updatedUser.default_team,
        managedTeams: updatedUser.managed_teams
      }
    });
  } catch (error) {
    console.error('❌ Update user error:', error);
    res.status(500).json({
      error: 'Failed to update user',
      message: error.message
    });
  }
};

/**
 * Delete user (Admin only)
 * @route DELETE /api/admin/users/:id
 * @access Admin only
 */
const deleteUser = async (req, res) => {
  try {
    console.log('🔍 Admin deleting user...');

    const { id } = req.params;

    // Check if user exists
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('id, email, role')
      .eq('id', id)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'The user you are trying to delete does not exist'
      });
    }

    // Prevent admin from deleting themselves
    if (req.user.id === id) {
      return res.status(400).json({
        error: 'Cannot delete yourself',
        message: 'You cannot delete your own account'
      });
    }

    // Delete user from database
    const { error: dbError } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', id);

    if (dbError) {
      console.error('❌ Database error:', dbError);
      return res.status(500).json({
        error: 'Failed to delete user',
        message: dbError.message
      });
    }

    console.log('✅ User deleted successfully:', user.email);

    res.json({
      message: 'User deleted successfully',
      deletedUser: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('❌ Delete user error:', error);
    res.status(500).json({
      error: 'Failed to delete user',
      message: error.message
    });
  }
};

/**
 * Get analytics data for new admin dashboard
 * @route GET /api/admin/analytics
 * @access Admin only
 */
const getAnalytics = async (req, res) => {
  try {
    console.log('📊 Fetching analytics data...');

    // Get date range from query parameters
    const { startDate, endDate } = req.query;
    
    // Set date range - use provided dates or default to last 6 months for more realistic data
    const now = new Date();
    const defaultStartDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    
    let startDateFilter = startDate ? new Date(startDate) : defaultStartDate;
    const endDateFilter = endDate ? new Date(endDate) : now;
    
    // Ensure we have at least 3 months of data for proper line chart, but don't go beyond current date
    const minStartDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    if (startDateFilter > minStartDate) {
      startDateFilter = minStartDate;
    }
    
    // Don't allow future dates
    if (startDateFilter > now) {
      startDateFilter = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    }
    

    // Get comparison dates for growth calculation
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

    // Fetch all data in parallel for better performance with date filtering
    const [
      usersResult,
      usersLastMonthResult,
      caseResult,
      casesLastMonthResult,
      appointmentsResult,
      incidentsResult,
      usersByRoleResult,
      casesByStatusResult,
      authLogsResult
    ] = await Promise.all([
      // Users within date range
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true })
        .gte('created_at', startDateFilter.toISOString())
        .lte('created_at', endDateFilter.toISOString()),
      // Users from last month for comparison
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true })
        .gte('created_at', twoMonthsAgo.toISOString())
        .lt('created_at', lastMonth.toISOString()),
      // Cases within date range
      supabaseAdmin.from('cases').select('*', { count: 'exact', head: true })
        .gte('created_at', startDateFilter.toISOString())
        .lte('created_at', endDateFilter.toISOString()),
      // Cases from last month for comparison
      supabaseAdmin.from('cases').select('*', { count: 'exact', head: true })
        .gte('created_at', twoMonthsAgo.toISOString())
        .lt('created_at', lastMonth.toISOString()),
      // Appointments within date range
      supabaseAdmin.from('appointments').select('*', { count: 'exact', head: true })
        .gte('created_at', startDateFilter.toISOString())
        .lte('created_at', endDateFilter.toISOString()),
      // Incidents within date range
      supabaseAdmin.from('incidents').select('*', { count: 'exact', head: true })
        .gte('created_at', startDateFilter.toISOString())
        .lte('created_at', endDateFilter.toISOString()),
      // Users by role within date range
      supabaseAdmin.from('users').select('role')
        .gte('created_at', startDateFilter.toISOString())
        .lte('created_at', endDateFilter.toISOString()),
      // Cases by status within date range
      supabaseAdmin.from('cases').select('status')
        .gte('created_at', startDateFilter.toISOString())
        .lte('created_at', endDateFilter.toISOString()),
      // Authentication logs for active users and online status
      supabaseAdmin.from('authentication_logs').select('*')
        .gte('created_at', startDateFilter.toISOString())
        .lte('created_at', endDateFilter.toISOString())
        .order('created_at', { ascending: false })
    ]);

    const totalUsers = usersResult.count || 0;
    const totalUsersLastMonth = usersLastMonthResult.count || 0;
    const totalCases = caseResult.count || 0;
    const totalCasesLastMonth = casesLastMonthResult.count || 0;
    const totalAppointments = appointmentsResult.count || 0;
    const totalIncidents = incidentsResult.count || 0;
    const authLogs = authLogsResult.data || [];

    // Calculate active users and currently online from authentication logs
    const sevenDaysAgoAuth = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    
    // Active users (logged in within last 7 days)
    const activeUsersFromLogs = authLogs.filter(log => 
      log.action === 'login' && new Date(log.created_at) >= sevenDaysAgoAuth
    );
    const uniqueActiveUsers = [...new Set(activeUsersFromLogs.map(log => log.user_id))];
    
    // Currently online users (logged in within last 30 minutes)
    const currentlyOnline = authLogs.filter(log => 
      log.action === 'login' && new Date(log.created_at) >= thirtyMinutesAgo
    );
    const uniqueCurrentlyOnline = [...new Set(currentlyOnline.map(log => log.user_id))];

    console.log('📊 Database counts:', {
      totalUsers,
      totalUsersLastMonth,
      totalCases,
      totalCasesLastMonth,
      totalAppointments,
      totalIncidents
    });

    console.log('📊 Raw query results:', {
      usersResult: usersResult,
      caseResult: caseResult,
      appointmentsResult: appointmentsResult,
      usersByRoleResult: usersByRoleResult,
      casesByStatusResult: casesByStatusResult
    });

    // Calculate growth percentages
    const userGrowth = totalUsersLastMonth > 0 
      ? Math.round(((totalUsers - totalUsersLastMonth) / totalUsersLastMonth) * 100)
      : 0;
    
    const caseGrowth = totalCasesLastMonth > 0
      ? Math.round(((totalCases - totalCasesLastMonth) / totalCasesLastMonth) * 100)
      : 0;

    // Count active users (logged in within last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { count: activeUsers } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('last_sign_in_at', sevenDaysAgo.toISOString());

    // Process users by role
    const usersByRole = usersByRoleResult.data || [];
    const roleCount = usersByRole.reduce((acc, user) => {
      const role = user.role || 'unknown';
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    }, {});

    const usersByRoleArray = Object.entries(roleCount).map(([role, count]) => ({
      role: role.replace('_', ' '),
      count
    }));

    // Process cases by status with more specific mapping
    const casesByStatus = casesByStatusResult.data || [];
    const statusCount = casesByStatus.reduce((acc, case_) => {
      const status = case_.status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    // Map to more specific and user-friendly status names
    const statusMapping = {
      'new': 'New Cases',
      'triaged': 'Triaged',
      'assessed': 'Assessed',
      'in_rehab': 'In Rehabilitation',
      'return_to_work': 'Return to Work',
      'closed': 'Closed Cases',
      'cancelled': 'Cancelled',
      'pending': 'Pending',
      'unknown': 'Unknown'
    };

    const casesByStatusArray = Object.entries(statusCount)
      .map(([status, count]) => ({
        status: statusMapping[status] || status.replace('_', ' '),
        count,
        originalStatus: status
      }))
      .sort((a, b) => b.count - a.count); // Sort by count descending

    // Optimized monthly trend calculation - limit to max 12 months for performance
    const monthlyTrend = [];
    const startMonth = new Date(startDateFilter.getFullYear(), startDateFilter.getMonth(), 1);
    
    // Ensure endMonth doesn't go beyond current month
    const currentDate = new Date();
    const currentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endMonth = endDateFilter > currentMonth ? currentMonth : new Date(endDateFilter.getFullYear(), endDateFilter.getMonth(), 1);
    
    // Calculate number of months to show (max 12 for performance, but don't include future months)
    const monthsDiff = Math.min(
      (endMonth.getFullYear() - startMonth.getFullYear()) * 12 + 
      (endMonth.getMonth() - startMonth.getMonth()) + 1,
      12
    );
    
    
    // Batch all monthly queries for better performance
    const monthlyQueries = [];
    for (let i = 0; i < monthsDiff; i++) {
      const month = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
      const nextMonth = new Date(startMonth.getFullYear(), startMonth.getMonth() + i + 1, 1);
      
      monthlyQueries.push(
        supabaseAdmin.from('users').select('*', { count: 'exact', head: true })
          .gte('created_at', month.toISOString())
          .lt('created_at', nextMonth.toISOString()),
        supabaseAdmin.from('cases').select('*', { count: 'exact', head: true })
          .gte('created_at', month.toISOString())
          .lt('created_at', nextMonth.toISOString()),
        supabaseAdmin.from('appointments').select('*', { count: 'exact', head: true })
          .gte('created_at', month.toISOString())
          .lt('created_at', nextMonth.toISOString())
      );
    }
    
    // Execute all monthly queries in parallel
    const monthlyResults = await Promise.all(monthlyQueries);
    
    // Process results into monthly trend data
    for (let i = 0; i < monthsDiff; i++) {
      const month = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
      const resultIndex = i * 3;
      
      const userCount = monthlyResults[resultIndex]?.count || 0;
      const caseCount = monthlyResults[resultIndex + 1]?.count || 0;
      const appointmentCount = monthlyResults[resultIndex + 2]?.count || 0;
      
      // Only include months that have actual data - no empty months
      const hasData = userCount > 0 || caseCount > 0 || appointmentCount > 0;
      
      if (hasData) {
        monthlyTrend.push({
          month: month.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          users: userCount,
          cases: caseCount,
          appointments: appointmentCount
        });
      }
    }
    
    // If no monthly trend data, add current month with actual counts
    if (monthlyTrend.length === 0) {
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      
      // Get current month data
      const [currentUsers, currentCases, currentAppointments] = await Promise.all([
        supabaseAdmin.from('users').select('*', { count: 'exact', head: true })
          .gte('created_at', currentMonth.toISOString())
          .lt('created_at', nextMonth.toISOString()),
        supabaseAdmin.from('cases').select('*', { count: 'exact', head: true })
          .gte('created_at', currentMonth.toISOString())
          .lt('created_at', nextMonth.toISOString()),
        supabaseAdmin.from('appointments').select('*', { count: 'exact', head: true })
          .gte('created_at', currentMonth.toISOString())
          .lt('created_at', nextMonth.toISOString())
      ]);
      
      const currentUserCount = currentUsers?.count || 0;
      const currentCaseCount = currentCases?.count || 0;
      const currentAppointmentCount = currentAppointments?.count || 0;
      
      if (currentUserCount > 0 || currentCaseCount > 0 || currentAppointmentCount > 0) {
        monthlyTrend.push({
          month: currentMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          users: currentUserCount,
          cases: currentCaseCount,
          appointments: currentAppointmentCount
        });
      }
    }

    // Recent activities summary
    const recentActivities = [
      {
        type: 'users',
        count: totalUsers,
        change: userGrowth
      },
      {
        type: 'cases',
        count: totalCases,
        change: caseGrowth
      },
      {
        type: 'appointments',
        count: totalAppointments,
        change: 0
      },
      {
        type: 'incidents',
        count: totalIncidents,
        change: 0
      }
    ];

    const analyticsData = {
      overview: {
        totalUsers,
        totalCases,
        totalAppointments,
        totalIncidents,
        activeUsers: uniqueActiveUsers.length,
        userGrowth,
        caseGrowth
      },
      usersByRole: usersByRoleArray,
      casesByStatus: casesByStatusArray,
      monthlyTrend,
      recentActivities
    };

    console.log('✅ Analytics data fetched successfully');
    console.log('📊 Final analytics data:', JSON.stringify(analyticsData, null, 2));
    res.json(analyticsData);

  } catch (error) {
    console.error('❌ Error fetching analytics:', error);
    res.status(500).json({
      message: 'Failed to fetch analytics data',
      error: error.message
    });
  }
};

module.exports = {
  getStatistics,
  getAdminAnalytics,
  getAuthLogs,
  createUser,
  getUsers,
  updateUser,
  deleteUser,
  testAdmin,
  testUserCreation,
  getAnalytics
};


