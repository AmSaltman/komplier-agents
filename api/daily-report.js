/**
 * Daily Report API Endpoint
 * 
 * Generates and sends daily activity reports to admin
 * Can be triggered manually or via cron
 */

import { MCPClientManager } from '../lib/mcp-client.js';
import { GmailOperations } from '../lib/gmail.js';
import { SupabaseOperations } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import config from '../config/agent-config.json' assert { type: 'json' };

const logger = createLogger('daily-report');

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { date, force } = req.body;
      const reportDate = date || new Date().toISOString().split('T')[0];
      
      const report = await generateDailyReport(reportDate, force);
      
      return res.status(200).json({
        success: true,
        report,
        date: reportDate
      });
      
    } else if (req.method === 'GET') {
      // Get report without sending
      const reportDate = req.query.date || new Date().toISOString().split('T')[0];
      const report = await generateDailyReport(reportDate, false);
      
      return res.status(200).json({
        report,
        date: reportDate
      });
      
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
  } catch (error) {
    logger.error('❌ Daily report endpoint error:', error);
    return res.status(500).json({
      error: 'Report generation failed',
      message: error.message
    });
  }
}

/**
 * Generate comprehensive daily activity report
 */
async function generateDailyReport(date, sendEmail = true) {
  try {
    logger.info(`📊 Generating daily report for: ${date}`);
    
    // Initialize services if needed
    if (!mcpClient) {
      await initializeServices();
    }
    
    // Get activity data
    const activityData = await supabase.getDailyActivity(date);
    const systemHealth = await mcpClient.healthCheck();
    
    // Build report sections
    const report = {
      date,
      summary: buildSummarySection(activityData),
      details: buildDetailsSection(activityData),
      systemStatus: buildSystemSection(systemHealth),
      metrics: buildMetricsSection(activityData)
    };
    
    // Send email report if requested
    if (sendEmail) {
      await sendReportEmail(report);
    }
    
    logger.info('✅ Daily report generated successfully');
    return report;
    
  } catch (error) {
    logger.error('❌ Daily report generation failed:', error);
    throw error;
  }
}

/**
 * Initialize services for report generation
 */
async function initializeServices() {
  const mcpClient = new MCPClientManager(config);
  await mcpClient.initialize();
  
  const gmail = new GmailOperations(mcpClient);
  const supabase = new SupabaseOperations(mcpClient);
}

/**
 * Build summary section of report
 */
function buildSummarySection(activityData) {
  const totals = {
    emails_processed: 0,
    refunds_processed: 0,
    help_provided: 0,
    escalated: 0
  };
  
  activityData.forEach(activity => {
    if (totals.hasOwnProperty(activity.activity_type)) {
      totals[activity.activity_type] += activity.count;
    }
  });
  
  return {
    totalEmails: totals.emails_processed,
    refundsProcessed: totals.refunds_processed,
    helpProvided: totals.help_provided,
    escalated: totals.escalated,
    automationRate: totals.emails_processed > 0 
      ? ((totals.refunds_processed + totals.help_provided) / totals.emails_processed * 100).toFixed(1)
      : '0'
  };
}

/**
 * Build detailed section of report
 */
function buildDetailsSection(activityData) {
  return activityData.map(activity => ({
    type: activity.activity_type,
    count: activity.count,
    details: activity.details ? JSON.parse(activity.details) : null
  }));
}

/**
 * Build system status section
 */
function buildSystemSection(systemHealth) {
  const services = Object.entries(systemHealth);
  const healthyCount = services.filter(([_, healthy]) => healthy).length;
  
  return {
    overallStatus: healthyCount === services.length ? 'healthy' : 'degraded',
    services: systemHealth,
    healthPercentage: (healthyCount / services.length * 100).toFixed(1)
  };
}

/**
 * Build metrics section
 */
function buildMetricsSection(activityData) {
  const emailsProcessed = activityData.find(a => a.activity_type === 'emails_processed')?.count || 0;
  const escalated = activityData.find(a => a.activity_type === 'escalated')?.count || 0;
  
  return {
    automationSuccessRate: emailsProcessed > 0 
      ? ((emailsProcessed - escalated) / emailsProcessed * 100).toFixed(1)
      : '100',
    averageResponseTime: 'N/A', // Could be calculated if timing data is stored
    customerSatisfaction: 'N/A'  // Could be calculated from follow-up emails
  };
}

/**
 * Send report via email
 */
async function sendReportEmail(report) {
  try {
    const subject = `Komplier AI Agent Daily Report - ${report.date}`;
    const body = formatReportEmail(report);
    
    await gmail.sendEmail(
      config.email.adminEmail,
      subject,
      body
    );
    
    logger.info('✅ Daily report email sent');
    
  } catch (error) {
    logger.error('❌ Report email sending failed:', error);
    throw error;
  }
}

/**
 * Format report for email
 */
function formatReportEmail(report) {
  return `Komplier AI Agent Daily Report
Date: ${report.date}

SUMMARY
=======
Emails Processed: ${report.summary.totalEmails}
Refunds Processed: ${report.summary.refundsProcessed}
Help Responses: ${report.summary.helpProvided}
Escalated: ${report.summary.escalated}
Automation Rate: ${report.summary.automationRate}%

SYSTEM STATUS
============
Overall: ${report.systemStatus.overallStatus.toUpperCase()}
Service Health: ${report.systemStatus.healthPercentage}%

Services:
- Gmail: ${report.systemStatus.services.googleWorkspace ? 'HEALTHY' : 'DEGRADED'}
- Supabase: ${report.systemStatus.services.supabase ? 'HEALTHY' : 'DEGRADED'}  
- Stripe: ${report.systemStatus.services.stripe ? 'HEALTHY' : 'DEGRADED'}

METRICS
=======
Automation Success: ${report.metrics.automationSuccessRate}%
Average Response Time: ${report.metrics.averageResponseTime}
Customer Satisfaction: ${report.metrics.customerSatisfaction}

DETAILED ACTIVITY
================
${report.details.map(detail => 
  `${detail.type}: ${detail.count} occurrences`
).join('\n')}

---
Generated by Komplier AI Agent
${new Date().toISOString()}`;
}
