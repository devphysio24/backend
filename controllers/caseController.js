// Supabase-only implementation - MongoDB fallbacks removed
const { db, supabase } = require('../config/supabase.local');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const AutoAssignmentService = require('../services/AutoAssignmentService');

// @desc    Get cases assigned to the current user
// @route   GET /api/cases/my-cases
// @access  Private
const getMyCases = async (req, res) => {
  try {
    console.log('Fetching cases for user:', {
      userId: req.user._id,
      userRole: req.user.role
    });

    let filter = {};
    let populateFields = [
      { path: 'worker', select: 'firstName lastName email phone' },
      { path: 'employer', select: 'firstName lastName email phone' },
      { path: 'caseManager', select: 'firstName lastName email phone' },
      { path: 'clinician', select: 'firstName lastName email phone' },
      { path: 'incident', select: 'incidentNumber incidentDate description incidentType severity photos' }
    ];
    
    // Build filter based on user role
    switch (req.user.role) {
      case 'clinician':
        // Try both ways of matching clinician
        filter = {
          $or: [
            { clinician: req.user._id },
            { 'clinician._id': req.user._id }
          ]
        };
        break;
      case 'case_manager':
        filter.caseManager = req.user._id;
        break;
      case 'worker':
        filter.worker = req.user._id;
        break;
      case 'employer':
        filter.employer = req.user._id;
        break;
      case 'admin':
      case 'gp_insurer':
        // No filter needed - they can see all cases
        break;
      default:
        return res.status(400).json({ 
          message: 'Invalid user role for this endpoint',
          role: req.user.role 
        });
    }

    console.log('Applying filter:', {
      filter,
      userRole: req.user.role,
      userId: req.user._id
    });

    // First try to find cases with the filter
    let cases = await Case.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 });

    // If no cases found for clinician, try alternative query
    if (cases.length === 0 && req.user.role === 'clinician') {
      console.log('No cases found with primary filter, trying alternative query');
      
      // Try finding by raw clinician ID
      cases = await Case.find({
        clinician: req.user._id.toString()
      }).populate(populateFields)
        .sort({ createdAt: -1 });
        
      console.log('Alternative query results:', {
        found: cases.length,
        clinicianId: req.user._id.toString()
      });
    }

    console.log('Query results:', {
      userRole: req.user.role,
      casesFound: cases.length,
      filter: filter
    });

    res.json({
      success: true,
      count: cases.length,
      cases: cases.map(c => ({
        ...c.toObject(),
        canAccess: true // Flag to indicate user has access
      }))
    });
  } catch (error) {
    console.error('Error fetching user cases:', {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      userRole: req.user.role
    });
    
    res.status(500).json({
      message: 'Error fetching cases',
      error: error.message,
      details: {
        userId: req.user._id,
        userRole: req.user.role,
        errorType: error.name
      }
    });
  }
};

// @desc    Get all cases (with filtering and pagination)
// @route   GET /api/cases
// @access  Private
const getCases = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  
  console.log('Cases API called by user role:', req.user.role);
  
  const filter = {};
  
  // Role-based filtering
  switch (req.user.role) {
    case 'worker':
      filter.worker = req.user._id;
      console.log('Worker filter applied');
      break;
    case 'employer':
      filter.employer = req.user._id;
      break;
    case 'clinician':
      filter.clinician = req.user._id;
      break;
    case 'case_manager':
      filter.caseManager = req.user._id;
      break;
    case 'site_supervisor':
      // Site supervisors can see cases from their employer (if assigned) or all cases if not assigned
      if (req.user.employer) {
        const employer = await User.findById(req.user.employer);
        if (employer) {
          filter.employer = employer._id;
        }
      }
      // If no employer assigned, site supervisor can see all cases
      break;
    // Admin and GP/Insurer can see all cases
  }
  
  if (req.query.status) {
    filter.status = req.query.status;
  }
  
  if (req.query.priority) {
    filter.priority = req.query.priority;
  }
  
  if (req.query.search) {
    filter.$or = [
      { caseNumber: { $regex: req.query.search, $options: 'i' } },
      { 'injuryDetails.description': { $regex: req.query.search, $options: 'i' } }
    ];
  }

  console.log('Query filter applied');
  
  const cases = await Case.find(filter)
    .populate('worker', 'firstName lastName email phone')
    .populate('employer', 'firstName lastName email phone')
    .populate('caseManager', 'firstName lastName email phone')
    .populate('clinician', 'firstName lastName email phone')
    .populate('incident', 'incidentNumber incidentDate description incidentType severity photos')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
    
  console.log('Found cases:', cases.length);

  const total = await Case.countDocuments(filter);

  res.json({
    cases,
    pagination: {
      current: page,
      pages: Math.ceil(total / limit),
      total
    }
  });
};

// @desc    Get case by ID
// @route   GET /api/cases/:id
// @access  Private
const getCaseById = async (req, res) => {
  console.log(`Fetching case ${req.params.id} for user ${req.user._id} (${req.user.role})`);
  
  let caseDoc;
  try {
    // First try to find the case
    caseDoc = await Case.findById(req.params.id)
    .populate('worker', 'firstName lastName email phone address')
    .populate('employer', 'firstName lastName email phone')
    .populate('caseManager', 'firstName lastName email phone')
    .populate('clinician', 'firstName lastName email phone')
    .populate('incident', 'incidentNumber incidentDate description incidentType severity photos');
      
    console.log('Case fetch result:', {
      found: !!caseDoc,
      caseId: req.params.id,
      hasClinicianAssigned: !!caseDoc?.clinician,
      userRole: req.user.role,
      userId: req.user._id
    });

    // If case not found, return 404
    if (!caseDoc) {
      return res.status(404).json({ 
        message: 'Case not found',
        caseId: req.params.id
      });
    }

    // Check access based on role
    let hasAccess = false;
    switch (req.user.role) {
      case 'admin':
      case 'gp_insurer':
        hasAccess = true;
        break;
      case 'clinician':
        // Handle both populated and unpopulated clinician field
        if (caseDoc.clinician) {
          // If clinician is a populated object
          if (typeof caseDoc.clinician === 'object' && caseDoc.clinician._id) {
            hasAccess = caseDoc.clinician._id.toString() === req.user._id.toString();
          } 
          // If clinician is just an ID
          else {
            hasAccess = caseDoc.clinician.toString() === req.user._id.toString();
          }
          console.log('Clinician access check:', {
            userId: req.user._id.toString(),
            clinicianId: typeof caseDoc.clinician === 'object' ? 
              caseDoc.clinician._id.toString() : caseDoc.clinician.toString(),
            hasAccess
          });
        }
        break;
      case 'case_manager':
        // Handle both populated and unpopulated case manager field
        if (caseDoc.caseManager) {
          // If case manager is a populated object
          if (typeof caseDoc.caseManager === 'object' && caseDoc.caseManager._id) {
            hasAccess = caseDoc.caseManager._id.toString() === req.user._id.toString();
          } 
          // If case manager is just an ID
          else {
            hasAccess = caseDoc.caseManager.toString() === req.user._id.toString();
          }
          console.log('Case manager access check:', {
            userId: req.user._id.toString(),
            caseManagerId: typeof caseDoc.caseManager === 'object' ? 
              caseDoc.caseManager._id.toString() : caseDoc.caseManager.toString(),
            hasAccess
          });
        }
        break;
      case 'worker':
        // Handle both populated and unpopulated worker field
        if (caseDoc.worker) {
          // If worker is a populated object
          if (typeof caseDoc.worker === 'object' && caseDoc.worker._id) {
            hasAccess = caseDoc.worker._id.toString() === req.user._id.toString();
          } 
          // If worker is just an ID
          else {
            hasAccess = caseDoc.worker.toString() === req.user._id.toString();
          }
          console.log('Worker access check:', {
            userId: req.user._id.toString(),
            workerId: typeof caseDoc.worker === 'object' ? 
              caseDoc.worker._id.toString() : caseDoc.worker.toString(),
            hasAccess
          });
        }
        break;
      case 'employer':
        // Handle both populated and unpopulated employer field
        if (caseDoc.employer) {
          // If employer is a populated object
          if (typeof caseDoc.employer === 'object' && caseDoc.employer._id) {
            hasAccess = caseDoc.employer._id.toString() === req.user._id.toString();
          } 
          // If employer is just an ID
          else {
            hasAccess = caseDoc.employer.toString() === req.user._id.toString();
          }
          console.log('Employer access check:', {
            userId: req.user._id.toString(),
            employerId: typeof caseDoc.employer === 'object' ? 
              caseDoc.employer._id.toString() : caseDoc.employer.toString(),
            hasAccess
          });
        }
        break;
      case 'site_supervisor':
        // Handle site supervisor access (can see cases for their employer)
        if (req.user.employer) {
          if (caseDoc.employer) {
            // If employer is a populated object
            if (typeof caseDoc.employer === 'object' && caseDoc.employer._id) {
              hasAccess = caseDoc.employer._id.toString() === req.user.employer.toString();
            } 
            // If employer is just an ID
            else {
              hasAccess = caseDoc.employer.toString() === req.user.employer.toString();
            }
          }
        } else {
          // Site supervisors without an assigned employer can see all cases
          hasAccess = true;
        }
        
        console.log('Site supervisor access check:', {
          userEmployerId: req.user.employer ? req.user.employer.toString() : 'none',
          caseEmployerId: caseDoc.employer ? 
            (typeof caseDoc.employer === 'object' ? 
              caseDoc.employer._id.toString() : caseDoc.employer.toString()) : 'none',
          hasAccess
        });
        break;
    }

    console.log('Access check:', {
      hasAccess,
      userRole: req.user.role,
      userId: req.user._id,
      caseId: caseDoc._id
    });

    if (!hasAccess) {
      // Log detailed information about the access denial
      console.error('Access denied to case:', {
        userId: req.user._id,
        userRole: req.user.role,
        caseId: caseDoc._id,
        caseNumber: caseDoc.caseNumber,
        caseStatus: caseDoc.status,
        caseClinician: caseDoc.clinician ? 
          (typeof caseDoc.clinician === 'object' ? 
            caseDoc.clinician._id.toString() : caseDoc.clinician.toString()) : 'none',
        caseCaseManager: caseDoc.caseManager ? 
          (typeof caseDoc.caseManager === 'object' ? 
            caseDoc.caseManager._id.toString() : caseDoc.caseManager.toString()) : 'none',
        caseWorker: caseDoc.worker ? 
          (typeof caseDoc.worker === 'object' ? 
            caseDoc.worker._id.toString() : caseDoc.worker.toString()) : 'none',
        caseEmployer: caseDoc.employer ? 
          (typeof caseDoc.employer === 'object' ? 
            caseDoc.employer._id.toString() : caseDoc.employer.toString()) : 'none'
      });
      
      return res.status(403).json({
        message: 'Access denied',
        details: {
          userRole: req.user.role,
          caseId: caseDoc._id,
          reason: `You do not have permission to view this case. If you believe this is an error, please contact your administrator.`
        }
      });
    }

    // Return the case with the expected format
    res.json({ case: caseDoc });
  } catch (error) {
    console.error('Error fetching case:', {
      error: error.message,
      stack: error.stack,
      caseId: req.params.id,
      userId: req.user._id,
      userRole: req.user.role
    });
    
    // Diagnostic block referencing MongoDB removed (Supabase-only)
    
    return res.status(500).json({ 
      message: 'Error fetching case details',
      error: error.message,
      details: {
        caseId: req.params.id,
        errorType: error.name,
        timestamp: new Date().toISOString()
      }
    });
  }
};

// @desc    Get team leaders with active cases (for Site Supervisor)
// @route   GET /api/cases/teams-with-cases
// @access  Private (Site Supervisor only)
const getTeamsWithCases = async (req, res) => {
  try {
    logger.info('Fetching teams with active cases', {
      userId: req.user?._id || req.user?.id,
      userRole: req.user?.role
    });

    // Verify site supervisor role
    if (req.user?.role !== 'site_supervisor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Site supervisors only.'
      });
    }

    // Query Supabase for cases grouped by team leader
    const { data: cases, error } = await supabase
      .from('cases')
      .select(`
        id,
        worker_id,
        status,
        users!cases_worker_id_fkey (
          id,
          team_leader_id,
          team,
          users!users_team_leader_id_fkey (
            id,
            first_name,
            last_name,
            team
          )
        )
      `)
      .in('status', ['open', 'in_progress', 'monitoring']);

    if (error) {
      logger.error('Error fetching cases from Supabase:', error);
      throw error;
    }

    // Group cases by team leader
    const teamLeaderMap = new Map();
    
    cases?.forEach(caseItem => {
      const worker = caseItem.users;
      if (!worker || !worker.users) return;
      
      const teamLeader = worker.users;
      const teamLeaderId = teamLeader.id;
      
      if (!teamLeaderMap.has(teamLeaderId)) {
        teamLeaderMap.set(teamLeaderId, {
          teamLeaderId: teamLeaderId,
          teamLeaderName: `${teamLeader.first_name} ${teamLeader.last_name}`,
          teamName: teamLeader.team || 'Unassigned',
          activeCases: 0,
          workerIds: new Set()
        });
      }
      
      const teamData = teamLeaderMap.get(teamLeaderId);
      teamData.activeCases++;
      teamData.workerIds.add(worker.id);
    });

    // Convert to array and format
    const teams = Array.from(teamLeaderMap.values()).map(team => ({
      teamLeaderId: team.teamLeaderId,
      teamName: team.teamName,
      teamLeader: {
        id: team.teamLeaderId,
        name: team.teamLeaderName
      },
      totalMembers: team.workerIds.size,
      activeCases: team.activeCases
    }));

    logger.info('Teams with cases fetched successfully', {
      teamsCount: teams.length,
      totalActiveCases: cases?.length || 0
    });

    res.json({
      success: true,
      count: teams.length,
      teams
    });

  } catch (error) {
    logger.error('Error in getTeamsWithCases:', {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id || req.user?.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to fetch teams with cases',
      error: error.message
    });
  }
};

module.exports = {
  getMyCases,
  getCases,
  getCaseById,
  getTeamsWithCases
};
