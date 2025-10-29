const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Case Manager Analytics Controller
 * Provides comprehensive analytics for case managers
 */

/**
 * Get overview analytics for case manager
 * @route GET /api/analytics/case-manager/overview
 */
const getCaseManagerOverview = async (req, res) => {
  try {
    const caseManagerId = req.user.id;
    const { period = 'month' } = req.query;
    
    console.log('📊 Overview Request:', { caseManagerId, period });
    
    const periodStart = getPeriodStart(period);
    const now = new Date().toISOString();

    // Fetch all cases managed by this case manager
    const { data: allCases, error: casesError } = await supabase
      .from('cases')
      .select(`
        id,
        case_number,
        status,
        created_at,
        updated_at,
        clinician_id,
        incident_id,
        worker:users!cases_worker_id_fkey(id, first_name, last_name),
        clinician:users!cases_clinician_id_fkey(id, first_name, last_name, specialty)
      `)
      .eq('case_manager_id', caseManagerId);
    
    console.log('📦 Cases fetched:', { count: allCases?.length || 0, error: casesError });

    if (casesError) {
      console.error('Error fetching cases:', casesError);
      return res.status(500).json({ 
        message: 'Failed to fetch cases', 
        error: casesError.message 
      });
    }

    const cases = allCases || [];
    
    // Filter cases by period
    const periodCases = cases.filter(c => 
      new Date(c.created_at) >= new Date(periodStart)
    );

    // Calculate KPIs
    const totalCases = cases.length;
    const activeCases = cases.filter(c => 
      c.status === 'new' || c.status === 'triaged' || c.status === 'assessed' || c.status === 'in_rehab'
    ).length;
    const completedCases = cases.filter(c => c.status === 'closed' || c.status === 'return_to_work').length;
    const newCasesThisPeriod = periodCases.length;
    
    // FIXED: Count cases that were CLOSED in this period (not cases created this period that are currently closed)
    // Use updated_at date when status is closed/return_to_work to determine when case was closed
    const closedThisPeriod = cases.filter(c => {
      const isClosed = c.status === 'closed' || c.status === 'return_to_work';
      if (!isClosed) return false;
      
      // Check if case was closed during this period using updated_at
      const closedDate = c.updated_at ? new Date(c.updated_at) : null;
      if (!closedDate) return false;
      
      return closedDate >= new Date(periodStart);
    }).length;
    
    // Calculate average case resolution time
    const resolvedCases = cases.filter(c => (c.status === 'closed' || c.status === 'return_to_work') && c.updated_at);
    const avgResolutionDays = resolvedCases.length > 0
      ? Math.round(
          resolvedCases.reduce((sum, c) => {
            const created = new Date(c.created_at);
            const closed = new Date(c.updated_at);
            const days = (closed - created) / (1000 * 60 * 60 * 24);
            return sum + days;
          }, 0) / resolvedCases.length
        )
      : 0;

    // Clinician assignment rate
    const casesWithClinician = cases.filter(c => c.clinician_id).length;
    const clinicianAssignmentRate = totalCases > 0
      ? Math.round((casesWithClinician / totalCases) * 100)
      : 0;

    // Fetch incidents for severity analysis
    const incidentIds = cases.map(c => c.incident_id).filter(Boolean);
    let incidents = [];
    if (incidentIds.length > 0) {
      const { data: incidentsData, error: incidentsError } = await supabase
        .from('incidents')
        .select('id, severity, incident_type, incident_date')
        .in('id', incidentIds);
      
      if (!incidentsError) {
        incidents = incidentsData || [];
      }
    }

    // Cases by status
    const casesByStatus = [
      { status: 'new', count: cases.filter(c => c.status === 'new').length },
      { status: 'triaged', count: cases.filter(c => c.status === 'triaged').length },
      { status: 'assessed', count: cases.filter(c => c.status === 'assessed').length },
      { status: 'in_rehab', count: cases.filter(c => c.status === 'in_rehab').length },
      { status: 'return_to_work', count: cases.filter(c => c.status === 'return_to_work').length },
      { status: 'closed', count: cases.filter(c => c.status === 'closed').length }
    ];

    // Cases by severity (from incidents)
    const severityCounts = {};
    if (incidents) {
      incidents.forEach(inc => {
        const severity = inc.severity || 'unknown';
        severityCounts[severity] = (severityCounts[severity] || 0) + 1;
      });
    }
    const casesBySeverity = Object.entries(severityCounts).map(([severity, count]) => ({
      severity,
      count
    }));

    // Cases by injury type
    const injuryTypeCounts = {};
    if (incidents) {
      incidents.forEach(inc => {
        const type = inc.incident_type || 'unknown';
        injuryTypeCounts[type] = (injuryTypeCounts[type] || 0) + 1;
      });
    }
    const casesByInjuryType = Object.entries(injuryTypeCounts).map(([injuryType, count]) => ({
      injuryType,
      count
    }));

    const responseData = {
      success: true,
      data: {
        kpis: {
          totalCases,
          activeCases,
          completedCases,
          newCasesThisPeriod,
          closedThisPeriod,
          avgResolutionDays,
          clinicianAssignmentRate,
          successRate: completedCases > 0 
            ? Math.round((completedCases / totalCases) * 100) 
            : 0
        },
        distributions: {
          casesByStatus,
          casesBySeverity,
          casesByInjuryType
        }
      }
    };
    
    console.log('✅ Overview Response:', JSON.stringify(responseData, null, 2));
    res.json(responseData);
  } catch (error) {
    console.error('Error in getCaseManagerOverview:', error);
    res.status(500).json({ 
      message: 'Failed to fetch overview analytics', 
      error: error.message 
    });
  }
};

/**
 * Get trend analytics for case manager
 * @route GET /api/analytics/case-manager/trends
 */
const getCaseManagerTrends = async (req, res) => {
  try {
    const caseManagerId = req.user.id;
    const { period = 'month' } = req.query;
    
    console.log('📈 Trends Request:', { caseManagerId, period });
    
    const periodStart = getPeriodStart(period);

    // Fetch cases with dates
    const { data: cases, error: casesError } = await supabase
      .from('cases')
      .select('id, case_number, status, created_at, updated_at')
      .eq('case_manager_id', caseManagerId)
      .gte('created_at', periodStart)
      .order('created_at', { ascending: true });
    
    console.log('📦 Trends data:', { count: cases?.length || 0, error: casesError });

    if (casesError) {
      console.error('Error fetching cases for trends:', casesError);
      return res.status(500).json({ 
        message: 'Failed to fetch trend data', 
        error: casesError.message 
      });
    }

    // Group by date
    const trendData = groupByPeriod(cases || [], period);

    res.json({
      success: true,
      data: {
        trends: trendData,
        period
      }
    });
  } catch (error) {
    console.error('Error in getCaseManagerTrends:', error);
    res.status(500).json({ 
      message: 'Failed to fetch trend analytics', 
      error: error.message 
    });
  }
};

/**
 * Get clinician performance metrics
 * @route GET /api/analytics/case-manager/clinicians
 */
const getClinicianMetrics = async (req, res) => {
  try {
    const caseManagerId = req.user.id;

    // Fetch all clinicians
    const { data: clinicians, error: cliniciansError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, specialty')
      .eq('role', 'clinician')
      .eq('is_active', true);

    if (cliniciansError) {
      console.error('Error fetching clinicians:', cliniciansError);
      return res.status(500).json({ 
        message: 'Failed to fetch clinicians', 
        error: cliniciansError.message 
      });
    }

    // Fetch cases for each clinician
    const { data: cases, error: casesError } = await supabase
      .from('cases')
      .select('id, clinician_id, status, created_at, updated_at')
      .eq('case_manager_id', caseManagerId)
      .not('clinician_id', 'is', null);

    if (casesError) {
      console.error('Error fetching clinician cases:', casesError);
      return res.status(500).json({ 
        message: 'Failed to fetch clinician cases', 
        error: casesError.message 
      });
    }

    // Calculate metrics per clinician
    const clinicianMetrics = (clinicians || []).map(clinician => {
      const clinicianCases = (cases || []).filter(c => c.clinician_id === clinician.id);
      const activeCases = clinicianCases.filter(c => 
        c.status === 'new' || c.status === 'triaged' || c.status === 'assessed' || c.status === 'in_rehab'
      ).length;
      const completedCases = clinicianCases.filter(c => c.status === 'closed' || c.status === 'return_to_work').length;
      const totalCases = clinicianCases.length;

      // Calculate average case duration for completed cases
      const completedWithDates = clinicianCases.filter(c => 
        (c.status === 'closed' || c.status === 'return_to_work') && c.created_at && c.updated_at
      );
      const avgDuration = completedWithDates.length > 0
        ? Math.round(
            completedWithDates.reduce((sum, c) => {
              const days = (new Date(c.updated_at) - new Date(c.created_at)) / (1000 * 60 * 60 * 24);
              return sum + days;
            }, 0) / completedWithDates.length
          )
        : 0;

      const successRate = totalCases > 0 
        ? Math.round((completedCases / totalCases) * 100) 
        : 0;

      return {
        id: clinician.id,
        name: `${clinician.first_name} ${clinician.last_name}`,
        specialty: clinician.specialty || 'General',
        isAvailable: true, // Default to available since column doesn't exist
        activeCases,
        completedCases,
        totalCases,
        avgDuration,
        successRate
      };
    });

    // Sort by workload
    clinicianMetrics.sort((a, b) => b.activeCases - a.activeCases);

    res.json({
      success: true,
      data: {
        clinicians: clinicianMetrics
      }
    });
  } catch (error) {
    console.error('Error in getClinicianMetrics:', error);
    res.status(500).json({ 
      message: 'Failed to fetch clinician metrics', 
      error: error.message 
    });
  }
};

/**
 * Get worker status overview
 * @route GET /api/analytics/case-manager/workers
 */
const getWorkerStatusOverview = async (req, res) => {
  try {
    const caseManagerId = req.user.id;

    // Fetch cases with worker info
    const { data: cases, error: casesError } = await supabase
      .from('cases')
      .select(`
        id,
        case_number,
        status,
        created_at,
        updated_at,
        worker:users!cases_worker_id_fkey(
          id, 
          first_name, 
          last_name, 
          email
        ),
        clinician:users!cases_clinician_id_fkey(
          id,
          first_name,
          last_name
        )
      `)
      .eq('case_manager_id', caseManagerId)
      .neq('status', 'closed');

    if (casesError) {
      console.error('Error fetching worker cases:', casesError);
      return res.status(500).json({ 
        message: 'Failed to fetch worker data', 
        error: casesError.message 
      });
    }

    // Get work readiness for these workers
    const workerIds = (cases || []).map(c => c.worker?.id).filter(Boolean);
    
    let workReadiness = [];
    if (workerIds.length > 0) {
      const { data: readinessData, error: readinessError } = await supabase
        .from('work_readiness')
        .select('worker_id, readiness_level, submitted_at')
        .in('worker_id', workerIds)
        .order('submitted_at', { ascending: false });

      if (!readinessError) {
        workReadiness = readinessData || [];
      }
    }

    // Get latest readiness per worker
    const latestReadiness = {};
    workReadiness.forEach(wr => {
      if (!latestReadiness[wr.worker_id]) {
        latestReadiness[wr.worker_id] = wr.readiness_level;
      }
    });

    // Count by readiness level
    const readinessCounts = {
      'Fit for Work': 0,
      'Minor Concerns - Fit for Work': 0,
      'Not Fit for Work': 0,
      'unknown': 0
    };

    Object.values(latestReadiness).forEach(level => {
      readinessCounts[level] = (readinessCounts[level] || 0) + 1;
    });

    // Workers requiring attention (no update in 7+ days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const workersRequiringAttention = (cases || [])
      .filter(c => {
        const lastUpdate = new Date(c.updated_at);
        return lastUpdate < sevenDaysAgo;
      })
      .map(c => ({
        workerId: c.worker?.id,
        workerName: `${c.worker?.first_name || ''} ${c.worker?.last_name || ''}`.trim(),
        caseNumber: c.case_number,
        caseStatus: c.status,
        daysSinceUpdate: Math.floor((new Date() - new Date(c.updated_at)) / (1000 * 60 * 60 * 24)),
        clinicianName: c.clinician 
          ? `${c.clinician.first_name} ${c.clinician.last_name}` 
          : 'Unassigned'
      }))
      .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);

    res.json({
      success: true,
      data: {
        readinessDistribution: Object.entries(readinessCounts).map(([level, count]) => ({
          level,
          count
        })),
        workersRequiringAttention: workersRequiringAttention.slice(0, 10) // Top 10
      }
    });
  } catch (error) {
    console.error('Error in getWorkerStatusOverview:', error);
    res.status(500).json({ 
      message: 'Failed to fetch worker status', 
      error: error.message 
    });
  }
};

/**
 * Get upcoming deadlines and overdue tasks
 * @route GET /api/analytics/case-manager/deadlines
 */
const getDeadlinesOverview = async (req, res) => {
  try {
    const caseManagerId = req.user.id;
    const now = new Date();
    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(now.getDate() + 7);

    // Fetch work readiness assignments
    const { data: assignments, error: assignmentsError } = await supabase
      .from('work_readiness_assignments')
      .select(`
        id,
        title,
        due_date,
        due_time,
        status,
        worker:users!work_readiness_assignments_worker_id_fkey(
          id,
          first_name,
          last_name
        )
      `)
      .neq('status', 'completed')
      .lte('due_date', sevenDaysLater.toISOString().split('T')[0]);

    // Get cases managed by this case manager to filter assignments
    const { data: cases, error: casesError } = await supabase
      .from('cases')
      .select('worker_id')
      .eq('case_manager_id', caseManagerId);

    const workerIds = (cases || []).map(c => c.worker_id);
    
    // Filter assignments for workers in case manager's cases
    const relevantAssignments = (assignments || []).filter(a => 
      workerIds.includes(a.worker?.id)
    );

    // Categorize deadlines
    const upcomingDeadlines = [];
    const overdueDeadlines = [];

    relevantAssignments.forEach(assignment => {
      const dueDate = new Date(assignment.due_date);
      const isOverdue = dueDate < now;

      const deadline = {
        id: assignment.id,
        title: assignment.title,
        dueDate: assignment.due_date,
        dueTime: assignment.due_time,
        status: assignment.status,
        workerName: assignment.worker 
          ? `${assignment.worker.first_name} ${assignment.worker.last_name}`
          : 'Unknown',
        daysUntilDue: Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24)),
        type: 'work_readiness_assignment'
      };

      if (isOverdue) {
        overdueDeadlines.push(deadline);
      } else {
        upcomingDeadlines.push(deadline);
      }
    });

    // Sort by urgency
    upcomingDeadlines.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
    overdueDeadlines.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

    res.json({
      success: true,
      data: {
        upcomingDeadlines: upcomingDeadlines.slice(0, 10),
        overdueDeadlines: overdueDeadlines.slice(0, 10),
        counts: {
          upcoming: upcomingDeadlines.length,
          overdue: overdueDeadlines.length
        }
      }
    });
  } catch (error) {
    console.error('Error in getDeadlinesOverview:', error);
    res.status(500).json({ 
      message: 'Failed to fetch deadlines', 
      error: error.message 
    });
  }
};

// Helper functions

function getPeriodStart(period) {
  const now = new Date();
  switch (period) {
    case 'week':
      now.setDate(now.getDate() - 7);
      break;
    case 'month':
      now.setMonth(now.getMonth() - 1);
      break;
    case 'year':
      now.setFullYear(now.getFullYear() - 1);
      break;
    default:
      now.setMonth(now.getMonth() - 1);
  }
  return now.toISOString();
}

function groupByPeriod(cases, period) {
  const now = new Date();
  const grouped = {};
  
  // Generate all time periods first (even without data)
  if (period === 'week') {
    // Last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      grouped[dateKey] = {
        date: label,
        newCases: 0,
        closedCases: 0,
        activeCases: 0
      };
    }
  } else if (period === 'month') {
    // Last 4 weeks
    for (let i = 1; i <= 4; i++) {
      grouped[`Week ${i}`] = {
        date: `Week ${i}`,
        newCases: 0,
        closedCases: 0,
        activeCases: 0
      };
    }
  } else {
    // Last 12 months
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now);
      date.setMonth(date.getMonth() - i);
      const dateKey = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      grouped[dateKey] = {
        date: dateKey,
        newCases: 0,
        closedCases: 0,
        activeCases: 0
      };
    }
  }
  
  // Now fill in actual case data
  cases.forEach(c => {
    let dateKey;
    const date = new Date(c.created_at);
    
    if (period === 'week') {
      // Group by day
      dateKey = date.toISOString().split('T')[0];
    } else if (period === 'month') {
      // Group by week
      const weekNum = Math.ceil(date.getDate() / 7);
      dateKey = `Week ${weekNum}`;
    } else {
      // Group by month
      dateKey = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
    
    if (grouped[dateKey]) {
      grouped[dateKey].newCases += 1;
      if (c.status === 'closed' || c.status === 'return_to_work') {
        grouped[dateKey].closedCases += 1;
      } else {
        grouped[dateKey].activeCases += 1;
      }
    }
  });
  
  return Object.values(grouped);
}

module.exports = {
  getCaseManagerOverview,
  getCaseManagerTrends,
  getClinicianMetrics,
  getWorkerStatusOverview,
  getDeadlinesOverview
};

