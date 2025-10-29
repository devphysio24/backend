// Skip MongoDB imports - using Supabase only
let Notification, User, Case, CheckIn, RehabilitationPlan;
try {
  if (process.env.NODE_ENV !== 'production' && process.env.USE_SUPABASE !== 'true') {
    Notification = require('../models/Notification');
    User = require('../models/User');
    Case = require('../models/Case');
    CheckIn = require('../models/CheckIn');
    RehabilitationPlan = require('../models/RehabilitationPlan');
  } else {
    Notification = {};
    User = {};
    Case = {};
    CheckIn = {};
    RehabilitationPlan = {};
  }
} catch (error) {
  Notification = {};
  User = {};
  Case = {};
  CheckIn = {};
  RehabilitationPlan = {};
}

// Smart notification service
class SmartNotificationService {
  
  // Check for missed check-ins and send reminders
  static async checkMissedCheckIns() {
    try {
      console.log('🔔 Checking for missed check-ins...');
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Find active cases
      const activeCases = await Case.find({
        status: { $in: ['assessed', 'in_rehab'] }
      }).populate('worker', 'firstName lastName email');
      
      const notifications = [];
      
      for (const caseDoc of activeCases) {
        // Check if worker has checked in today
        const todaysCheckIn = await CheckIn.findOne({
          case: caseDoc._id,
          checkInDate: { $gte: today }
        });
        
        if (!todaysCheckIn) {
          // Check if we already sent a reminder today
          const existingNotification = await Notification.findOne({
            user: caseDoc.worker._id,
            case: caseDoc._id,
            type: 'check_in_reminder',
            createdAt: { $gte: today }
          });
          
          if (!existingNotification) {
            notifications.push({
              user: caseDoc.worker._id,
              type: 'check_in_reminder',
              title: 'Daily Check-in Reminder',
              message: `Hi ${caseDoc.worker.firstName}, please complete your daily check-in for case ${caseDoc.caseNumber}`,
              case: caseDoc._id,
              isRead: false,
              priority: 'medium'
            });
          }
        }
      }
      
      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
        console.log(`✅ Sent ${notifications.length} check-in reminders`);
      } else {
        console.log('✅ No missed check-ins found');
      }
      
    } catch (error) {
      console.error('❌ Error checking missed check-ins:', error);
    }
  }
  
  // Check for overdue cases and send alerts
  static async checkOverdueCases() {
    try {
      console.log('🔔 Checking for overdue cases...');
      
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      // Find cases that haven't been updated in 7 days
      const overdueCases = await Case.find({
        status: { $in: ['new', 'triaged', 'assessed'] },
        updatedAt: { $lt: sevenDaysAgo }
      }).populate(['caseManager', 'clinician', 'worker'], 'firstName lastName email');
      
      const notifications = [];
      
      for (const caseDoc of overdueCases) {
        // Notify case manager
        if (caseDoc.caseManager) {
          notifications.push({
            user: caseDoc.caseManager._id,
            type: 'overdue_case',
            title: 'Overdue Case Alert',
            message: `Case ${caseDoc.caseNumber} has not been updated in 7 days and requires attention`,
            case: caseDoc._id,
            isRead: false,
            priority: 'high'
          });
        }
        
        // Notify clinician if assigned
        if (caseDoc.clinician) {
          notifications.push({
            user: caseDoc.clinician._id,
            type: 'overdue_case',
            title: 'Overdue Case Alert',
            message: `Case ${caseDoc.caseNumber} requires your attention - no updates in 7 days`,
            case: caseDoc._id,
            isRead: false,
            priority: 'high'
          });
        }
      }
      
      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
        console.log(`✅ Sent ${notifications.length} overdue case alerts`);
      } else {
        console.log('✅ No overdue cases found');
      }
      
    } catch (error) {
      console.error('❌ Error checking overdue cases:', error);
    }
  }
  
  // Check for rehabilitation plan milestones
  static async checkRehabMilestones() {
    try {
      console.log('🔔 Checking for rehabilitation milestones...');
      
      const activePlans = await RehabilitationPlan.find({
        status: 'active'
      }).populate('worker', 'firstName lastName email');
      
      const notifications = [];
      
      for (const plan of activePlans) {
        // Check for consecutive completion milestones
        const consecutiveDays = plan.progressStats.consecutiveCompletedDays;
        
        if (consecutiveDays === 5 || consecutiveDays === 10 || 
            consecutiveDays === 15 || consecutiveDays === 30) {
          
          // Check if we already sent notification for this milestone
          const existingNotification = await Notification.findOne({
            user: plan.worker._id,
            type: 'rehab_milestone',
            'metadata.milestone': `${consecutiveDays}_days`,
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
          });
          
          if (!existingNotification) {
            let message = '';
            let emoji = '';
            
            switch (consecutiveDays) {
              case 5:
                emoji = '🎉';
                message = `${emoji} Amazing! You've completed all exercises for 5 consecutive days! Your dedication to recovery is inspiring.`;
                break;
              case 10:
                emoji = '🌟';
                message = `${emoji} Outstanding! 10 consecutive days of completed exercises! You're building incredible momentum.`;
                break;
              case 15:
                emoji = '🏆';
                message = `${emoji} Phenomenal! 15 consecutive days! You've developed a strong recovery routine.`;
                break;
              case 30:
                emoji = '🎊';
                message = `${emoji} Incredible! A full month of consecutive exercise completion! You've transformed your recovery into a powerful habit.`;
                break;
            }
            
            notifications.push({
              user: plan.worker._id,
              type: 'rehab_milestone',
              title: `${consecutiveDays}-Day Streak Achievement!`,
              message: message,
              case: plan.case,
              isRead: false,
              priority: 'low',
              metadata: {
                milestone: `${consecutiveDays}_days`,
                consecutiveDays: consecutiveDays
              }
            });
          }
        }
      }
      
      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
        console.log(`✅ Sent ${notifications.length} milestone notifications`);
      } else {
        console.log('✅ No new milestones found');
      }
      
    } catch (error) {
      console.error('❌ Error checking rehab milestones:', error);
    }
  }
  
  // Check for upcoming appointments
  static async checkUpcomingAppointments() {
    try {
      console.log('🔔 Checking for upcoming appointments...');
      
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      
      const dayAfterTomorrow = new Date();
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      dayAfterTomorrow.setHours(0, 0, 0, 0);
      
      // This would require Appointment model - for now, just log
      console.log('✅ Appointment reminder check completed (Appointment model needed)');
      
    } catch (error) {
      console.error('❌ Error checking upcoming appointments:', error);
    }
  }
  
  // Run all smart notification checks
  static async runAllChecks() {
    try {
      console.log('🚀 Running all smart notification checks...');
      
      await Promise.all([
        this.checkMissedCheckIns(),
        this.checkOverdueCases(),
        this.checkRehabMilestones(),
        this.checkUpcomingAppointments()
      ]);
      
      console.log('✅ All smart notification checks completed');
      
    } catch (error) {
      console.error('❌ Error running smart notification checks:', error);
    }
  }
  
  // Send custom notification to specific user
  static async sendCustomNotification(userId, title, message, type = 'info', priority = 'medium', caseId = null) {
    try {
      const notification = new Notification({
        user: userId,
        type: type,
        title: title,
        message: message,
        case: caseId,
        isRead: false,
        priority: priority
      });
      
      await notification.save();
      console.log(`✅ Custom notification sent to user ${userId}`);
      
      return notification;
      
    } catch (error) {
      console.error('❌ Error sending custom notification:', error);
      throw error;
    }
  }
  
  // Get notification statistics
  static async getNotificationStats() {
    try {
      const stats = await Notification.aggregate([
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            unread: { $sum: { $cond: ['$isRead', 0, 1] } }
          }
        },
        { $sort: { count: -1 } }
      ]);
      
      return stats;
      
    } catch (error) {
      console.error('❌ Error getting notification stats:', error);
      return [];
    }
  }
}

module.exports = SmartNotificationService;
