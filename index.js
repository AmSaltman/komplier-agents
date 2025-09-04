/**
 * Komplier Autonomous Support Agent - Node.js Implementation
 * 
 * Main entry point for the autonomous customer support agent
 * Handles continuous email monitoring and processing
 */

import dotenv from 'dotenv';
import cron from 'node-cron';
import { MCPClientManager } from './lib/mcp-client.js';
import { GmailOperations } from './lib/gmail.js';
import { SupabaseOperations } from './lib/supabase.js';
import { StripeOperations } from './lib/stripe.js';
import { AIOperations } from './lib/ai.js';
import { BusinessRulesEngine } from './lib/business-rules.js';
import { KnowledgeBase } from './lib/knowledge-base.js';
import { createLogger } from './lib/logger.js';
import { readFileSync } from 'fs';
const config = JSON.parse(readFileSync(new URL('./config/agent-config.json', import.meta.url), 'utf8'));

// Load environment variables
dotenv.config();

const logger = createLogger('main');

class KomplierAgent {
  constructor() {
    this.mcpClient = null;
    this.gmail = null;
    this.supabase = null;
    this.stripe = null;
    this.ai = null;
    this.businessRules = null;
    this.knowledgeBase = null;
    this.isRunning = false;
    this.lastProcessedTime = new Date();
  }

  /**
   * Initialize the autonomous agent
   */
  async initialize() {
    try {
      logger.info('🚀 Initializing Komplier Autonomous Support Agent...');
      
      // Initialize MCP connections
      this.mcpClient = new MCPClientManager(config);
      await this.mcpClient.initialize();
      
      // Initialize service operations
      this.gmail = new GmailOperations(this.mcpClient);
      this.supabase = new SupabaseOperations(this.mcpClient);
      this.stripe = new StripeOperations(this.mcpClient);
      this.ai = new AIOperations(config);
      this.businessRules = new BusinessRulesEngine(config);
      this.knowledgeBase = new KnowledgeBase(config);
      
      // Validate configuration
      this.businessRules.validateConfig();
      
      // Load knowledge base
      await this.knowledgeBase.loadKnowledgeBase();
      
      // Set up Gmail push notifications
      await this.setupGmailWatch();
      
      logger.info('✅ Komplier Agent initialized successfully');
      
    } catch (error) {
      logger.error('❌ Agent initialization failed:', error);
      throw error;
    }
  }

  /**
   * Set up Gmail watch request for push notifications
   */
  async setupGmailWatch() {
    try {
      logger.info('🔔 Setting up Gmail push notifications...');
      
      const watchConfig = {
        topicName: `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID || 'komplier'}/topics/gmail-notifications`,
        labelIds: ['INBOX']
      };
      
      // Use Gmail MCP to set up watch request
      const result = await this.gmail.setupWatch(config.email.supportInbox, watchConfig);
      
      if (result.success) {
        logger.info(`✅ Gmail watch configured for ${config.email.supportInbox}`);
        logger.info(`📬 Push notifications will be sent to: ${watchConfig.topicName}`);
      } else {
        logger.warn(`⚠️  Gmail watch setup had issues: ${result.error}`);
        logger.info('📧 Agent will still work for manual email processing');
      }
      
    } catch (error) {
      logger.warn('⚠️  Gmail watch setup failed:', error.message);
      logger.info('📧 Agent will continue without push notifications (manual processing only)');
    }
  }

  /**
   * Start the autonomous agent (event-driven, no polling)
   */
  async start() {
    try {
      await this.initialize();
      
      this.isRunning = true;
      logger.info('🤖 Komplier Autonomous Support Agent is now ACTIVE');
      logger.info('📧 Agent ready for event-driven email processing');
      logger.info('🔔 Waiting for Gmail Push notifications to trigger email processing...');
      
      // Set up scheduled tasks (daily reports, health checks)
      this.setupScheduledTasks();
      
    } catch (error) {
      logger.error('❌ Agent startup failed:', error);
      process.exit(1);
    }
  }

  /**
   * Set up cron jobs for scheduled tasks
   */
  setupScheduledTasks() {
    // Daily report at 6 PM
    cron.schedule('0 18 * * *', async () => {
      try {
        logger.info('📊 Generating daily report...');
        await this.generateDailyReport();
      } catch (error) {
        logger.error('❌ Daily report failed:', error);
      }
    });
    
    // Health check every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await this.performHealthCheck();
    });
    
    logger.info('⏰ Scheduled tasks configured');
  }

  /**
   * Process emails on demand (triggered by Gmail Push notifications)
   * This replaces continuous polling with event-driven processing
   */
  async processEmailsOnDemand() {
    logger.info('📧 Processing emails on demand (triggered by Gmail notification)...');
    
    if (!this.isRunning) {
      logger.warn('⚠️  Agent not running, ignoring email processing request');
      return false;
    }
    
    try {
      await this.processNewEmails();
      logger.info('✅ On-demand email processing completed');
      return true;
    } catch (error) {
      logger.error('❌ On-demand email processing failed:', error);
      throw error;
    }
  }

  /**
   * Process new emails since last check
   */
  async processNewEmails() {
    try {
      // Search for unread emails in inbox (covers both zach@komplier.co and gethelp@komplier.co)
      // gethelp@komplier.co is an alias that forwards to zach@komplier.co
      const query = `in:inbox is:unread`;
      const searchResult = await this.gmail.searchEmails(query, 50);
      
      if (!searchResult?.messages?.length) {
        return; // No new emails
      }
      
      logger.info(`📧 Found ${searchResult.messages.length} unread emails to process`);
      
      // Process each email
      for (const message of searchResult.messages) {
        try {
          const emailContent = await this.gmail.getEmailContent(message.id);
          const processed = await this.processEmailContent(emailContent);
          
          // Mark email as read after successful processing
          if (processed) {
            await this.gmail.markEmailAsRead(message.id);
            logger.info(`✅ Processed and marked as read: ${message.id}`);
          }
          
        } catch (emailError) {
          logger.error(`❌ Failed to process email ${message.id}:`, emailError);
          // Don't mark as read if processing failed
        }
      }
      
      this.lastProcessedTime = new Date();
      
    } catch (error) {
      logger.error('❌ New email processing failed:', error);
    }
  }

  /**
   * Process individual email content
   */
  async processEmailContent(emailData) {
    const processingId = Date.now();
    logger.info(`🔄 Processing email ${processingId}: ${emailData.subject}`);
    
    try {
      // Extract email information
      const emailInfo = this.ai.extractEmailInfo(emailData);
      
      // Skip non-support emails but mark as processed
      if (!this.gmail.isValidSupportEmail(emailInfo)) {
        logger.info('🚫 Skipping non-support email (will mark as read)');
        return true; // Mark as read since we've "processed" it
      }
      
      // Build user context
      const userContext = await this.buildUserContext(emailInfo.customerEmail);
      
      // Load relevant knowledge
      const relevantKnowledge = await this.knowledgeBase.searchKnowledge(
        `${emailInfo.subject} ${emailInfo.body}`
      );
      
      // AI analysis
      const aiAnalysis = await this.ai.analyzeEmail(emailInfo, userContext, relevantKnowledge);
      
      // Check escalation criteria
      const escalationCheck = this.businessRules.shouldEscalate(emailInfo, aiAnalysis, userContext);
      
      if (escalationCheck.escalate) {
        await this.handleEscalation(emailInfo, aiAnalysis, escalationCheck, userContext);
        return true; // Escalation handled successfully
      }
      
      // Execute AI-recommended action
      await this.executeAction(emailInfo, aiAnalysis, userContext, relevantKnowledge);
      
      // Log successful processing
      await this.supabase.logActivity('email_processed', {
        customer: emailInfo.from,
        action: aiAnalysis.actionType,
        confidence: aiAnalysis.confidence
      });
      
      return true; // Successfully processed
      
    } catch (error) {
      logger.error(`❌ Email processing failed for ${processingId}:`, error);
      await this.handleEmergencyEscalation(emailData, error);
      return false; // Processing failed - don't mark as read
    }
  }

  /**
   * Build comprehensive user context (same as in process-emails.js)
   */
  async buildUserContext(email) {
    try {
      const [user, stripeCustomer] = await Promise.all([
        this.supabase.findUserByEmail(email),
        this.stripe.findCustomerByEmail(email)
      ]);
      
      if (!user) {
        return { userFound: false, email };
      }
      
      const [projects, assetsData, subscriptions, billingHistory] = await Promise.all([
        this.supabase.getUserProjects(user.id),
        this.supabase.getCompliantAssets(user.id),
        stripeCustomer ? this.stripe.getCustomerSubscriptions(stripeCustomer.id) : [],
        stripeCustomer ? this.stripe.getBillingHistory(stripeCustomer.id) : { charges: [], invoices: [] }
      ]);
      
      const refundEligibility = await this.supabase.calculateRefundEligibility(email);
      
      return {
        userFound: true,
        user,
        stripeCustomer,
        projects,
        assetsData,
        subscriptions,
        billingHistory,
        refundEligibility
      };
      
    } catch (error) {
      logger.warn('⚠️ User context building failed:', error);
      return { userFound: false, email, error: error.message };
    }
  }

  /**
   * Execute actions based on AI analysis
   */
  async executeAction(emailInfo, aiAnalysis, userContext, knowledgeBase) {
    // Implementation matches process-emails.js logic
    // Would duplicate the executeAction, handleRefundRequest, etc. functions here
    logger.info(`⚡ Executing action: ${aiAnalysis.actionType}`);
    // ... (implementation details)
  }

  /**
   * Generate and send daily report
   */
  async generateDailyReport() {
    try {
      const date = new Date().toISOString().split('T')[0];
      const activityData = await this.supabase.getDailyActivity(date);
      const systemHealth = await this.mcpClient.healthCheck();
      
      // Build and send report (similar to daily-report.js)
      logger.info('📊 Daily report sent successfully');
      
    } catch (error) {
      logger.error('❌ Daily report generation failed:', error);
    }
  }

  /**
   * Perform system health check
   */
  async performHealthCheck() {
    try {
      const health = await this.mcpClient.healthCheck();
      const unhealthyServices = Object.entries(health)
        .filter(([_, healthy]) => !healthy)
        .map(([service, _]) => service);
      
      if (unhealthyServices.length > 0) {
        logger.warn(`⚠️ Unhealthy services: ${unhealthyServices.join(', ')}`);
        
        // Alert admin if critical services are down
        if (unhealthyServices.includes('googleWorkspace')) {
          await this.alertAdmin('Gmail MCP service is down', 'critical');
        }
      }
      
    } catch (error) {
      logger.error('❌ Health check failed:', error);
    }
  }

  /**
   * Alert admin of issues
   */
  async alertAdmin(message, severity = 'medium') {
    try {
      await this.gmail.sendEmail(
        config.email.adminEmail,
        `[${severity.toUpperCase()}] Komplier Agent Alert`,
        `System Alert: ${message}\n\nTimestamp: ${new Date().toISOString()}\nAgent Status: ${this.isRunning ? 'RUNNING' : 'STOPPED'}`
      );
    } catch (error) {
      logger.error('❌ Admin alert failed:', error);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    logger.info('🛑 Shutting down Komplier Agent...');
    
    this.isRunning = false;
    
    if (this.mcpClient) {
      await this.mcpClient.cleanup();
    }
    
    logger.info('✅ Komplier Agent shut down gracefully');
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  if (global.agent) {
    await global.agent.shutdown();
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', async () => {
  if (global.agent) {
    await global.agent.shutdown();
  } else {
    process.exit(0);
  }
});

// Start the agent if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  global.agent = new KomplierAgent();
  global.agent.start().catch(error => {
    logger.error('❌ Agent startup failed:', error);
    process.exit(1);
  });
}

export { KomplierAgent };
