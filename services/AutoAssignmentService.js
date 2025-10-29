// Skip MongoDB imports - using Supabase only
let User, Case, Notification;
try {
  if (process.env.NODE_ENV !== 'production' && process.env.USE_SUPABASE !== 'true') {
    User = require('../models/User');
    Case = require('../models/Case');
    Notification = require('../models/Notification');
  } else {
    User = {};
    Case = {};
    Notification = {};
  }
} catch (error) {
  User = {};
  Case = {};
  Notification = {};
}

// Auto-assignment service for cases
class AutoAssignmentService {
  
  // Auto-assign case manager based on workload
  static async autoAssignCaseManager(caseData) {
    try {
      console.log('🤖 Auto-assigning case manager...');
      
      // Get all active case managers
      const caseManagers = await User.find({ 
        role: 'case_manager', 
        isActive: true 
      }).select('_id firstName lastName');
      
      if (caseManagers.length === 0) {
        throw new Error('No available case managers');
      }
      
      // Get workload for each case manager
      const workloads = await Promise.all(
        caseManagers.map(async (manager) => {
          const activeCases = await Case.countDocuments({
            caseManager: manager._id,
            status: { $in: ['new', 'triaged', 'assessed', 'in_rehab'] }
          });
          
          return {
            managerId: manager._id,
            managerName: `${manager.firstName} ${manager.lastName}`,
            workload: activeCases
          };
        })
      );
      
      // Sort by workload (ascending) and assign to least busy manager
      workloads.sort((a, b) => a.workload - b.workload);
      const assignedManager = workloads[0];
      
      console.log(`✅ Auto-assigned case manager: ${assignedManager.managerName} (workload: ${assignedManager.workload})`);
      
      return assignedManager.managerId;
      
    } catch (error) {
      console.error('❌ Error in auto-assignment:', error);
      throw error;
    }
  }
  
  // Auto-assign clinician based on specialty and availability
  static async autoAssignClinician(caseData) {
    try {
      console.log('🤖 Auto-assigning clinician...');
      
      // Get all available clinicians
      const clinicians = await User.find({ 
        role: 'clinician', 
        isActive: true,
        isAvailable: true
      }).select('_id firstName lastName specialty');
      
      if (clinicians.length === 0) {
        console.log('⚠️ No available clinicians, will assign manually later');
        return null;
      }
      
      // Try to match by specialty if injury details are available
      let matchedClinicians = clinicians;
      
      if (caseData.injuryDetails && caseData.injuryDetails.bodyPart) {
        const bodyPart = caseData.injuryDetails.bodyPart.toLowerCase();
        
        // Simple specialty matching based on body part
        if (bodyPart.includes('back') || bodyPart.includes('spine')) {
          matchedClinicians = clinicians.filter(c => 
            c.specialty && c.specialty.toLowerCase().includes('orthopedic')
          );
        } else if (bodyPart.includes('hand') || bodyPart.includes('wrist')) {
          matchedClinicians = clinicians.filter(c => 
            c.specialty && c.specialty.toLowerCase().includes('hand')
          );
        } else if (bodyPart.includes('knee') || bodyPart.includes('leg')) {
          matchedClinicians = clinicians.filter(c => 
            c.specialty && c.specialty.toLowerCase().includes('sports')
          );
        }
        
        // If no specialty match, use all clinicians
        if (matchedClinicians.length === 0) {
          matchedClinicians = clinicians;
        }
      }
      
      // Get workload for matched clinicians
      const workloads = await Promise.all(
        matchedClinicians.map(async (clinician) => {
          const activeCases = await Case.countDocuments({
            clinician: clinician._id,
            status: { $in: ['triaged', 'assessed', 'in_rehab'] }
          });
          
          return {
            clinicianId: clinician._id,
            clinicianName: `${clinician.firstName} ${clinician.lastName}`,
            specialty: clinician.specialty,
            workload: activeCases
          };
        })
      );
      
      // Sort by workload and assign to least busy clinician
      workloads.sort((a, b) => a.workload - b.workload);
      const assignedClinician = workloads[0];
      
      console.log(`✅ Auto-assigned clinician: ${assignedClinician.clinicianName} (${assignedClinician.specialty}, workload: ${assignedClinician.workload})`);
      
      return assignedClinician.clinicianId;
      
    } catch (error) {
      console.error('❌ Error in clinician auto-assignment:', error);
      return null; // Don't throw error, just return null for manual assignment
    }
  }
  
  // Auto-assign priority based on severity and incident type
  static autoAssignPriority(caseData) {
    try {
      console.log('🤖 Auto-assigning priority...');
      
      const severity = caseData.injuryDetails?.severity;
      const incidentType = caseData.incident?.incidentType;
      
      let priority = 'medium'; // Default priority
      
      // High priority conditions
      if (severity === 'severe' || 
          incidentType === 'fatality' ||
          incidentType === 'lost_time') {
        priority = 'urgent';
      }
      // Medium-high priority
      else if (severity === 'moderate' || 
               incidentType === 'medical_treatment') {
        priority = 'high';
      }
      // Low priority
      else if (severity === 'minor' || 
               incidentType === 'near_miss' ||
               incidentType === 'first_aid') {
        priority = 'low';
      }
      
      console.log(`✅ Auto-assigned priority: ${priority} (severity: ${severity}, incident: ${incidentType})`);
      
      return priority;
      
    } catch (error) {
      console.error('❌ Error in priority auto-assignment:', error);
      return 'medium'; // Default fallback
    }
  }
  
  // Send notification to assigned users
  static async sendAssignmentNotification(caseId, assignedUsers, caseData) {
    try {
      console.log('📧 Sending assignment notifications...');
      
      const notifications = [];
      
      // Notify case manager
      if (assignedUsers.caseManager) {
        notifications.push({
          user: assignedUsers.caseManager,
          type: 'case_assigned',
          title: 'New Case Assigned',
          message: `You have been assigned to manage case ${caseData.caseNumber}`,
          case: caseId,
          isRead: false
        });
      }
      
      // Notify clinician
      if (assignedUsers.clinician) {
        notifications.push({
          user: assignedUsers.clinician,
          type: 'case_assigned',
          title: 'New Case Assigned',
          message: `You have been assigned as clinician for case ${caseData.caseNumber}`,
          case: caseId,
          isRead: false
        });
      }
      
      // Notify worker
      if (caseData.worker) {
        notifications.push({
          user: caseData.worker,
          type: 'case_created',
          title: 'New Case Created',
          message: `A rehabilitation case has been created for you. Case number: ${caseData.caseNumber} - ${caseData.workerName || 'Worker'}`,
          case: caseId,
          isRead: false
        });
      }
      
      // Create notifications
      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
        console.log(`✅ Sent ${notifications.length} assignment notifications`);
      }
      
    } catch (error) {
      console.error('❌ Error sending notifications:', error);
      // Don't throw error, notifications are not critical
    }
  }
  
  // Complete auto-assignment process
  static async performAutoAssignment(caseData) {
    try {
      console.log('🚀 Starting complete auto-assignment process...');
      
      const assignments = {
        caseManager: null,
        clinician: null,
        priority: 'medium'
      };
      
      // Auto-assign case manager
      assignments.caseManager = await this.autoAssignCaseManager(caseData);
      
      // Auto-assign clinician
      assignments.clinician = await this.autoAssignClinician(caseData);
      
      // Auto-assign priority
      assignments.priority = this.autoAssignPriority(caseData);
      
      console.log('✅ Auto-assignment completed:', assignments);
      
      return assignments;
      
    } catch (error) {
      console.error('❌ Error in auto-assignment process:', error);
      throw error;
    }
  }
}

module.exports = AutoAssignmentService;
