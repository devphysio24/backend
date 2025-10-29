const axios = require('axios');

// Load environment variables explicitly
try {
  require('dotenv').config({ path: './env.supabase' });
  console.log('📝 Environment loaded from env.supabase');
} catch (error) {
  console.warn('⚠️ Could not load env.supabase');
}

/**
 * OpenAI Service - Handles AI-powered analysis and report generation
 */
class OpenAIService {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.apiUrl = 'https://api.openai.com/v1/chat/completions';
    
    console.log('🔑 OpenAI API Key Status:', this.apiKey ? 'PRESENT ✅' : 'MISSING ❌');
    console.log('🔑 API Key starts with:', this.apiKey ? this.apiKey.substring(0, 15) + '...' : 'N/A');
    
    if (!this.apiKey) {
      console.warn('⚠️ OPENAI_API_KEY not found in environment variables');
    }
  }

  /**
   * Generate system flow analysis report using OpenAI
   * @param {Object} systemData - The system data to analyze
   * @returns {Object} Analysis report with insights and recommendations
   */
  async generateSystemFlowReport(systemData) {
    try {
      if (!this.apiKey) {
        throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in environment variables.');
      }

      console.log('🤖 Starting OpenAI AI analysis...');

      // Prepare the prompt for OpenAI
      const prompt = this.buildAnalysisPrompt(systemData);

      // Call OpenAI API
      const response = await axios.post(
        this.apiUrl,
        {
          model: 'gpt-3.5-turbo', // Using cheaper model (6-10x cheaper than GPT-4)
          messages: [
            {
              role: 'system',
              content: 'You are an expert system analyst specializing in occupational rehabilitation and work readiness systems. Analyze the provided system data and provide actionable insights, recommendations, and key metrics. Always provide detailed, professional analysis.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.7,
          max_tokens: 2000, // Increased for better analysis
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000, // 60 seconds timeout
        }
      );

      console.log('✅ OpenAI AI analysis completed successfully');

      // Extract and parse the response
      const aiResponse = response.data.choices[0].message.content;
      const parsed = this.parseAIResponse(aiResponse, systemData);
      
      // Mark as AI-generated
      parsed.isAIGenerated = true;
      parsed.timestamp = new Date().toISOString();
      
      return parsed;

    } catch (error) {
      console.error('❌ OpenAI error:', error.message);
      console.error('❌ Error details:', error.response?.data || error.message);
      
      // NO FALLBACK - Throw error instead
      if (error.response?.status === 401) {
        throw new Error('Invalid OpenAI API key. Please check your OPENAI_API_KEY.');
      } else if (error.response?.status === 429) {
        throw new Error('OpenAI rate limit exceeded. Please try again in a few minutes.');
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Unable to connect to OpenAI API. Please check your internet connection.');
      } else {
        throw new Error('OpenAI API error: ' + (error.message || 'Unknown error'));
      }
    }
  }

  /**
   * Build the analysis prompt for OpenAI
   */
  buildAnalysisPrompt(systemData) {
    const { statistics, analytics, teamKPI, workReadinessStats, caseStats } = systemData;

    // Build REAL work readiness data summary
    let workReadinessSummary = '';
    if (workReadinessStats) {
      workReadinessSummary = `
REAL WORK READINESS DATA (Actual Performance):
- Total Assignments: ${workReadinessStats.totalAssigned || 0}
- COMPLETED Assessments: ${workReadinessStats.completed || 0}
- PENDING Assessments: ${workReadinessStats.pending || 0}
- OVERDUE Assessments: ${workReadinessStats.overdue || 0}
- Completion Rate: ${workReadinessStats.completionRate || 0}%
- Pending Rate: ${workReadinessStats.pendingPercentage || 0}%

CRITICAL ANALYSIS NEEDED:
${workReadinessStats.pending > workReadinessStats.completed ? 
  '⚠️ MORE PENDING than COMPLETED - System has low completion rate.' : 
  workReadinessStats.pending > 0 ? 
  '⚠️ Some pending assessments - need to monitor completion.' : 
  '✅ Good completion rate.'}
${workReadinessStats.overdue > 0 ? `⚠️ ${workReadinessStats.overdue} OVERDUE assignments need immediate attention.` : ''}
`;
    } else {
      workReadinessSummary = '\nWORK READINESS DATA: No data available.';
    }

    // Build case data summary
    let caseSummary = '';
    if (caseStats) {
      caseSummary = `
CASE MANAGEMENT DATA (Rehabilitation Cases):
- Total Cases: ${caseStats.total || 0}
- ✅ COMPLETED Cases: ${caseStats.completed || 0} (closed status)
- 🔄 OPEN Cases: ${caseStats.open || 0} (active/triaged/assessed/in_rehab/return_to_work)
- Completion Rate: ${caseStats.completedRate || 0}%

CRITICAL ANALYSIS NEEDED:
${caseStats.open > caseStats.completed ? 
  `⚠️ More OPEN (${caseStats.open}) than COMPLETED (${caseStats.completed}) cases - workflow backlog detected.` : 
  caseStats.open > 0 ? 
  `✅ More completed (${caseStats.completed}) than open (${caseStats.open}) cases - good workflow.` : 
  '⚠️ No cases in system.'}
`;
    } else {
      caseSummary = '\nCASE MANAGEMENT DATA: No data available.';
    }

    // Build team KPI summary if available
    let teamKPISummary = '';
    if (teamKPI && Array.isArray(teamKPI) && teamKPI.length > 0) {
      const teamsWithKPI = teamKPI.length;
      const totalAssessments = teamKPI.reduce((sum, kpi) => sum + (kpi.totalAssessments || 0), 0);
      const avgCompletionRate = teamKPI.reduce((sum, kpi) => sum + (kpi.completionRate || 0), 0) / teamsWithKPI;
      const onTimeSubmissions = teamKPI.reduce((sum, kpi) => sum + (kpi.onTimeSubmissions || 0), 0);
      
      teamKPISummary = `
TEAM KPI TRACKING DATA:
- Teams with KPI tracking: ${teamsWithKPI}
- Total assessments: ${totalAssessments}
- Average completion rate: ${avgCompletionRate.toFixed(1)}%
- On-time submissions: ${onTimeSubmissions}
- Key teams: ${teamKPI.slice(0, 3).map(kpi => `${kpi.teamName || 'Team'} (${kpi.completionRate || 0}% completion)`).join(', ')}
`;
    } else {
      teamKPISummary = '\nTEAM KPI TRACKING: No team KPI data available at this time.';
    }

    return `Analyze this Occupational Rehabilitation Work Readiness System and provide a comprehensive report.

SYSTEM DATA:
- Total Users: ${statistics?.totalUsers || 0}
- Active Cases: ${statistics?.activeCases || 0}
- Closed Cases: ${statistics?.closedCases || 0}
- Total Appointments: ${statistics?.totalAppointments || 0}
- System Health: ${statistics?.systemHealth || 0}%

User Distribution:
- Workers: ${statistics?.roleCounts?.workers || 0}
- Clinicians: ${statistics?.roleCounts?.clinicians || 0}
- Case Managers: ${statistics?.roleCounts?.managers || 0}
- Site Supervisors: ${statistics?.roleCounts?.supervisors || 0}
- Team Leaders: ${statistics?.roleCounts?.teamLeaders || 0}
${workReadinessSummary}
${caseSummary}
${teamKPISummary}

CASE FLOW:
1. Incident Reporting → Case Creation → Assessment → Rehabilitation Plan → Check-ins → Return to Work
2. Cases go through: new → triaged → assessed → in_rehab → return_to_work → closed

KEY FEATURES:
- Real-time work readiness assessments
- Automated case assignment
- KPI tracking and performance metrics
- Daily check-in system
- Appointment management
- Multi-team analytics
- Notification system

CRITICAL ANALYSIS REQUIRED:
- Analyze the REAL work readiness data (completed vs pending vs overdue)
- If PENDING > COMPLETED, identify the root cause (low engagement, system issues, etc.)
- If there are OVERDUE assignments, recommend immediate actions
- Focus on actual performance issues, not just general observations
- Provide data-driven insights based on the real numbers shown above

Please provide:
1. A concise executive summary highlighting the main issue (based on REAL data)
2. At least 3 key insights based on ACTUAL data patterns (completed vs pending vs overdue)
3. At least 3 actionable recommendations to improve completion rates
4. Key metrics to monitor based on the real work readiness stats

Format your response as JSON with this structure:
{
  "summary": "Executive summary text",
  "insights": ["insight 1", "insight 2", "insight 3"],
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"],
  "keyMetrics": [
    {"label": "Metric Name", "value": "Metric Value"},
    {"label": "Metric Name", "value": "Metric Value"}
  ]
}`;
  }

  /**
   * Parse AI response and structure it
   */
  parseAIResponse(aiResponse, systemData) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || aiResponse,
          insights: parsed.insights || [],
          recommendations: parsed.recommendations || [],
          keyMetrics: parsed.keyMetrics || this.generateDefaultMetrics(systemData),
        };
      }
    } catch (error) {
      console.warn('Failed to parse AI JSON response, using fallback');
    }

    // Fallback: Generate structured response from text
    return {
      summary: aiResponse.substring(0, 200) + '...',
      insights: [
        'System is operational with active case management',
        'User engagement across multiple roles',
        'Real-time data collection and reporting enabled',
      ],
      recommendations: [
        'Monitor case resolution times for efficiency',
        'Ensure appointment scheduling optimization',
        'Review notification system for user engagement',
      ],
      keyMetrics: this.generateDefaultMetrics(systemData),
    };
  }

  /**
   * Generate default metrics from system data
   */
  generateDefaultMetrics(systemData) {
    const { statistics, analytics } = systemData;

    return [
      { label: 'Active Cases', value: `${statistics?.activeCases || 0}` },
      { label: 'Total Users', value: `${statistics?.totalUsers || 0}` },
      { label: 'System Health', value: `${statistics?.systemHealth || 0}%` },
      { label: 'Case Resolution', value: `${statistics?.closedCases || 0}` },
      { label: 'Total Appointments', value: `${statistics?.totalAppointments || 0}` },
      { label: 'Storage Used', value: statistics?.storageUsed || 'N/A' },
    ];
  }

  /**
   * Generate fallback report without OpenAI
   */
  generateFallbackReport(systemData) {
    const { statistics } = systemData;
    
    const totalUsers = statistics?.totalUsers || 0;
    const activeCases = statistics?.activeCases || 0;
    const closedCases = statistics?.closedCases || 0;
    const totalAppointments = statistics?.totalAppointments || 0;
    const systemHealth = statistics?.systemHealth || 0;
    
    // Calculate insights based on data
    const insights = [];
    const recommendations = [];
    
    if (totalUsers > 0) {
      insights.push(`System is actively managing ${totalUsers} users across multiple roles`);
    } else {
      insights.push('System is set up and ready for user onboarding');
    }
    
    if (activeCases > 0) {
      insights.push(`${activeCases} cases currently in active rehabilitation workflow`);
      recommendations.push('Monitor case progress to ensure timely return-to-work outcomes');
    }
    
    if (closedCases > 0) {
      insights.push(`${closedCases} cases successfully completed`);
      recommendations.push('Review closed cases for best practices and workflow optimization');
    }
    
    if (totalAppointments > 0) {
      insights.push('Appointment scheduling system is operational with active bookings');
    } else {
      recommendations.push('Encourage clinicians to schedule regular appointment check-ins');
    }
    
    if (systemHealth >= 95) {
      insights.push('System health is excellent with minimal issues detected');
    } else {
      recommendations.push('Monitor system performance metrics for optimal operation');
    }
    
    // Add default recommendations
    recommendations.push('Continue monitoring real-time assessments and case progress');
    recommendations.push('Ensure regular training for case managers and clinicians');
    recommendations.push('Review notification system effectiveness for user engagement');
    
    return {
      summary: `The Work Readiness System is currently ${systemHealth >= 90 ? 'operating smoothly' : 'functional'} with ${totalUsers} active users managing ${activeCases} active cases. The system provides comprehensive occupational rehabilitation management with real-time monitoring capabilities.`,
      insights: insights.length > 0 ? insights : [
        'System is operational with active case management',
        'User engagement across multiple roles',
        'Real-time data collection and reporting enabled',
      ],
      recommendations: recommendations.length > 0 ? recommendations : [
        'Monitor case resolution times for efficiency',
        'Ensure appointment scheduling optimization',
        'Review notification system for user engagement',
      ],
      keyMetrics: this.generateDefaultMetrics(systemData),
    };
  }

  /**
   * Test OpenAI connection
   */
  async testConnection() {
    try {
      if (!this.apiKey) {
        return { success: false, error: 'API key not configured' };
      }

      const response = await axios.post(
        this.apiUrl,
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Test connection' }],
          max_tokens: 10,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return { success: true, response: response.data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new OpenAIService();

