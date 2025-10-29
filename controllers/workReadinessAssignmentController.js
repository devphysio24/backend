const { createClient } = require('@supabase/supabase-js');
const NotificationService = require('../services/NotificationService.supabase');
const logger = require('../utils/logger');

// Helper function to get timezone-specific date
const getTimezoneDate = (timezone = 'PH') => {
  const now = new Date();
  let offset;
  
  switch (timezone) {
    case 'PH':
      offset = 8 * 60; // UTC+8
      break;
    case 'AU':
      offset = 10 * 60; // UTC+10
      break;
    default:
      offset = 8 * 60; // Default to PH time
  }
  
  const timezoneTime = new Date(now.getTime() + (offset * 60 * 1000));
  return timezoneTime.toISOString().split('T')[0];
};

/**
 * Validate UUID format
 * @param {string} id - UUID to validate
 * @returns {boolean} True if valid UUID
 */
function validateUUID(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validate shift time format (HH:MM:SS)
 * @param {string} timeStr - Time string to validate
 * @returns {boolean} True if valid time format
 */
function validateShiftTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return false;
  const timeRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/;
  return timeRegex.test(timeStr);
}

/**
 * Create fallback deadline (24 hours from now)
 * @param {string} reason - Reason for fallback
 * @returns {object} Fallback deadline object
 */
function createFallbackDeadline(reason) {
  const fallbackDueTime = new Date();
  fallbackDueTime.setHours(fallbackDueTime.getHours() + 24);
  return {
    dueDateTime: fallbackDueTime,
    shiftInfo: null,
    fallbackReason: reason
  };
}

/**
 * Get team leader's next shift start time
 * @param {string} teamLeaderId - Team leader ID
 * @returns {Promise<{nextShiftStart: Date, shiftInfo: object}>} Next shift start time and shift info
 */
async function getNextShiftStartTime(teamLeaderId) {
  const startTime = Date.now();
  
  try {
    // Validate input
    if (!validateUUID(teamLeaderId)) {
      logger.error('Invalid team leader ID format', { teamLeaderId });
      return { nextShiftStart: null, shiftInfo: null, error: 'Invalid team leader ID' };
    }

    // Get team leader's current active shift with timeout
    const { data: currentShift, error: shiftError } = await Promise.race([
      supabaseAdmin.rpc('get_current_shift', { team_leader_uuid: teamLeaderId }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Shift fetch timeout')), 5000)
      )
    ]);

    if (shiftError) {
      logger.warn('Error fetching team leader shift', { 
        teamLeaderId, 
        error: shiftError.message 
      });
      return { nextShiftStart: null, shiftInfo: null, error: 'Shift fetch failed' };
    }

    if (!currentShift || currentShift.length === 0) {
      logger.info('No active shift assigned', { teamLeaderId });
      return { nextShiftStart: null, shiftInfo: null, error: 'No active shift assigned' };
    }

    const shift = currentShift[0];
    
    // Validate shift times
    if (!validateShiftTime(shift.start_time) || !validateShiftTime(shift.end_time)) {
      logger.error('Invalid shift time format', { 
        shift_id: shift.shift_id,
        start_time: shift.start_time,
        end_time: shift.end_time 
      });
      return { nextShiftStart: null, shiftInfo: null, error: 'Invalid shift time format' };
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Parse shift times
    const [startHour, startMinute] = shift.start_time.split(':').map(Number);
    const [endHour, endMinute] = shift.end_time.split(':').map(Number);
    
    // Calculate next shift start time (Manila time)
    const nextShiftStart = new Date(today);
    // Set the time directly (no timezone conversion needed)
    nextShiftStart.setHours(startHour, startMinute, 0, 0);
    
    // If shift crosses midnight (end time is earlier than start time)
    if (endHour < startHour) {
      // If current time is past shift end, next shift starts tomorrow
      const shiftEndToday = new Date(today);
      shiftEndToday.setHours(endHour, endMinute, 0, 0);
      shiftEndToday.setDate(shiftEndToday.getDate() + 1); // Cross midnight
      
      if (now > shiftEndToday) {
        nextShiftStart.setDate(nextShiftStart.getDate() + 1);
      }
    } else {
      // Regular shift - if current time is past shift end, next shift starts tomorrow
      const shiftEndToday = new Date(today);
      shiftEndToday.setHours(endHour, endMinute, 0, 0);
      
      if (now > shiftEndToday) {
        nextShiftStart.setDate(nextShiftStart.getDate() + 1);
      }
    }

    // Log performance
    const duration = Date.now() - startTime;
    logger.info('Next shift start time calculated', {
      teamLeaderId,
      duration,
      nextShiftStart: nextShiftStart.toISOString(),
      shiftName: shift.shift_name
    });

    if (duration > 1000) {
      logger.warn('Slow next shift calculation', { teamLeaderId, duration });
    }

    return {
      nextShiftStart,
      shiftInfo: shift,
      error: null
    };

  } catch (error) {
    logger.error('Error calculating next shift start time', { 
      teamLeaderId, 
      error: error.message,
      stack: error.stack 
    });
    return { nextShiftStart: null, shiftInfo: null, error: 'System error' };
  }
}

/**
 * Get team leader's current shift and calculate deadline based on shift times
 * @param {string} teamLeaderId - Team leader ID
 * @param {string} assignedDate - The date the assignment is being created for
 * @returns {Promise<{dueDateTime: Date, shiftInfo: object}>} Deadline and shift info
 */
async function calculateShiftBasedDeadline(teamLeaderId, assignedDate) {
  const startTime = Date.now();
  
  try {
    // Validate input
    if (!validateUUID(teamLeaderId)) {
      logger.error('Invalid team leader ID format', { teamLeaderId });
      return createFallbackDeadline('Invalid team leader ID');
    }

    // Get team leader's current active shift with timeout
    const { data: currentShift, error: shiftError } = await Promise.race([
      supabaseAdmin.rpc('get_current_shift', { team_leader_uuid: teamLeaderId }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Shift fetch timeout')), 5000)
      )
    ]);

    if (shiftError) {
      logger.warn('Error fetching team leader shift', { 
        teamLeaderId, 
        error: shiftError.message 
      });
      return createFallbackDeadline('Shift fetch failed');
    }

    if (!currentShift || currentShift.length === 0) {
      logger.info('No active shift assigned', { teamLeaderId });
      return createFallbackDeadline('No active shift assigned');
    }

    const shift = currentShift[0];
    
    // Validate shift times
    if (!validateShiftTime(shift.start_time) || !validateShiftTime(shift.end_time)) {
      logger.error('Invalid shift time format', { 
        shift_id: shift.shift_id,
        start_time: shift.start_time,
        end_time: shift.end_time 
      });
      return createFallbackDeadline('Invalid shift time format');
    }

    const now = new Date();
    const assignmentDate = new Date(assignedDate);
    
    // Parse shift times
    const [startHour, startMinute] = shift.start_time.split(':').map(Number);
    const [endHour, endMinute] = shift.end_time.split(':').map(Number);
    
    // Calculate shift end time for the assignment date (Manila time)
    const shiftEndDate = new Date(assignmentDate);
    
    // Convert Manila time to UTC (Manila is UTC+8)
    // Manila time 14:00 = UTC 06:00 (subtract 8 hours)
    let utcHour = endHour - 8;
    let utcDate = shiftEndDate.getUTCDate();
    
    // Handle negative hours after UTC conversion
    if (utcHour < 0) {
      utcHour += 24;
      utcDate += 1;
    }
    
    // For shifts that cross midnight, the due time is still on the same day
    // Night Shift (20:00-05:00): Due at 05:00 Manila = 21:00 UTC same day
    // Evening Shift (22:00-06:00): Due at 06:00 Manila = 22:00 UTC same day
    // No need to add extra day for midnight-crossing shifts
    
    // Set the calculated UTC time
    shiftEndDate.setUTCDate(utcDate);
    shiftEndDate.setUTCHours(utcHour, endMinute, 0, 0);
    
    let result;
    // Always use the end of the shift on the assignment date as deadline
    // This ensures assignments are due at the end of the team leader's shift on the assignment date
    result = {
      dueDateTime: shiftEndDate,
      shiftInfo: shift,
      deadlineType: 'assignment_date_shift_end'
    };

    // Log performance
    const duration = Date.now() - startTime;
    logger.info('Shift-based deadline calculated', {
      teamLeaderId,
      duration,
      deadlineType: result.deadlineType,
      shiftName: shift.shift_name
    });

    if (duration > 1000) {
      logger.warn('Slow deadline calculation', { teamLeaderId, duration });
    }

    return result;

  } catch (error) {
    logger.error('Error calculating shift-based deadline', { 
      teamLeaderId, 
      error: error.message,
      stack: error.stack 
    });
    return createFallbackDeadline('System error');
  }
}

// Initialize Supabase Admin Client - NO FALLBACK SECRETS
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate required environment variables
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ CRITICAL: Missing Supabase configuration in environment variables');
  console.error('Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Create work readiness assignments
 * POST /api/work-readiness-assignments
 */
exports.createAssignments = async (req, res) => {
  try {
    const { workerIds, assignedDate, team, notes, dueTime, unselectedWorkers } = req.body;
    const teamLeaderId = req.user.id;

    req.logger.logBusiness('Creating assignments', { workerIds, assignedDate, team, teamLeaderId });

    // Validation is handled by middleware - no need to duplicate here

    // Check if user is a team leader
    if (req.user.role !== 'team_leader' && req.user.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Only team leaders can create assignments' 
      });
    }

    // Verify that workers belong to the team leader's team
    const { data: workers, error: workersError } = await supabaseAdmin
      .from('users')
      .select('id, team, team_leader_id')
      .in('id', workerIds)
      .eq('role', 'worker');

    if (workersError) {
      req.logger.error(workersError, { context: 'createAssignments', userId: req.user.id });
      return res.status(500).json({ success: false, error: 'Failed to verify workers' });
    }

    // Check if all workers belong to the team leader
    const invalidWorkers = workers.filter(
      w => w.team !== team || (w.team_leader_id && w.team_leader_id !== teamLeaderId)
    );

    if (invalidWorkers.length > 0) {
      return res.status(403).json({ 
        error: 'Some workers do not belong to your team',
        invalidWorkers: invalidWorkers.map(w => w.id)
      });
    }

    // Check for ALL assignments across ALL dates for selected workers
    const { data: allAssignments, error: assignmentsError } = await supabaseAdmin
      .from('work_readiness_assignments')
      .select('worker_id, status, due_time, assigned_date')
      .in('worker_id', workerIds)
      .in('status', ['pending', 'completed', 'overdue']);

    if (assignmentsError) {
      req.logger.error(assignmentsError, { context: 'createAssignments', userId: req.user.id });
      return res.status(500).json({ 
        success: false,
        error: 'Failed to check existing assignments' 
      });
    }

    // Check for unclosed unselected cases for selected workers
    const { data: unclosedCases, error: unclosedError } = await supabaseAdmin
      .from('unselected_workers')
      .select('worker_id, assignment_date, case_status, reason')
      .in('worker_id', workerIds)
      .eq('case_status', 'open')
      .eq('team_leader_id', teamLeaderId);

    if (unclosedError) {
      req.logger.error(unclosedError, { context: 'createAssignments', userId: req.user.id });
      return res.status(500).json({ 
        success: false,
        error: 'Failed to check unclosed cases' 
      });
    }

    // Process all assignments to determine which workers can be assigned
    const now = new Date();
    const pendingNotDueWorkers = [];
    const completedWorkers = [];
    const overdueWorkers = [];
    const unclosedCaseWorkers = [];

    if (allAssignments && allAssignments.length > 0) {
      for (const assignment of allAssignments) {
        if (assignment.status === 'completed') {
          // Block if completed on the same date - NO DUPLICATE ASSIGNMENTS ALLOWED
          if (assignment.assigned_date === assignedDate) {
            // Always block duplicate assignments on the same date
            if (!completedWorkers.includes(assignment.worker_id)) {
              completedWorkers.push(assignment.worker_id);
            }
          }
        } else if (assignment.status === 'overdue') {
          // Check if overdue assignment is on the same date AND if next shift has started
          if (assignment.assigned_date === assignedDate) {
            // Get team leader's next shift start time
            const nextShiftInfo = await getNextShiftStartTime(teamLeaderId);
            
            if (nextShiftInfo.nextShiftStart && now >= nextShiftInfo.nextShiftStart) {
              // Next shift has started - worker can be reassigned
              req.logger.logBusiness('Overdue worker available for reassignment - next shift started', {
                workerId: assignment.worker_id,
                nextShiftStart: nextShiftInfo.nextShiftStart.toISOString(),
                currentTime: now.toISOString()
              });
            } else {
              // Next shift hasn't started yet - block assignment
              if (!overdueWorkers.includes(assignment.worker_id)) {
                overdueWorkers.push(assignment.worker_id);
              }
            }
          }
        } else if (assignment.status === 'pending') {
          // Check if pending assignment is due
          if (assignment.due_time) {
            const dueDate = new Date(assignment.due_time);
            if (now < dueDate) {
              // Pending and not yet due - BLOCK assignment
              if (!pendingNotDueWorkers.includes(assignment.worker_id)) {
                pendingNotDueWorkers.push(assignment.worker_id);
              }
            } else {
              // Pending but past due - ALLOW assignment (KPI penalty applies)
              if (!overdueWorkers.includes(assignment.worker_id)) {
                overdueWorkers.push(assignment.worker_id);
              }
            }
          } else {
            // No due time set - BLOCK assignment
            if (!pendingNotDueWorkers.includes(assignment.worker_id)) {
              pendingNotDueWorkers.push(assignment.worker_id);
            }
          }
        }
      }
    }

    // Process unclosed cases
    if (unclosedCases && unclosedCases.length > 0) {
      for (const unclosedCase of unclosedCases) {
        if (!unclosedCaseWorkers.includes(unclosedCase.worker_id)) {
          unclosedCaseWorkers.push(unclosedCase.worker_id);
        }
      }
    }

    // Block assignment if workers have unclosed cases
    if (unclosedCaseWorkers.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Some workers have unclosed unselected cases. Please close their cases first before assigning new tasks.`,
        unclosedCaseWorkers: unclosedCaseWorkers,
        message: 'Workers with unclosed unselected cases cannot receive new assignments.'
      });
    }

    // Block assignment if workers have pending assignments that are not due
    if (pendingNotDueWorkers.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: `Cannot assign new work readiness tasks. Some workers have pending assignments that are not yet due. Please wait until their current assignments are due or completed before assigning new ones.`,
        pendingNotDueWorkers: pendingNotDueWorkers,
        message: 'Workers with pending assignments that are not yet due cannot receive new assignments.'
      });
    }

    // Block assignment if workers have completed assignments on the same date
    if (completedWorkers.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Some workers have already completed their work readiness assignment for ${assignedDate}. Duplicate assignments are not allowed on the same date.`,
        existingWorkers: allAssignments?.filter(a => a.assigned_date === assignedDate).map(a => a.worker_id) || [],
        completedWorkers: completedWorkers,
        message: 'Workers who have completed their assessment cannot receive duplicate assignments on the same date.'
      });
    }

    // Block assignment if workers have overdue assignments on the same date and next shift hasn't started
    if (overdueWorkers.length > 0) {
      // Get next shift start time for better error message
      const nextShiftInfo = await getNextShiftStartTime(teamLeaderId);
      const nextShiftStart = nextShiftInfo.nextShiftStart;
      
      let errorMessage = `Cannot assign new work readiness tasks. Some workers have overdue assignments for ${assignedDate}.`;
      let detailedMessage = 'Workers with overdue assignments cannot receive new assignments until the next shift starts.';
      
      if (nextShiftStart) {
        const nextShiftTime = nextShiftStart.toLocaleString('en-PH', {
          timeZone: 'Asia/Manila',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        errorMessage += ` They will be available when the next shift starts at ${nextShiftTime}.`;
        detailedMessage += ` Next shift starts at ${nextShiftTime}.`;
      }
      
      return res.status(400).json({
        success: false,
        error: errorMessage,
        overdueWorkers: overdueWorkers,
        message: detailedMessage,
        nextShiftStart: nextShiftStart?.toISOString()
      });
    }

    // Create assignments
      // Calculate due time - use provided dueTime, shift-based deadline, or fallback to 24 hours
      let dueDateTime;
      let deadlineInfo = {};
      
      if (dueTime && typeof dueTime === 'string') {
        // Use manually provided due time
        const [hours, minutes] = dueTime.split(':').map(Number);
        dueDateTime = new Date(assignedDate);
        
        // Set the time directly (no timezone conversion needed)
        dueDateTime.setHours(hours, minutes, 0, 0);
        deadlineInfo = { type: 'manual', providedTime: dueTime };
      } else {
        // Calculate deadline based on team leader's shift
        const shiftDeadline = await calculateShiftBasedDeadline(teamLeaderId, assignedDate);
        dueDateTime = shiftDeadline.dueDateTime;
        deadlineInfo = {
          type: 'shift_based',
          shiftInfo: shiftDeadline.shiftInfo,
          deadlineType: shiftDeadline.deadlineType,
          fallbackReason: shiftDeadline.fallbackReason
        };
        
        console.log('🕐 Shift-based deadline calculated:', {
          teamLeaderId,
          assignedDate,
          dueDateTime: dueDateTime.toISOString(),
          dueDateTimeManila: dueDateTime.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }),
          shiftName: shiftDeadline.shiftInfo?.shift_name,
          shiftStartTime: shiftDeadline.shiftInfo?.start_time,
          shiftEndTime: shiftDeadline.shiftInfo?.end_time,
          deadlineType: shiftDeadline.deadlineType,
          fallbackReason: shiftDeadline.fallbackReason
        });
      }

      const assignments = workerIds.map(workerId => ({
        team_leader_id: teamLeaderId,
        worker_id: workerId,
        assigned_date: assignedDate,
        due_time: dueDateTime.toISOString(),
        team,
        status: 'pending',
        notes: notes || null,
        reminder_sent: false
      }));

      // Create assignments with duplicate prevention
      const { data: createdAssignments, error: assignmentError } = await supabaseAdmin
        .from('work_readiness_assignments')
        .insert(assignments)
        .select(`
          *,
          worker:users!work_readiness_assignments_worker_id_fkey(
            id, first_name, last_name, email
          )
        `);

      if (assignmentError) {
        // Check if it's a duplicate constraint violation
        if (assignmentError.code === '23505' && assignmentError.message.includes('unique_assignment_per_worker_per_day')) {
          req.logger.error('Duplicate assignment attempt blocked by database constraint', { 
            error: assignmentError, 
            workerIds: validWorkerIds,
            assignedDate,
            teamLeaderId: req.user.id 
          });
          return res.status(400).json({
            success: false,
            error: 'Duplicate assignment detected. Some workers already have assignments for this date.',
            message: 'Database constraint prevented duplicate assignment creation.'
          });
        }
        throw assignmentError;
      }

      // Send notifications to workers
      for (const assignment of createdAssignments) {
        const worker = assignment.worker;
        
        // Create notification using NotificationService
        const notification = await NotificationService.createWorkReadinessNotification(
          worker.id,
          teamLeaderId,
          assignment.id,
          assignment.due_time,
          notes
        );

        if (!notification) {
          console.error('Error creating notification for worker:', worker.id);
        } else {
          console.log('✅ Notification created for worker:', worker.id);
          // Update assignment to mark notification as sent
          const { error: updateError } = await supabaseAdmin
            .from('work_readiness_assignments')
            .update({
              notification_sent: true,
              notification_sent_at: new Date().toISOString()
            })
            .eq('id', assignment.id);

          if (updateError) {
            console.error('Error updating assignment notification status:', updateError);
          }
      }
    }

    // Handle unselected workers with reasons
    if (unselectedWorkers && Array.isArray(unselectedWorkers) && unselectedWorkers.length > 0) {
      console.log('📝 Processing unselected workers:', unselectedWorkers);
      
      const unselectedRecords = unselectedWorkers.map(worker => ({
        team_leader_id: teamLeaderId,
        worker_id: worker.workerId,
        assignment_date: assignedDate,
        reason: worker.reason,
        notes: worker.notes || null
      }));

      const { data: createdUnselected, error: unselectedError } = await supabaseAdmin
        .from('unselected_workers')
        .insert(unselectedRecords)
        .select();

      if (unselectedError) {
        console.error('Error saving unselected workers:', unselectedError);
        // Don't fail the entire request, just log the error
      } else {
        console.log(`✅ Saved ${createdUnselected?.length || 0} unselected worker records`);
      }
    }

    // Log the action
    console.log(`✅ Team leader ${teamLeaderId} created ${createdAssignments.length} assignments`);

    res.status(201).json({ 
      success: true,
      assignments: createdAssignments,
      deadlineInfo,
      message: `Successfully created ${createdAssignments.length} assignment(s)`,
      deadlineMessage: deadlineInfo.type === 'shift_based' && deadlineInfo.shiftInfo
        ? `Deadline set to end of ${deadlineInfo.shiftInfo.shift_name} shift (${deadlineInfo.shiftInfo.end_time})`
        : deadlineInfo.type === 'manual'
        ? `Deadline set to ${deadlineInfo.providedTime}`
        : 'Deadline set to 24 hours from assignment (fallback)'
    });

  } catch (error) {
    console.error('Error in createAssignments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get assignments for team leader
 * GET /api/work-readiness-assignments
 */
exports.getAssignments = async (req, res) => {
  try {
    const teamLeaderId = req.user.id;
    const { date, startDate, endDate, status } = req.query;
    
    console.log('📅 Backend getAssignments - Query params:', { date, startDate, endDate, status, teamLeaderId });

    let query = supabaseAdmin
      .from('work_readiness_assignments')
      .select(`
        *,
        worker:users!work_readiness_assignments_worker_id_fkey(
          id, first_name, last_name, email
        ),
        work_readiness:work_readiness!work_readiness_assignments_work_readiness_id_fkey(*)
      `)
      .eq('team_leader_id', teamLeaderId)
      .order('assigned_date', { ascending: false });

    // Filter by date range if provided
    if (startDate && endDate) {
      console.log('📅 Backend - Applying date range filter:', { startDate, endDate });
      query = query.gte('assigned_date', startDate).lte('assigned_date', endDate);
    } else if (date) {
      console.log('📅 Backend - Applying single date filter:', { date });
      // Single date filter (backward compatibility)
      query = query.eq('assigned_date', date);
    } else {
      console.log('📅 Backend - No date filter applied');
    }

    // Filter by status if provided
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    // If status is 'all' or not provided, show all assignments including cancelled ones

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching assignments:', error);
      return res.status(500).json({ error: 'Failed to fetch assignments' });
    }

    console.log('📊 Backend - Query result:', {
      totalAssignments: data?.length || 0,
      assignments: data?.map(a => ({
        id: a.id,
        status: a.status,
        assigned_date: a.assigned_date,
        worker: a.worker?.first_name || 'Unknown'
      })) || []
    });

    res.json({ 
      success: true,
      assignments: data || [],
      count: data?.length || 0
    });

  } catch (error) {
    console.error('Error in getAssignments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get assignments for worker
 * GET /api/work-readiness-assignments/worker
 */
exports.getWorkerAssignments = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { date, status } = req.query;

    let query = supabaseAdmin
      .from('work_readiness_assignments')
      .select(`
        *,
        team_leader:users!work_readiness_assignments_team_leader_id_fkey(
          id, first_name, last_name, email
        ),
        work_readiness:work_readiness!work_readiness_assignments_work_readiness_id_fkey(*)
      `)
      .eq('worker_id', workerId)
      .order('assigned_date', { ascending: false });

    if (date) {
      query = query.eq('assigned_date', date);
    }

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching worker assignments:', error);
      return res.status(500).json({ error: 'Failed to fetch assignments' });
    }

    res.json({ 
      success: true,
      assignments: data || [],
      count: data?.length || 0
    });

  } catch (error) {
    console.error('Error in getWorkerAssignments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get today's assignment for worker
 * GET /api/work-readiness-assignments/today
 */
exports.getTodayAssignment = async (req, res) => {
  try {
    const workerId = req.user.id;
    // Get today's date in PH time (UTC+8)
    const today = getTimezoneDate('PH');

    const { data, error } = await supabaseAdmin
      .from('work_readiness_assignments')
      .select(`
        *,
        team_leader:users!work_readiness_assignments_team_leader_id_fkey(
          id, first_name, last_name, email
        ),
        work_readiness:work_readiness!work_readiness_assignments_work_readiness_id_fkey(*)
      `)
      .eq('worker_id', workerId)
      .eq('assigned_date', today)
      .neq('status', 'cancelled')
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('Error fetching today assignment:', error);
      return res.status(500).json({ error: 'Failed to fetch assignment' });
    }

    res.json({ 
      success: true,
      assignment: data || null
    });

  } catch (error) {
    console.error('Error in getTodayAssignment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Check if worker can submit work readiness (has active assignment)
 * GET /api/work-readiness-assignments/can-submit
 */
exports.canSubmitWorkReadiness = async (req, res) => {
  try {
    const workerId = req.user.id;
    // Get today's date in PH time (UTC+8)
    const today = getTimezoneDate('PH');

    // Check if worker has an active assignment for today
    const { data: assignment, error } = await supabaseAdmin
      .from('work_readiness_assignments')
      .select(`
        *,
        team_leader:users!work_readiness_assignments_team_leader_id_fkey(
          id, first_name, last_name, email
        )
      `)
      .eq('worker_id', workerId)
      .eq('assigned_date', today)
      .in('status', ['pending', 'assigned'])
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking assignment:', error);
      return res.status(500).json({ error: 'Failed to check assignment' });
    }

    const canSubmit = !!assignment;
    
    
    res.json({ 
      success: true,
      canSubmit,
      assignment: assignment || null,
      message: canSubmit 
        ? 'You have an active work readiness assignment' 
        : 'No work readiness assignment for today. Please wait for your team leader to assign you.'
    });

  } catch (error) {
    console.error('Error in canSubmitWorkReadiness:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update assignment status
 * PATCH /api/work-readiness-assignments/:id
 */
exports.updateAssignmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, workReadinessId } = req.body;
    const userId = req.user.id;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Validate status
    const validStatuses = ['pending', 'completed', 'overdue', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Get assignment to verify ownership
    const { data: assignment, error: fetchError } = await supabaseAdmin
      .from('work_readiness_assignments')
      .select('*, team_leader_id, worker_id')
      .eq('id', id)
      .single();

    if (fetchError || !assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Check permissions
    const isTeamLeader = assignment.team_leader_id === userId;
    const isWorker = assignment.worker_id === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isTeamLeader && !isWorker && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to update this assignment' });
    }

    // Workers can only mark as completed
    if (isWorker && !isTeamLeader && status !== 'completed') {
      return res.status(403).json({ 
        error: 'Workers can only mark assignments as completed' 
      });
    }

    // Allow completion of overdue assignments
    if (assignment.status === 'overdue') {
      req.logger.logBusiness('Allowing completion of overdue assignment', {
        assignmentId: assignment.id,
        workerId: assignment.worker_id,
        dueTime: assignment.due_time
      });
    }

    // Allow completion even if assignment is past due time
    const now = new Date();
    const dueTime = new Date(assignment.due_time);
    const isPastDue = now > dueTime && assignment.status === 'pending';
    
    if (isPastDue) {
      req.logger.logBusiness('Allowing completion of past due assignment', {
        assignmentId: assignment.id,
        workerId: assignment.worker_id,
        dueTime: assignment.due_time,
        currentTime: now.toISOString()
      });
    }

    // Prepare updates
    const updates = {
      status,
      updated_at: new Date().toISOString()
    };

    if (notes) {
      updates.notes = notes;
    }

    if (workReadinessId) {
      updates.work_readiness_id = workReadinessId;
    }

    if (status === 'completed') {
      updates.completed_at = new Date().toISOString();
    }

    // Update assignment
    const { data, error } = await supabaseAdmin
      .from('work_readiness_assignments')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        worker:users!work_readiness_assignments_worker_id_fkey(
          id, first_name, last_name, email
        )
      `)
      .single();

    if (error) {
      console.error('Error updating assignment:', error);
      return res.status(500).json({ error: 'Failed to update assignment' });
    }

    console.log(`✅ Assignment ${id} updated to ${status} by user ${userId}`);

    res.json({ 
      success: true,
      assignment: data,
      message: 'Assignment updated successfully'
    });

  } catch (error) {
    console.error('Error in updateAssignmentStatus:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Cancel assignment
 * DELETE /api/work-readiness-assignments/:id
 */
exports.cancelAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Get assignment to verify ownership
    const { data: assignment, error: fetchError } = await supabaseAdmin
      .from('work_readiness_assignments')
      .select('team_leader_id')
      .eq('id', id)
      .single();

    if (fetchError || !assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Only team leader or admin can cancel
    if (assignment.team_leader_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to cancel this assignment' });
    }

    // Update to cancelled status
    const { data, error } = await supabaseAdmin
      .from('work_readiness_assignments')
      .update({ 
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error cancelling assignment:', error);
      return res.status(500).json({ error: 'Failed to cancel assignment' });
    }

    console.log(`✅ Assignment ${id} cancelled by user ${userId}`);

    res.json({ 
      success: true,
      assignment: data,
      message: 'Assignment cancelled successfully'
    });

  } catch (error) {
    console.error('Error in cancelAssignment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get assignment statistics
 * GET /api/work-readiness-assignments/stats
 */
exports.getAssignmentStats = async (req, res) => {
  try {
    const teamLeaderId = req.user.id;
    const { startDate, endDate } = req.query;

    // Get dates in Philippines Time (UTC+8)
    const now = new Date();
    const phtOffset = 8 * 60; // 8 hours in minutes
    const phtTime = new Date(now.getTime() + (phtOffset * 60 * 1000));
    
    const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || phtTime.toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
      .from('work_readiness_assignments')
      .select('*')
      .eq('team_leader_id', teamLeaderId)
      .gte('assigned_date', start)
      .lte('assigned_date', end);

    if (error) {
      console.error('Error fetching assignment stats:', error);
      return res.status(500).json({ error: 'Failed to fetch statistics' });
    }

    const stats = {
      total: data?.length || 0,
      pending: data?.filter(a => a.status === 'pending').length || 0,
      completed: data?.filter(a => a.status === 'completed').length || 0,
      overdue: data?.filter(a => a.status === 'overdue').length || 0,
      cancelled: data?.filter(a => a.status === 'cancelled').length || 0,
      completionRate: data?.length > 0 
        ? Math.round((data.filter(a => a.status === 'completed').length / data.length) * 100) 
        : 0
    };

    res.json({ 
      success: true,
      stats,
      dateRange: { start, end }
    });

  } catch (error) {
    console.error('Error in getAssignmentStats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get unselected workers for team leader
 * GET /api/work-readiness-assignments/unselected
 */
exports.getUnselectedWorkers = async (req, res) => {
  try {
    console.log('🔍 getUnselectedWorkers called');
    console.log('🔍 User:', req.user);
    console.log('🔍 User role:', req.user?.role);
    console.log('🔍 Query params:', req.query);
    
    // Allow passing a specific teamLeaderId in query params, otherwise use the logged-in user
    const teamLeaderId = req.query.teamLeaderId || req.user.id;
    const { date } = req.query;
    
    // Get pagination parameters
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit), 10000) : 1000;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const includeCount = req.query.includeCount === 'true';
    
    console.log('Getting unselected workers for team leader:', teamLeaderId, {
      limit,
      offset,
      includeCount
    });

    if (!teamLeaderId) {
      return res.status(400).json({ 
        success: false, 
        error: 'teamLeaderId is required' 
      });
    }

    let query = supabaseAdmin
      .from('unselected_workers')
      .select(`
        *,
        worker:users!unselected_workers_worker_id_fkey(
          id, first_name, last_name, email
        )
      `)
      .eq('team_leader_id', teamLeaderId)
      .eq('case_status', 'open')
      .order('created_at', { ascending: false });

    if (date) {
      query = query.eq('assignment_date', date);
    }

    // Add pagination
    query = query.range(offset, offset + limit - 1);

    // Get count if requested
    let totalCount = 0;
    if (includeCount) {
      let countQuery = supabaseAdmin
        .from('unselected_workers')
        .select('*', { count: 'exact', head: true })
        .eq('team_leader_id', teamLeaderId)
        .eq('case_status', 'open');
      
      if (date) {
        countQuery = countQuery.eq('assignment_date', date);
      }
      
      const { count } = await countQuery;
      totalCount = count || 0;
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching unselected workers:', error);
      return res.status(500).json({ error: 'Failed to fetch unselected workers' });
    }

    console.log(`✅ Found ${data?.length || 0} unselected workers (total: ${totalCount})`);

    res.json({ 
      success: true,
      data: data || [],
      totalCount: includeCount ? totalCount : undefined,
      pagination: {
        limit,
        offset,
        hasMore: includeCount ? (offset + limit) < totalCount : undefined
      },
      count: data?.length || 0
    });

  } catch (error) {
    console.error('Error in getUnselectedWorkers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Save unselected worker reason
 * POST /api/work-readiness-assignments/unselected/save
 */
exports.saveUnselectedWorkerReason = async (req, res) => {
  try {
    const { team_leader_id, worker_id, reason, notes } = req.body;
    const teamLeaderId = req.user.id;

    console.log('🔍 saveUnselectedWorkerReason called');
    console.log('📊 Request body:', { team_leader_id, worker_id, reason, notes });
    console.log('👤 Authenticated user:', teamLeaderId);

    // Validate required fields
    if (!team_leader_id || !worker_id || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: team_leader_id, worker_id, and reason are required'
      });
    }

    // Validate reason is one of the allowed values
    const allowedReasons = ['sick', 'on_leave_rdo', 'transferred', 'injured_medical', 'not_rostered'];
    if (!allowedReasons.includes(reason)) {
      return res.status(400).json({
        success: false,
        error: `Invalid reason: "${reason}". Must be one of: ${allowedReasons.join(', ')}`
      });
    }

    // Verify the team leader can only save for their own team
    if (team_leader_id !== teamLeaderId) {
      return res.status(403).json({
        success: false,
        error: 'You can only save unselected reasons for your own team'
      });
    }

    // Verify the worker exists and is assigned to this team leader
        const { data: worker, error: workerError } = await supabaseAdmin
      .from('users')
          .select('id, first_name, last_name, role, team')
      .eq('id', worker_id)
      .eq('role', 'worker')
      .single();

    if (workerError || !worker) {
      return res.status(404).json({
        success: false,
        error: 'Worker not found or not a valid worker'
      });
    }

    // Verify team leader exists
        const { data: teamLeader, error: teamLeaderError } = await supabaseAdmin
      .from('users')
          .select('id, first_name, last_name, role, team')
      .eq('id', team_leader_id)
      .eq('role', 'team_leader')
      .single();

    if (teamLeaderError || !teamLeader) {
      return res.status(404).json({
        success: false,
        error: 'Team leader not found or not a valid team leader'
      });
    }

    // Always create a new case for each incident
    // This allows multiple incidents per worker (e.g., sick, then accident)
    console.log('🆕 Creating new incident case for worker:', worker_id);
    
    // Add timestamp to notes to ensure uniqueness
    const timestamp = new Date().toISOString();
    const uniqueNotes = notes ? `${notes} (Reported: ${timestamp})` : `Incident reported at ${timestamp}`;
    
        const insertData = {
      team_leader_id: team_leader_id,
      worker_id: worker_id,
      reason: reason,
      notes: uniqueNotes,
      assignment_date: new Date().toISOString().split('T')[0],
      case_status: 'open',
      created_at: timestamp,
          updated_at: timestamp,
          // Prefer worker's team; fallback to team leader's team if missing
          team: worker?.team || teamLeader?.team || null
    };

    console.log('📝 Insert data:', insertData);

    const insertResult = await supabaseAdmin
      .from('unselected_workers')
      .insert(insertData)
      .select();
    
    const result = insertResult.data;
    const error = insertResult.error;
    
    console.log('📋 Insert result:', { result, error });

    if (error) {
      console.error('❌ Supabase error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });

      // Provide more specific error messages
      if (error.message.includes('relation "unselected_workers" does not exist')) {
        return res.status(500).json({
          success: false,
          error: 'Table "unselected_workers" does not exist. Please run the SQL script to create it.'
        });
      } else if (error.message.includes('violates foreign key constraint')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid team_leader_id or worker_id. Please check if the users exist.'
        });
      } else if (error.message.includes('violates check constraint')) {
        return res.status(400).json({
          success: false,
          error: `Invalid reason: "${reason}". Must be one of: ${allowedReasons.join(', ')}`
        });
      } else if (error.message.includes('permission denied')) {
        return res.status(403).json({
          success: false,
          error: 'Permission denied. Check Row Level Security policies.'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Database error: ' + error.message
      });
    }

    console.log('✅ Successfully saved unselected worker reason:', result);

    res.json({
      success: true,
      data: result,
      message: 'Unselected worker reason saved successfully'
    });

  } catch (error) {
    console.error('❌ Error in saveUnselectedWorkerReason:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + (error.message || 'Unknown error')
    });
  }
};

/**
 * Close unselected worker case
 * PATCH /api/work-readiness-assignments/unselected/:id/close
 */
exports.closeUnselectedWorkerCase = async (req, res) => {
  try {
    const { id } = req.params;
    const teamLeaderId = req.user.id;

    // Get the unselected worker record
    const { data: unselectedWorker, error: fetchError } = await supabaseAdmin
      .from('unselected_workers')
      .select('*')
      .eq('id', id)
      .eq('team_leader_id', teamLeaderId)
      .single();

    if (fetchError || !unselectedWorker) {
      return res.status(404).json({ 
        success: false,
        error: 'Unselected worker case not found' 
      });
    }

    // Move the case to closed_unselected_workers table
    const { data: closedCase, error: insertError } = await supabaseAdmin
      .from('closed_unselected_workers')
      .insert({
        original_case_id: id,
        team_leader_id: unselectedWorker.team_leader_id,
        worker_id: unselectedWorker.worker_id,
        assignment_date: unselectedWorker.assignment_date,
        reason: unselectedWorker.reason,
        notes: unselectedWorker.notes,
        closed_at: new Date().toISOString(),
        closed_by: teamLeaderId
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting into closed_unselected_workers:', insertError);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to close case' 
      });
    }

    // Delete the original case from unselected_workers table
    const { error: deleteError } = await supabaseAdmin
      .from('unselected_workers')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting original case:', deleteError);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to close case' 
      });
    }

    console.log(`✅ Unselected worker case ${id} closed by team leader ${teamLeaderId}`);

    res.json({ 
      success: true,
      message: 'Case closed successfully',
      closedCase: closedCase
    });

  } catch (error) {
    console.error('Error in closeUnselectedWorkerCase:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
};

/**
 * Get closed unselected worker cases for history
 * GET /api/work-readiness-assignments/unselected/closed/:workerId
 */
exports.getClosedUnselectedWorkerCases = async (req, res) => {
  try {
    const { workerId } = req.params;
    const teamLeaderId = req.user.id;

    // Get closed cases for the specific worker
    const { data: closedCases, error } = await supabaseAdmin
      .from('closed_unselected_workers')
      .select('*')
      .eq('worker_id', workerId)
      .eq('team_leader_id', teamLeaderId)
      .order('closed_at', { ascending: false });

    if (error) {
      console.error('Error fetching closed cases:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch closed cases' 
      });
    }

    res.json({ 
      success: true,
      data: closedCases,
      message: `Found ${closedCases.length} closed cases`
    });

  } catch (error) {
    console.error('Error in getClosedUnselectedWorkerCases:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
};

/**
 * Get all closed unselected worker cases for team leader
 * GET /api/work-readiness-assignments/unselected/closed-all
 */
exports.getAllClosedUnselectedWorkerCases = async (req, res) => {
  try {
    const teamLeaderId = req.user.id;
    
    // Get pagination parameters
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const includeCount = req.query.includeCount === 'true';

    console.log('📋 getAllClosedUnselectedWorkerCases called', {
      teamLeaderId,
      limit,
      offset,
      includeCount
    });

    // Build query
    let query = supabaseAdmin
      .from('closed_unselected_workers')
      .select(`
        *,
        worker:worker_id (
          id,
          first_name,
          last_name,
          email
        )
      `)
      .eq('team_leader_id', teamLeaderId)
      .order('closed_at', { ascending: false });

    // Add pagination
    query = query.range(offset, offset + limit - 1);

    // Get count if requested
    let totalCount = 0;
    if (includeCount) {
      const { count } = await supabaseAdmin
        .from('closed_unselected_workers')
        .select('*', { count: 'exact', head: true })
        .eq('team_leader_id', teamLeaderId);
      totalCount = count || 0;
    }

    const { data: closedCases, error } = await query;

    if (error) {
      console.error('Error fetching all closed cases:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch closed cases' 
      });
    }

    console.log(`✅ Found ${closedCases?.length || 0} closed cases (total: ${totalCount})`);

    res.json({ 
      success: true,
      data: closedCases || [],
      totalCount: includeCount ? totalCount : undefined,
      pagination: {
        limit,
        offset,
        hasMore: includeCount ? (offset + limit) < totalCount : undefined
      },
      message: `Found ${closedCases?.length || 0} closed cases`
    });

  } catch (error) {
    console.error('Error in getAllClosedUnselectedWorkerCases:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
};

/**
 * Mark overdue assignments (Manual endpoint for team leaders)
 * POST /api/work-readiness-assignments/mark-overdue
 */
exports.markOverdueAssignments = async (req, res) => {
  try {
    // Debug: Log user info
    req.logger.info('Mark overdue assignments called', {
      userId: req.user?.id,
      userRole: req.user?.role,
      userEmail: req.user?.email
    });
    
    // Allow admin or team leaders only (manual overdue marking)
    if (req.user.role !== 'admin' && req.user.role !== 'team_leader') {
      req.logger.warn('Unauthorized access attempt', {
        userId: req.user?.id,
        userRole: req.user?.role,
        requiredRoles: ['admin', 'team_leader']
      });
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Get current time for manual overdue marking
    const now = new Date();

    // MANUAL OVERDUE MARKING: Only mark assignments that are past due time
    // Team leaders can manually mark overdue assignments after due time
    const nowISO = now.toISOString();
    
    // First, get assignments that are past due time
    const { data: overdueCandidates, error: fetchError } = await supabaseAdmin
      .from('work_readiness_assignments')
      .select('id, worker_id, due_time, assigned_date, status')
      .eq('status', 'pending')
      .lt('due_time', nowISO);  // Only assignments past due time
    
    if (fetchError) {
      req.logger.error(fetchError, { context: 'markOverdueAssignments', userId: req.user.id });
      return res.status(500).json({ success: false, error: 'Failed to fetch overdue candidates' });
    }
    
    if (!overdueCandidates || overdueCandidates.length === 0) {
      return res.json({ 
        success: true, 
        count: 0,
        message: 'No assignments are past due time yet'
      });
    }
    
    // Mark the overdue candidates as overdue
    const { data, error } = await supabaseAdmin
      .from('work_readiness_assignments')
      .update({ 
        status: 'overdue', 
        updated_at: new Date().toISOString() 
      })
      .in('id', overdueCandidates.map(a => a.id))
      .select();

    if (error) {
      req.logger.error(error, { context: 'markOverdueAssignments', userId: req.user.id });
      return res.status(500).json({ success: false, error: 'Failed to mark overdue assignments' });
    }

    const markedCount = data?.length || 0;
    
    // Log overdue assignments for monitoring
    if (markedCount > 0) {
      req.logger.info('Marked assignments as overdue', {
        count: markedCount,
        currentTime: nowISO,
        userId: req.user.id
      });
    }

    req.logger.logBusiness('Marked assignments as overdue', { count: markedCount, userId: req.user.id });

    res.json({ 
      success: true,
      count: markedCount,
      message: `Marked ${markedCount} assignments as overdue (manual overdue marking)`
    });

  } catch (error) {
    req.logger.error(error, { context: 'markOverdueAssignments', userId: req.user?.id });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
