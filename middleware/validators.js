const { body, param, query, validationResult } = require('express-validator');

// ========================================
// COMMON VALIDATION MIDDLEWARE
// ========================================

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg,
        value: err.value
      }))
    });
  }
  next();
};

// ========================================
// REUSABLE VALIDATORS
// ========================================

// MongoDB ObjectId validator
const isMongoId = (field) => 
  param(field).isMongoId().withMessage(`Invalid ${field} ID format`);

const isMongoIdBody = (field) => 
  body(field).isMongoId().withMessage(`Invalid ${field} ID format`);

// Email validator
const validateEmail = body('email')
  .isEmail()
  .normalizeEmail()
  .withMessage('Please provide a valid email address');

// Password validator (for registration/password change)
const validatePassword = body('password')
  .isLength({ min: 12 })
  .withMessage('Password must be at least 12 characters long')
  .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
  .withMessage('Password must contain uppercase, lowercase, number, and special character');

// Phone validator
const validatePhone = body('phone')
  .optional()
  .matches(/^[\d\s\-\+\(\)]+$/)
  .withMessage('Invalid phone number format');

// Date validator
const validateDate = (field) => 
  body(field)
    .isISO8601()
    .toDate()
    .withMessage(`Invalid ${field} date format`);

// ========================================
// AUTH VALIDATORS
// ========================================

const validateLogin = [
  validateEmail,
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors
];

const validateRegister = [
  body('firstName').trim().notEmpty().withMessage('First name is required')
    .isLength({ min: 2, max: 50 }).withMessage('First name must be 2-50 characters'),
  body('lastName').trim().notEmpty().withMessage('Last name is required')
    .isLength({ min: 2, max: 50 }).withMessage('Last name must be 2-50 characters'),
  validateEmail,
  validatePassword,
  body('role').isIn(['admin', 'worker', 'employer', 'site_supervisor', 'clinician', 'case_manager', 'gp_insurer'])
    .withMessage('Invalid role'),
  validatePhone,
  handleValidationErrors
];

// ========================================
// USER VALIDATORS
// ========================================

const validateUserCreate = [
  body('firstName').trim().notEmpty().withMessage('First name is required')
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('First name contains invalid characters'),
  body('lastName').trim().notEmpty().withMessage('Last name is required')
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('Last name contains invalid characters'),
  validateEmail,
  validatePassword,
  body('role').isIn(['admin', 'worker', 'employer', 'site_supervisor', 'clinician', 'case_manager', 'gp_insurer'])
    .withMessage('Valid role is required'),
  validatePhone,
  body('employer').optional().isMongoId().withMessage('Invalid employer ID'),
  body('specialty').optional().isString().isLength({ max: 100 }),
  body('licenseNumber').optional().isString().isLength({ max: 50 }),
  handleValidationErrors
];

const validateUserUpdate = [
  isMongoId('id'),
  body('firstName').optional().trim().notEmpty()
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('First name contains invalid characters'),
  body('lastName').optional().trim().notEmpty()
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('Last name contains invalid characters'),
  body('email').optional().isEmail().normalizeEmail(),
  validatePhone,
  body('isActive').optional().isBoolean(),
  handleValidationErrors
];

// ========================================
// INCIDENT VALIDATORS
// ========================================

const validateIncident = [
  isMongoIdBody('worker'),
  validateDate('incidentDate'),
  body('incidentType')
    .isIn(['slip_fall', 'struck_by', 'struck_against', 'overexertion', 'cut_laceration', 'burn', 'crush', 'other'])
    .withMessage('Invalid incident type'),
  body('severity')
    .isIn(['near_miss', 'first_aid', 'medical_treatment', 'lost_time', 'fatality'])
    .withMessage('Invalid severity level'),
  body('description')
    .trim()
    .notEmpty().withMessage('Description is required')
    .isLength({ min: 10, max: 1000 }).withMessage('Description must be 10-1000 characters'),
  body('location.site').optional().isString().isLength({ max: 100 }),
  body('location.department').optional().isString().isLength({ max: 100 }),
  body('location.specificLocation').optional().isString().isLength({ max: 200 }),
  body('immediateCause').optional().isString().isLength({ max: 500 }),
  body('rootCause').optional().isString().isLength({ max: 500 }),
  handleValidationErrors
];

// ========================================
// CASE VALIDATORS
// ========================================

const validateCaseCreate = [
  isMongoIdBody('incident'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('injuryDetails.bodyPart').notEmpty().withMessage('Body part is required'),
  body('injuryDetails.injuryType').notEmpty().withMessage('Injury type is required'),
  body('injuryDetails.severity').isIn(['minor', 'moderate', 'severe']).withMessage('Invalid severity'),
  body('injuryDetails.description').optional().isString().isLength({ max: 500 }),
  body('workRestrictions.lifting.maxWeight').optional().isNumeric().isInt({ min: 0, max: 100 }),
  body('workRestrictions.standing.maxDuration').optional().isNumeric().isInt({ min: 0, max: 24 }),
  body('workRestrictions.sitting.maxDuration').optional().isNumeric().isInt({ min: 0, max: 24 }),
  body('expectedReturnDate').optional().isISO8601().toDate(),
  handleValidationErrors
];

const validateCaseUpdate = [
  isMongoId('id'),
  body('status').optional().isIn(['new', 'triaged', 'assessed', 'in_rehab', 'return_to_work', 'closed']),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('clinician').optional().isMongoId(),
  body('expectedReturnDate').optional().isISO8601().toDate(),
  body('actualReturnDate').optional().isISO8601().toDate(),
  handleValidationErrors
];

// ========================================
// APPOINTMENT VALIDATORS
// ========================================

const validateAppointment = [
  isMongoIdBody('case'),
  isMongoIdBody('clinician'),
  isMongoIdBody('worker'),
  body('appointmentType')
    .isIn(['assessment', 'treatment', 'follow_up', 'consultation', 'telehealth'])
    .withMessage('Invalid appointment type'),
  validateDate('scheduledDate'),
  body('duration').optional().isInt({ min: 15, max: 480 }).withMessage('Duration must be 15-480 minutes'),
  body('location').optional().isIn(['clinic', 'telehealth', 'workplace', 'home']),
  body('purpose').optional().isString().isLength({ max: 200 }),
  handleValidationErrors
];

// ========================================
// CHECK-IN VALIDATORS
// ========================================

const validateCheckIn = [
  isMongoIdBody('case'),
  body('painLevel.current').isInt({ min: 0, max: 10 }).withMessage('Pain level must be 0-10'),
  body('painLevel.worst').optional().isInt({ min: 0, max: 10 }),
  body('painLevel.average').optional().isInt({ min: 0, max: 10 }),
  body('functionalStatus.sleep').optional().isInt({ min: 0, max: 10 }),
  body('functionalStatus.mood').optional().isInt({ min: 0, max: 10 }),
  body('functionalStatus.energy').optional().isInt({ min: 0, max: 10 }),
  body('functionalStatus.mobility').optional().isInt({ min: 0, max: 10 }),
  body('medicationCompliance.taken').optional().isBoolean(),
  body('exerciseCompliance.completed').optional().isBoolean(),
  body('workStatus.workedToday').optional().isBoolean(),
  body('workStatus.hoursWorked').optional().isInt({ min: 0, max: 24 }),
  handleValidationErrors
];

// ========================================
// REHABILITATION PLAN VALIDATORS
// ========================================

const validateRehabPlan = [
  isMongoIdBody('case'),
  isMongoIdBody('createdBy'),
  body('goals').isArray({ min: 1 }).withMessage('At least one goal is required'),
  body('goals.*.goal').notEmpty().withMessage('Goal description is required'),
  body('goals.*.targetDate').isISO8601().toDate(),
  body('exercises').isArray().withMessage('Exercises must be an array'),
  body('exercises.*.name').notEmpty().withMessage('Exercise name is required'),
  body('exercises.*.sets').optional().isInt({ min: 1, max: 20 }),
  body('exercises.*.reps').optional().isInt({ min: 1, max: 100 }),
  body('exercises.*.duration').optional().isInt({ min: 1, max: 120 }),
  body('exercises.*.frequency').optional().isString(),
  body('status').optional().isIn(['draft', 'active', 'completed', 'cancelled']),
  handleValidationErrors
];

// ========================================
// ASSESSMENT VALIDATORS
// ========================================

const validateAssessment = [
  isMongoIdBody('case'),
  isMongoIdBody('assessor'),
  body('assessmentType')
    .isIn(['initial', 'progress', 'return_to_work', 'discharge'])
    .withMessage('Invalid assessment type'),
  body('physicalExam.rangeOfMotion').optional().isObject(),
  body('physicalExam.strength').optional().isObject(),
  body('functionalAssessment.lifting').optional().isInt({ min: 0, max: 100 }),
  body('functionalAssessment.carrying').optional().isInt({ min: 0, max: 100 }),
  body('functionalAssessment.pushing').optional().isInt({ min: 0, max: 100 }),
  body('recommendations').optional().isArray(),
  handleValidationErrors
];

// ========================================
// NOTIFICATION VALIDATORS
// ========================================

const validateNotification = [
  isMongoIdBody('recipient'),
  body('type')
    .isIn(['incident_reported', 'case_assigned', 'case_created', 'check_in_reminder', 
           'overdue_case', 'appointment_reminder', 'rehab_milestone'])
    .withMessage('Invalid notification type'),
  body('title').notEmpty().isLength({ max: 100 }),
  body('message').notEmpty().isLength({ max: 500 }),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  handleValidationErrors
];

// ========================================
// QUERY VALIDATORS
// ========================================

const validatePagination = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 10000 }).toInt(), // Increased max limit
  query('offset').optional().isInt({ min: 0 }).toInt(), // Added offset validation
  query('includeCount').optional().isIn(['true', 'false']), // Added includeCount validation
  query('teamLeaderId').optional().isString(), // Added teamLeaderId validation
  query('sort').optional().isString(),
  query('order').optional().isIn(['asc', 'desc']),
  handleValidationErrors
];

const validateDateRange = [
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
  handleValidationErrors
];

// ========================================
// SANITIZATION HELPERS
// ========================================

const sanitizeHtml = (field) => 
  body(field).customSanitizer(value => {
    if (typeof value !== 'string') return value;
    // Remove any HTML tags
    return value.replace(/<[^>]*>/g, '');
  });

const sanitizeFilename = (field) =>
  body(field).customSanitizer(value => {
    if (typeof value !== 'string') return value;
    // Remove path traversal attempts
    return value.replace(/[\/\\\.\.]/g, '');
  });

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Core middleware
  handleValidationErrors,
  
  // Auth validators
  validateLogin,
  validateRegister,
  
  // User validators
  validateUserCreate,
  validateUserUpdate,
  
  // Incident validators
  validateIncident,
  
  // Case validators
  validateCaseCreate,
  validateCaseUpdate,
  
  // Appointment validators
  validateAppointment,
  
  // Check-in validators
  validateCheckIn,
  
  // Rehabilitation plan validators
  validateRehabPlan,
  
  // Assessment validators
  validateAssessment,
  
  // Notification validators
  validateNotification,
  
  // Query validators
  validatePagination,
  validateDateRange,
  
  // Reusable validators
  isMongoId,
  isMongoIdBody,
  validateEmail,
  validatePassword,
  validatePhone,
  validateDate,
  
  // Sanitization
  sanitizeHtml,
  sanitizeFilename
};
