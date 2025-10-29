const cron = require('node-cron');
require('dotenv').config();

const NotificationService = require('./NotificationService');
const { supabaseAdmin } = require('../config/supabase.local');

class NotificationScheduler {
  constructor() {
    this.isRunning = false;
  }

  // Start the scheduler
  start() {
    if (this.isRunning) {
      console.log('📅 Notification scheduler is already running');
      return;
    }

    console.log('🚀 Starting notification scheduler...');
    
    // Run daily at 8:00 AM to check for today's appointments
    cron.schedule('0 8 * * *', async () => {
      console.log('⏰ Checking for appointments scheduled for today...');
      await this.sendTodaysAppointmentNotifications();
    });

    // Run every hour to check for appointments starting soon (within 1 hour)
    cron.schedule('0 * * * *', async () => {
      console.log('⏰ Checking for appointments starting soon...');
      await this.sendUpcomingAppointmentReminders();
    });

    this.isRunning = true;
    console.log('✅ Notification scheduler started successfully');
  }

  // Stop the scheduler
  stop() {
    if (!this.isRunning) {
      console.log('📅 Notification scheduler is not running');
      return;
    }

    cron.destroy();
    this.isRunning = false;
    console.log('🛑 Notification scheduler stopped');
  }

  // Send notifications for appointments scheduled for today
  async sendTodaysAppointmentNotifications() {
    try {
      if (!supabaseAdmin) {
        console.log('⏭️ Supabase not configured, skipping appointment notifications');
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      console.log(`📅 Checking appointments scheduled for ${today.toLocaleDateString()}`);

      // Find all appointments scheduled for today using Supabase
      const { data: todaysAppointments, error: appointmentsError } = await supabaseAdmin
        .from('appointments')
        .select(`
          id,
          scheduled_date,
          status,
          appointment_type,
          duration,
          location,
          telehealth_info,
          worker_id,
          clinician_id,
          case_id,
          worker:worker_id(id, first_name, last_name, email),
          clinician:clinician_id(id, first_name, last_name, email),
          case:case_id(case_number)
        `)
        .gte('scheduled_date', today.toISOString())
        .lt('scheduled_date', tomorrow.toISOString())
        .in('status', ['scheduled', 'confirmed']);

      if (appointmentsError) {
        throw appointmentsError;
      }

      console.log(`📊 Found ${todaysAppointments?.length || 0} appointments scheduled for today`);

      if (!todaysAppointments || todaysAppointments.length === 0) {
        console.log('ℹ️ No appointments found for today');
        return;
      }

      // Prepare batch notifications
      const notifications = [];

      for (const appointment of todaysAppointments) {
        const appointmentTime = new Date(appointment.scheduled_date);
        const timeString = appointmentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Check if notification was already sent today for this appointment
        const { data: existingNotifications } = await supabaseAdmin
          .from('notifications')
          .select('id')
          .in('recipient_id', [appointment.worker_id, appointment.clinician_id])
          .eq('related_appointment_id', appointment.id)
          .in('type', ['appointment_reminder', 'zoom_meeting_reminder'])
          .gte('created_at', today.toISOString())
          .limit(1);

        if (existingNotifications && existingNotifications.length > 0) {
          console.log(`⏭️  Notification already sent today for appointment ${appointment.id}`);
          continue;
        }
        
        const isZoomMeeting = appointment.location === 'telehealth' && appointment.telehealth_info?.zoom_meeting;
        const worker = appointment.worker;
        const clinician = appointment.clinician;
        const caseData = appointment.case;
        
        // Add worker notification to batch
        if (appointment.worker_id) {
          notifications.push({
            recipient_id: appointment.worker_id,
            type: isZoomMeeting ? 'zoom_meeting_reminder' : 'appointment_reminder',
            title: isZoomMeeting ? '🔗 Zoom Meeting Today' : '📅 Appointment Today',
            message: isZoomMeeting 
              ? `You have a Zoom meeting scheduled for today at ${timeString}. Please join 5 minutes before the scheduled time.`
              : `You have an appointment scheduled for today at ${timeString}. Please arrive 10 minutes early.`,
            priority: 'high',
            action_url: '/appointments',
            related_appointment_id: appointment.id,
            related_case_id: appointment.case_id
          });
        }

        // Add clinician notification to batch
        if (appointment.clinician_id && worker) {
          notifications.push({
            recipient_id: appointment.clinician_id,
            type: isZoomMeeting ? 'zoom_meeting_reminder' : 'appointment_reminder',
            title: isZoomMeeting ? '🔗 Zoom Meeting Today' : '📅 Appointment Today',
            message: isZoomMeeting 
              ? `You have a Zoom meeting with ${worker.first_name} ${worker.last_name} scheduled for today at ${timeString}.`
              : `You have an appointment with ${worker.first_name} ${worker.last_name} scheduled for today at ${timeString}.`,
            priority: 'high',
            action_url: '/appointments',
            related_appointment_id: appointment.id,
            related_case_id: appointment.case_id
          });
        }
      }

      // Send batch notifications if any
      if (notifications.length > 0) {
        await NotificationService.createBatchNotifications(notifications);
        console.log(`✅ Sent ${notifications.length} notifications for appointments scheduled for today`);
      } else {
        console.log('ℹ️ No notifications to send for today\'s appointments');
      }
      
    } catch (error) {
      console.error('❌ Error sending today\'s appointment notifications:', error);
    }
  }

  // Send reminders for appointments starting soon (within 1 hour)
  async sendUpcomingAppointmentReminders() {
    try {
      if (!supabaseAdmin) {
        console.log('⏭️ Supabase not configured, skipping appointment reminders');
        return;
      }

      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

      // Find appointments starting within the next hour using Supabase
      const { data: upcomingAppointments, error: appointmentsError } = await supabaseAdmin
        .from('appointments')
        .select(`
          id,
          scheduled_date,
          status,
          appointment_type,
          duration,
          location,
          telehealth_info,
          worker_id,
          clinician_id,
          case_id,
          worker:worker_id(id, first_name, last_name, email),
          clinician:clinician_id(id, first_name, last_name, email),
          case:case_id(case_number)
        `)
        .gte('scheduled_date', now.toISOString())
        .lte('scheduled_date', oneHourFromNow.toISOString())
        .in('status', ['scheduled', 'confirmed']);

      if (appointmentsError) {
        throw appointmentsError;
      }

      if (!upcomingAppointments || upcomingAppointments.length === 0) {
        return;
      }

      // Prepare batch notifications
      const notifications = [];

      for (const appointment of upcomingAppointments) {
        const appointmentTime = new Date(appointment.scheduled_date);
        const timeUntilAppointment = Math.round((appointmentTime - now) / (1000 * 60)); // minutes
        
        if (timeUntilAppointment <= 60 && timeUntilAppointment > 0) {
          const isZoomMeeting = appointment.location === 'telehealth' && appointment.telehealth_info?.zoom_meeting;
          const worker = appointment.worker;
          const clinician = appointment.clinician;
          
          // Add worker notification to batch
          if (appointment.worker_id) {
            notifications.push({
              recipient_id: appointment.worker_id,
              type: isZoomMeeting ? 'zoom_meeting_reminder' : 'appointment_reminder',
              title: isZoomMeeting ? '🔗 Zoom Meeting Starting Soon' : '📅 Appointment Starting Soon',
              message: isZoomMeeting 
                ? `Your Zoom meeting starts in ${timeUntilAppointment} minutes. Please join now.`
                : `Your appointment starts in ${timeUntilAppointment} minutes. Please prepare to arrive.`,
              priority: 'urgent',
              action_url: '/appointments',
              related_appointment_id: appointment.id,
              related_case_id: appointment.case_id
            });
          }

          // Add clinician notification to batch
          if (appointment.clinician_id && worker) {
            notifications.push({
              recipient_id: appointment.clinician_id,
              type: isZoomMeeting ? 'zoom_meeting_reminder' : 'appointment_reminder',
              title: isZoomMeeting ? '🔗 Zoom Meeting Starting Soon' : '📅 Appointment Starting Soon',
              message: isZoomMeeting 
                ? `Your Zoom meeting with ${worker.first_name} ${worker.last_name} starts in ${timeUntilAppointment} minutes.`
                : `Your appointment with ${worker.first_name} ${worker.last_name} starts in ${timeUntilAppointment} minutes.`,
              priority: 'urgent',
              action_url: '/appointments',
              related_appointment_id: appointment.id,
              related_case_id: appointment.case_id
            });
          }
        }
      }

      // Send batch notifications if any
      if (notifications.length > 0) {
        await NotificationService.createBatchNotifications(notifications);
        console.log(`⏰ Sent ${notifications.length} upcoming appointment reminders`);
      }
      
    } catch (error) {
      console.error('❌ Error sending upcoming appointment reminders:', error);
    }
  }

  // Manual trigger for testing
  async triggerTodaysNotifications() {
    console.log('🧪 Manually triggering today\'s appointment notifications...');
    await this.sendTodaysAppointmentNotifications();
  }

  async triggerUpcomingReminders() {
    console.log('🧪 Manually triggering upcoming reminders...');
    await this.sendUpcomingAppointmentReminders();
  }
}

module.exports = new NotificationScheduler();