// Skip MongoDB imports - using Supabase only
let ActivityLog, Case, User, Appointment;
try {
  if (process.env.NODE_ENV !== 'production' && process.env.USE_SUPABASE !== 'true') {
    ActivityLog = require('../models/ActivityLog');
    Case = require('../models/Case');
    User = require('../models/User');
    Appointment = require('../models/Appointment');
  } else {
    ActivityLog = {};
    Case = {};
    User = {};
    Appointment = {};
  }
} catch (error) {
  ActivityLog = {};
  Case = {};
  User = {};
  Appointment = {};
}

// @desc    Get activity monitor data for clinician
// @route   GET /api/clinicians/activity-monitor
// @access  Private (Clinician only)
const getActivityMonitor = async (req, res) => {
  try {
    console.log('Fetching activity monitor data for clinician:', req.user._id);
    console.log('User role:', req.user.role);

    // Check if user is a clinician
    if (req.user.role !== 'clinician') {
      console.error('Non-clinician tried to access activity monitor');
      return res.status(403).json({ message: 'Access denied. Only clinicians can view activity monitor.' });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get cases for this clinician
    console.log('Fetching cases for clinician:', req.user._id);
    const cases = await Case.find({ clinician: req.user._id }).select('_id caseNumber status worker');
    const caseIds = cases.map(c => c._id);
    console.log('Found cases:', cases.length, 'Case IDs:', caseIds);

    // If no cases found, return empty data
    if (cases.length === 0) {
      console.log('No cases found for clinician, returning empty data');
      return res.json({
        success: true,
        summary: {
          totalLogs: 0,
          unreviewedLogs: 0,
          logsLast30Days: 0,
          logsLast7Days: 0,
          logsToday: 0,
          totalCases: 0
        },
        logsByType: [],
        logsByPriority: [],
        recentActivities: [],
        workerActivity: [],
        caseActivity: [],
        dailyActivity: []
      });
    }

    // Get activity logs for this clinician's cases
    console.log('Fetching activity logs...');
    let totalLogs, unreviewedLogs, logsLast30Days, logsLast7Days, logsToday, logsByType, logsByPriority, recentLogs, recentCaseAssignments, recentCaseUpdates;
    
    try {
      [
        totalLogs,
        unreviewedLogs,
        logsLast30Days,
        logsLast7Days,
        logsToday,
        logsByType,
        logsByPriority,
        recentLogs,
        recentCaseAssignments,
        recentCaseUpdates
      ] = await Promise.all([
      ActivityLog.countDocuments({ case: { $in: caseIds } }),
      ActivityLog.countDocuments({ case: { $in: caseIds }, isReviewed: false }),
      ActivityLog.countDocuments({ 
        case: { $in: caseIds },
        createdAt: { $gte: thirtyDaysAgo }
      }),
      ActivityLog.countDocuments({ 
        case: { $in: caseIds },
        createdAt: { $gte: sevenDaysAgo }
      }),
      ActivityLog.countDocuments({ 
        case: { $in: caseIds },
        createdAt: { $gte: today }
      }),
      ActivityLog.aggregate([
        { $match: { case: { $in: caseIds } } },
        { $group: { _id: '$activityType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      ActivityLog.aggregate([
        { $match: { case: { $in: caseIds } } },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      ActivityLog.find({ case: { $in: caseIds } })
        .populate('worker', 'firstName lastName email')
        .populate('case', 'caseNumber status')
        .populate('rehabilitationPlan', 'planName status')
        .sort({ createdAt: -1 })
        .limit(20),
      // Get recent case assignments to this clinician (limit to 5 for performance)
      Case.find({
        clinician: req.user._id,
        createdAt: { $gte: thirtyDaysAgo }
      })
      .populate('worker', 'firstName lastName email')
      .populate('caseManager', 'firstName lastName email')
      .populate('incident', 'incidentNumber incidentDate description')
      .sort({ createdAt: -1 })
      .limit(5),
      // Get recent case status updates (limit to 5 for performance)
      Case.find({
        clinician: req.user._id,
        'statusHistory.changedAt': { $gte: sevenDaysAgo }
      })
      .populate('worker', 'firstName lastName email')
      .populate('caseManager', 'firstName lastName email')
      .sort({ 'statusHistory.changedAt': -1 })
      .limit(5)
    ]);
    } catch (dbError) {
      console.error('Database error in activity monitor:', dbError);
      // Return empty data if database query fails
      totalLogs = unreviewedLogs = logsLast30Days = logsLast7Days = logsToday = 0;
      logsByType = logsByPriority = [];
      recentLogs = recentCaseAssignments = recentCaseUpdates = [];
    }

    // Combine all recent activities
    const allRecentActivities = [];

    // Add case assignments
    recentCaseAssignments.forEach(caseDoc => {
      allRecentActivities.push({
        type: 'case_assigned',
        title: 'New Case Assigned',
        description: `Case ${caseDoc.caseNumber} assigned to you`,
        worker: caseDoc.worker,
        case: {
          _id: caseDoc._id,
          caseNumber: caseDoc.caseNumber,
          status: caseDoc.status
        },
        caseManager: caseDoc.caseManager,
        incident: caseDoc.incident,
        createdAt: caseDoc.createdAt,
        priority: 'medium'
      });
    });

    // Add case status updates
    recentCaseUpdates.forEach(caseDoc => {
      const latestStatusChange = caseDoc.statusHistory
        .filter(change => change.changedAt >= sevenDaysAgo)
        .sort((a, b) => b.changedAt - a.changedAt)[0];
      
      if (latestStatusChange) {
        allRecentActivities.push({
          type: 'case_status_update',
          title: 'Case Status Updated',
          description: `Case ${caseDoc.caseNumber} status changed to ${latestStatusChange.status}`,
          worker: caseDoc.worker,
          case: {
            _id: caseDoc._id,
            caseNumber: caseDoc.caseNumber,
            status: latestStatusChange.status
          },
          caseManager: caseDoc.caseManager,
          createdAt: latestStatusChange.changedAt,
          priority: 'medium',
          notes: latestStatusChange.notes
        });
      }
    });

    // Add regular activity logs
    recentLogs.forEach(log => {
      allRecentActivities.push({
        type: log.activityType,
        title: log.title,
        description: log.description,
        worker: log.worker,
        case: log.case,
        rehabilitationPlan: log.rehabilitationPlan,
        createdAt: log.createdAt,
        priority: log.priority,
        isReviewed: log.isReviewed
      });
    });

    // Sort all activities by creation date
    allRecentActivities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Get worker activity summary
    const workerActivity = await ActivityLog.aggregate([
      { $match: { case: { $in: caseIds } } },
      {
        $group: {
          _id: '$worker',
          activityCount: { $sum: 1 },
          completedExercises: { $sum: { $cond: [{ $eq: ['$activityType', 'exercise_completed'] }, 1, 0] } },
          skippedExercises: { $sum: { $cond: [{ $eq: ['$activityType', 'exercise_skipped'] }, 1, 0] } },
          checkIns: { $sum: { $cond: [{ $eq: ['$activityType', 'daily_check_in'] }, 1, 0] } },
          lastActivity: { $max: '$createdAt' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'worker'
        }
      },
      { $unwind: '$worker' },
      {
        $project: {
          workerId: '$_id',
          workerName: { $concat: ['$worker.firstName', ' ', '$worker.lastName'] },
          workerEmail: '$worker.email',
          activityCount: 1,
          completedExercises: 1,
          skippedExercises: 1,
          checkIns: 1,
          lastActivity: 1
        }
      },
      { $sort: { activityCount: -1 } },
      { $limit: 10 }
    ]);

    // Get case activity summary
    const caseActivity = await ActivityLog.aggregate([
      { $match: { case: { $in: caseIds } } },
      {
        $group: {
          _id: '$case',
          activityCount: { $sum: 1 },
          completedExercises: { $sum: { $cond: [{ $eq: ['$activityType', 'exercise_completed'] }, 1, 0] } },
          skippedExercises: { $sum: { $cond: [{ $eq: ['$activityType', 'exercise_skipped'] }, 1, 0] } },
          checkIns: { $sum: { $cond: [{ $eq: ['$activityType', 'daily_check_in'] }, 1, 0] } },
          lastActivity: { $max: '$createdAt' }
        }
      },
      {
        $lookup: {
          from: 'cases',
          localField: '_id',
          foreignField: '_id',
          as: 'case'
        }
      },
      { $unwind: '$case' },
      {
        $lookup: {
          from: 'users',
          localField: 'case.worker',
          foreignField: '_id',
          as: 'worker'
        }
      },
      { $unwind: '$worker' },
      {
        $project: {
          caseId: '$_id',
          caseNumber: '$case.caseNumber',
          caseStatus: '$case.status',
          workerName: { $concat: ['$worker.firstName', ' ', '$worker.lastName'] },
          activityCount: 1,
          completedExercises: 1,
          skippedExercises: 1,
          checkIns: 1,
          lastActivity: 1
        }
      },
      { $sort: { activityCount: -1 } },
      { $limit: 10 }
    ]);

    // Get daily activity for the last 30 days
    const dailyActivity = await ActivityLog.aggregate([
      { $match: { case: { $in: caseIds }, createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 },
          completedExercises: { $sum: { $cond: [{ $eq: ['$activityType', 'exercise_completed'] }, 1, 0] } },
          skippedExercises: { $sum: { $cond: [{ $eq: ['$activityType', 'exercise_skipped'] }, 1, 0] } },
          checkIns: { $sum: { $cond: [{ $eq: ['$activityType', 'daily_check_in'] }, 1, 0] } }
        }
      },
      {
        $project: {
          date: {
            $dateFromParts: {
              year: '$_id.year',
              month: '$_id.month',
              day: '$_id.day'
            }
          },
          count: 1,
          completedExercises: 1,
          skippedExercises: 1,
          checkIns: 1
        }
      },
      { $sort: { date: 1 } }
    ]);

    console.log('Activity monitor data prepared successfully');
    console.log('Total activities:', allRecentActivities.length);
    console.log('Recent activities:', allRecentActivities.slice(0, 5).map(a => ({ type: a.type, title: a.title })));

    res.json({
      success: true,
      summary: {
        totalLogs,
        unreviewedLogs,
        logsLast30Days,
        logsLast7Days,
        logsToday,
        totalCases: cases.length
      },
      logsByType,
      logsByPriority,
      recentActivities: allRecentActivities.slice(0, 15), // Limit to 15 most recent activities for performance
      workerActivity,
      caseActivity,
      dailyActivity
    });
  } catch (error) {
    console.error('Error fetching activity monitor data:', error);
    res.status(500).json({
      message: 'Error fetching activity monitor data',
      error: error.message
    });
  }
};

module.exports = {
  getActivityMonitor
};
