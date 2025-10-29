const openAIService = require('../services/OpenAIService');

/**
 * Generate system flow analysis report
 * @route POST /api/admin/generate-flow-report
 * @access Admin only
 */
const generateFlowReport = async (req, res) => {
  try {
    console.log('🤖 Generating system flow report...');
    console.log('📊 Request body keys:', Object.keys(req.body));

    const { systemData } = req.body;

    if (!systemData) {
      console.error('❌ No system data provided');
      return res.status(400).json({
        error: 'System data is required',
      });
    }

    console.log('📊 System data received:', {
      hasStatistics: !!systemData.statistics,
      hasAnalytics: !!systemData.analytics,
    });

    // Generate report using OpenAI (or fallback)
    const report = await openAIService.generateSystemFlowReport(systemData);

    console.log('✅ System flow report generated successfully');

    res.status(200).json({
      success: true,
      report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error generating flow report:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      error: error.message || 'Failed to generate system flow report',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

/**
 * Test OpenAI connection
 * @route GET /api/admin/test-openai
 * @access Admin only
 */
const testOpenAI = async (req, res) => {
  try {
    console.log('🤖 Testing OpenAI connection...');

    const result = await openAIService.testConnection();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
      });
    }

    res.status(200).json({
      success: true,
      message: 'OpenAI connection successful',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error testing OpenAI:', error);
    res.status(500).json({
      error: error.message || 'Failed to test OpenAI connection',
    });
  }
};

module.exports = {
  generateFlowReport,
  testOpenAI,
};

