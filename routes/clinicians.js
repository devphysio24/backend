const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
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
const { getClinicianTasks, getClinicianWorkload } = require('../controllers/clinicianTaskController');
const { getActivityMonitor } = require('../controllers/activityMonitorController');

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// @route   GET /api/clinicians/tasks
// @desc    Get clinician tasks (cases and appointments)
// @access  Private (Clinician only)
router.get('/tasks', [
  authMiddleware,
  roleMiddleware('clinician')
], asyncHandler(getClinicianTasks));

// @route   GET /api/clinicians/workload
// @desc    Get clinician workload summary
// @access  Private (Clinician only)
router.get('/workload', [
  authMiddleware,
  roleMiddleware('clinician')
], asyncHandler(getClinicianWorkload));

// @route   GET /api/clinicians/activity-monitor
// @desc    Get activity monitor data for clinician
// @access  Private (Clinician only)
router.get('/activity-monitor', [
  authMiddleware,
  roleMiddleware('clinician')
], asyncHandler(getActivityMonitor));

// @route   GET /api/clinicians/available
// @desc    Get available clinicians with their current workload
// @access  Private (Case Manager, Admin)
router.get('/available', [
  authMiddleware,
  roleMiddleware('case_manager', 'admin')
], asyncHandler(async (req, res) => {
  const clinicians = await User.find({ 
    role: 'clinician', 
    isActive: true 
  }).select('firstName lastName email phone specialty');

  // Get workload for each clinician
  const cliniciansWithWorkload = await Promise.all(
    clinicians.map(async (clinician) => {
      // Count active cases
      const activeCases = await Case.countDocuments({
        clinician: clinician._id,
        status: { $in: ['triaged', 'assessed', 'in_rehab'] }
      });

      // Count upcoming appointments today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const appointmentsToday = await Appointment.countDocuments({
        clinician: clinician._id,
        scheduledDate: { $gte: today, $lt: tomorrow },
        status: { $in: ['scheduled', 'confirmed'] }
      });

      // Count appointments this week
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);

      const appointmentsThisWeek = await Appointment.countDocuments({
        clinician: clinician._id,
        scheduledDate: { $gte: weekStart, $lt: weekEnd },
        status: { $in: ['scheduled', 'confirmed'] }
      });

      // Calculate availability score (0-100, higher is more available)
      let availabilityScore = 100;
      
      // Reduce score based on active cases
      availabilityScore -= activeCases * 10;
      
      // Reduce score based on today's appointments
      availabilityScore -= appointmentsToday * 5;
      
      // Reduce score based on this week's appointments
      availabilityScore -= Math.floor(appointmentsThisWeek / 2);
      
      // Ensure score doesn't go below 0
      availabilityScore = Math.max(0, availabilityScore);

      // Determine availability status
      let availabilityStatus = 'available';
      if (availabilityScore < 30) {
        availabilityStatus = 'busy';
      } else if (availabilityScore < 60) {
        availabilityStatus = 'moderate';
      }

      return {
        ...clinician.toObject(),
        workload: {
          activeCases,
          appointmentsToday,
          appointmentsThisWeek,
          availabilityScore,
          availabilityStatus
        }
      };
    })
  );

  // Sort by availability score (most available first)
  cliniciansWithWorkload.sort((a, b) => b.workload.availabilityScore - a.workload.availabilityScore);

  res.json({
    message: 'Available clinicians retrieved successfully',
    clinicians: cliniciansWithWorkload
  });
}));

// @route   GET /api/clinicians/:id/workload
// @desc    Get detailed workload for a specific clinician
// @access  Private (Case Manager, Admin, Clinician)
router.get('/:id/workload', [
  authMiddleware,
  roleMiddleware('case_manager', 'admin', 'clinician')
], asyncHandler(async (req, res) => {
  const clinicianId = req.params.id;
  
  // Verify clinician exists
  const clinician = await User.findById(clinicianId);
  if (!clinician || clinician.role !== 'clinician') {
    return res.status(404).json({ message: 'Clinician not found' });
  }

  // Check if user can access this clinician's workload
  if (req.user.role === 'clinician' && req.user._id.toString() !== clinicianId) {
    return res.status(403).json({ message: 'Access denied' });
  }

  // Get active cases
  const activeCases = await Case.find({
    clinician: clinicianId,
    status: { $in: ['triaged', 'assessed', 'in_rehab'] }
  }).populate('worker', 'firstName lastName').populate('incident', 'incidentNumber');

  // Get upcoming appointments
  const upcomingAppointments = await Appointment.find({
    clinician: clinicianId,
    scheduledDate: { $gte: new Date() },
    status: { $in: ['scheduled', 'confirmed'] }
  })
  .populate('worker', 'firstName lastName')
  .populate('case', 'caseNumber')
  .sort({ scheduledDate: 1 })
  .limit(10);

  // Get recent appointments (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentAppointments = await Appointment.find({
    clinician: clinicianId,
    scheduledDate: { $gte: sevenDaysAgo, $lt: new Date() },
    status: { $in: ['completed', 'cancelled'] }
  })
  .populate('worker', 'firstName lastName')
  .populate('case', 'caseNumber')
  .sort({ scheduledDate: -1 })
  .limit(10);

  res.json({
    message: 'Clinician workload retrieved successfully',
    clinician: {
      _id: clinician._id,
      firstName: clinician.firstName,
      lastName: clinician.lastName,
      email: clinician.email,
      specialty: clinician.specialty
    },
    workload: {
      activeCases,
      upcomingAppointments,
      recentAppointments,
      totalActiveCases: activeCases.length,
      totalUpcomingAppointments: upcomingAppointments.length
    }
  });
}));

// @route   PUT /api/clinicians/:id/availability
// @desc    Update clinician availability status
// @access  Private (Clinician, Admin)
router.put('/:id/availability', [
  authMiddleware,
  roleMiddleware('clinician', 'admin'),
  body('isAvailable').isBoolean().withMessage('Availability status must be boolean'),
  body('reason').optional().isString().withMessage('Reason must be string'),
  handleValidationErrors
], asyncHandler(async (req, res) => {
  const clinicianId = req.params.id;
  
  // Check if user can update this clinician's availability
  if (req.user.role === 'clinician' && req.user._id.toString() !== clinicianId) {
    return res.status(403).json({ message: 'Access denied' });
  }

  // Verify clinician exists
  const clinician = await User.findById(clinicianId);
  if (!clinician || clinician.role !== 'clinician') {
    return res.status(404).json({ message: 'Clinician not found' });
  }

  // Update availability
  clinician.isAvailable = req.body.isAvailable;
  if (req.body.reason) {
    clinician.availabilityReason = req.body.reason;
  }
  clinician.lastAvailabilityUpdate = new Date();

  await clinician.save();

  res.json({
    message: 'Clinician availability updated successfully',
    clinician: {
      _id: clinician._id,
      firstName: clinician.firstName,
      lastName: clinician.lastName,
      isAvailable: clinician.isAvailable,
      availabilityReason: clinician.availabilityReason,
      lastAvailabilityUpdate: clinician.lastAvailabilityUpdate
    }
  });
}));

// @route   GET /api/clinicians
// @desc    Get all clinicians
// @access  Private (Case Manager, Admin)
router.get('/', [
  authMiddleware,
  roleMiddleware('case_manager', 'admin')
], asyncHandler(async (req, res) => {
  const clinicians = await User.find({ 
    role: 'clinician', 
    isActive: true 
  }).select('firstName lastName email phone specialty isAvailable availabilityReason lastAvailabilityUpdate');

  res.json({
    message: 'Clinicians retrieved successfully',
    clinicians
  });
}));

module.exports = router;


