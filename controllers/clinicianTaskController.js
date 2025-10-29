// Skip MongoDB imports - using Supabase only
let User, Case, Appointment;
try {
  if (process.env.NODE_ENV !== 'production' && process.env.USE_SUPABASE !== 'true') {
    User = require('../models/User');
    Case = require('../models/Case');
    Appointment = require('../models/Appointment');
  } else {
    User = {};
    Case = {};
    Appointment = {};
  }
} catch (error) {
  User = {};
  Case = {};
  Appointment = {};
}

// @desc    Get clinician tasks (cases and appointments)
// @route   GET /api/clinicians/tasks
// @access  Private (Clinician only)
const getClinicianTasks = async (req, res) => {
  try {
    console.log('Fetching tasks for clinician:', req.user._id);

    // Get active cases
    const activeCases = await Case.find({
      clinician: req.user._id,
      status: { $in: ['triaged', 'assessed', 'in_rehab'] }
    })
    .populate('worker', 'firstName lastName email phone')
    .populate('employer', 'firstName lastName email phone')
    .populate('incident', 'incidentNumber incidentDate description incidentType severity')
    .sort({ priority: -1, createdAt: -1 });

    // Get upcoming appointments
    const upcomingAppointments = await Appointment.find({
      clinician: req.user._id,
      scheduledDate: { $gte: new Date() },
      status: { $in: ['scheduled', 'confirmed'] }
    })
    .populate('worker', 'firstName lastName email phone')
    .populate('case', 'caseNumber status priority')
    .sort({ scheduledDate: 1 });

    // Get recent appointments (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentAppointments = await Appointment.find({
      clinician: req.user._id,
      scheduledDate: { $gte: sevenDaysAgo, $lt: new Date() },
      status: { $in: ['completed', 'cancelled'] }
    })
    .populate('worker', 'firstName lastName email phone')
    .populate('case', 'caseNumber status priority')
    .sort({ scheduledDate: -1 })
    .limit(10);

    // Calculate task statistics
    const taskStats = {
      totalActiveCases: activeCases.length,
      totalUpcomingAppointments: upcomingAppointments.length,
      totalRecentAppointments: recentAppointments.length,
      urgentCases: activeCases.filter(c => c.priority === 'urgent').length,
      highPriorityCases: activeCases.filter(c => c.priority === 'high').length,
      mediumPriorityCases: activeCases.filter(c => c.priority === 'medium').length,
      lowPriorityCases: activeCases.filter(c => c.priority === 'low').length
    };

    res.json({
      success: true,
      tasks: {
        activeCases,
        upcomingAppointments,
        recentAppointments
      },
      stats: taskStats
    });
  } catch (error) {
    console.error('Error fetching clinician tasks:', error);
    res.status(500).json({
      message: 'Error fetching tasks',
      error: error.message
    });
  }
};

// @desc    Get clinician workload summary
// @route   GET /api/clinicians/workload
// @access  Private (Clinician only)
const getClinicianWorkload = async (req, res) => {
  try {
    console.log('Fetching workload for clinician:', req.user._id);

    // Get active cases count
    const activeCasesCount = await Case.countDocuments({
      clinician: req.user._id,
      status: { $in: ['triaged', 'assessed', 'in_rehab'] }
    });

    // Get upcoming appointments count
    const upcomingAppointmentsCount = await Appointment.countDocuments({
      clinician: req.user._id,
      scheduledDate: { $gte: new Date() },
      status: { $in: ['scheduled', 'confirmed'] }
    });

    // Get today's appointments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAppointmentsCount = await Appointment.countDocuments({
      clinician: req.user._id,
      scheduledDate: { $gte: today, $lt: tomorrow },
      status: { $in: ['scheduled', 'confirmed'] }
    });

    // Get this week's appointments
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const weekAppointmentsCount = await Appointment.countDocuments({
      clinician: req.user._id,
      scheduledDate: { $gte: weekStart, $lt: weekEnd },
      status: { $in: ['scheduled', 'confirmed'] }
    });

    // Calculate availability score
    let availabilityScore = 100;
    availabilityScore -= activeCasesCount * 10;
    availabilityScore -= todayAppointmentsCount * 5;
    availabilityScore -= Math.floor(weekAppointmentsCount / 2);
    availabilityScore = Math.max(0, availabilityScore);

    // Determine availability status
    let availabilityStatus = 'available';
    if (availabilityScore < 30) {
      availabilityStatus = 'busy';
    } else if (availabilityScore < 60) {
      availabilityStatus = 'moderate';
    }

    res.json({
      success: true,
      workload: {
        activeCases: activeCasesCount,
        upcomingAppointments: upcomingAppointmentsCount,
        todayAppointments: todayAppointmentsCount,
        weekAppointments: weekAppointmentsCount,
        availabilityScore,
        availabilityStatus
      }
    });
  } catch (error) {
    console.error('Error fetching clinician workload:', error);
    res.status(500).json({
      message: 'Error fetching workload',
      error: error.message
    });
  }
};

module.exports = {
  getClinicianTasks,
  getClinicianWorkload
};
