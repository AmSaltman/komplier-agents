/**
 * Email Processing API Endpoint
 * 
 * Main workflow for processing incoming customer emails:
 * 1. Receive email (webhook or manual trigger)
 * 2. Look up customer in Supabase
 * 3. Analyze with AI
 * 4. Apply business rules
 * 5. Execute actions (refund, response, escalation)
 */

import { MCPClientManager } from '../lib/mcp-client.js';
import { GmailOperations } from '../lib/gmail.js';
import { SupabaseOperations } from '../lib/supabase.js';
import { StripeOperations } from '../lib/stripe.js';
import { AIOperations } from '../lib/ai.js';
import { BusinessRulesEngine } from '../lib/business-rules.js';
import { KnowledgeBase } from '../lib/knowledge-base.js';
import { createLogger } from '../lib/logger.js';
import config from '../config/agent-config.json' assert { type: 'json' };

const logger = createLogger('email-processor');

// Initialize services
let mcpClient, gmail, supabase, stripe, ai, businessRules, knowledgeBase;

export default async function handler(req, res) {
  try {
    // Initialize services if not already done
    if (!mcpClient) {
      await initializeServices();
    }

    if (req.method === 'POST') {
      // Process incoming email
      const { email, trigger } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: 'Email data required' });
      }
      
      const result = await processEmail(email);
      return res.status(200).json(result);
      
    } else if (req.method === 'GET') {
      // Health check
      const health = await mcpClient.healthCheck();
      return res.status(200).json({ 
        status: 'healthy', 
        services: health,
        timestamp: new Date().toISOString()
      });
      
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
  } catch (error) {
    logger.error('❌ Email processing endpoint error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

/**
 * Initialize all services
 */
async function initializeServices() {
  logger.info('🚀 Initializing email processing services...');
  
  mcpClient = new MCPClientManager(config);
  await mcpClient.initialize();
  
  gmail = new GmailOperations(mcpClient);
  supabase = new SupabaseOperations(mcpClient);
  stripe = new StripeOperations(mcpClient);
  ai = new AIOperations(config);
  businessRules = new BusinessRulesEngine(config);
  knowledgeBase = new KnowledgeBase(config);
  
  // Validate business rules
  businessRules.validateConfig();
  
  logger.info('✅ All services initialized');
}

/**
 * Main email processing workflow
 */
async function processEmail(emailData) {
  const processingId = Date.now();
  logger.info(`📧 Processing email ${processingId}: ${emailData.subject}`);
  
  try {
    // Step 1: Extract email information
    const emailInfo = ai.extractEmailInfo(emailData);
    
    // Step 2: Check if valid support email
    if (!gmail.isValidSupportEmail(emailInfo)) {
      logger.info('🚫 Skipping non-support email');
      return { action: 'ignored', reason: 'Not a support email' };
    }
    
    // Step 3: Look up customer context
    const userContext = await buildUserContext(emailInfo.customerEmail);
    
    // Step 4: Load relevant knowledge
    const relevantKnowledge = await knowledgeBase.searchKnowledge(
      `${emailInfo.subject} ${emailInfo.body}`
    );
    
    // Step 5: AI analysis
    const aiAnalysis = await ai.analyzeEmail(emailInfo, userContext, relevantKnowledge);
    
    // Step 6: Check escalation criteria
    const escalationCheck = businessRules.shouldEscalate(emailInfo, aiAnalysis, userContext);
    
    if (escalationCheck.escalate) {
      return await handleEscalation(emailInfo, aiAnalysis, escalationCheck, userContext);
    }
    
    // Step 7: Execute AI-recommended action
    return await executeAction(emailInfo, aiAnalysis, userContext, relevantKnowledge);
    
  } catch (error) {
    logger.error(`❌ Email processing failed for ${processingId}:`, error);
    
    // Emergency escalation
    await handleEmergencyEscalation(emailData, error);
    
    return {
      action: 'error_escalated',
      error: error.message,
      processingId
    };
  }
}

/**
 * Build comprehensive user context
 */
async function buildUserContext(email) {
  try {
    const [user, stripeCustomer] = await Promise.all([
      supabase.findUserByEmail(email),
      stripe.findCustomerByEmail(email)
    ]);
    
    if (!user) {
      return { userFound: false, email };
    }
    
    const [projects, assetsData, subscriptions, billingHistory] = await Promise.all([
      supabase.getUserProjects(user.id),
      supabase.getCompliantAssets(user.id),
      stripeCustomer ? stripe.getCustomerSubscriptions(stripeCustomer.id) : [],
      stripeCustomer ? stripe.getBillingHistory(stripeCustomer.id) : { charges: [], invoices: [] }
    ]);
    
    const refundEligibility = await supabase.calculateRefundEligibility(email);
    
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
 * Execute the AI-recommended action
 */
async function executeAction(emailInfo, aiAnalysis, userContext, knowledgeBase) {
  const { actionType } = aiAnalysis;
  
  logger.info(`⚡ Executing action: ${actionType}`);
  
  switch (actionType) {
    case 'refund':
      return await handleRefundRequest(emailInfo, aiAnalysis, userContext);
      
    case 'help_response':
      return await handleHelpRequest(emailInfo, aiAnalysis, userContext, knowledgeBase);
      
    case 'general_info':
      return await handleGeneralInfo(emailInfo, aiAnalysis, knowledgeBase);
      
    default:
      logger.warn(`⚠️ Unknown action type: ${actionType}`);
      return await handleEscalation(emailInfo, aiAnalysis, { escalate: true, reasons: ['Unknown action type'] }, userContext);
  }
}

/**
 * Handle refund requests
 */
async function handleRefundRequest(emailInfo, aiAnalysis, userContext) {
  try {
    logger.info('💰 Processing refund request...');
    
    // Evaluate refund eligibility
    const refundDecision = businessRules.evaluateRefundRequest(
      userContext, 
      aiAnalysis.refundAmount
    );
    
    if (refundDecision.autoApprove) {
      // Process automatic refund
      const refundResult = await stripe.processRefund(
        userContext.stripeCustomer.id,
        refundDecision.amount,
        'AI agent auto-approved refund'
      );
      
      // Send confirmation email
      const responseText = await ai.generateResponse(emailInfo, {
        ...aiAnalysis,
        refundProcessed: true,
        refundAmount: refundDecision.amount / 100
      }, userContext);
      
      await gmail.sendEmail(
        emailInfo.from,
        emailInfo.subject,
        responseText,
        emailInfo
      );
      
      // Log activity
      await supabase.logActivity('refund_processed', {
        customer: emailInfo.from,
        amount: refundDecision.amount,
        automatic: true
      });
      
      return {
        action: 'refund_processed',
        amount: refundDecision.amount,
        reasoning: refundDecision.reasoning
      };
      
    } else {
      // Escalate for manual review
      return await handleEscalation(emailInfo, aiAnalysis, {
        escalate: true,
        reasons: ['Refund requires manual approval'],
        priority: 'high'
      }, userContext);
    }
    
  } catch (error) {
    logger.error('❌ Refund handling failed:', error);
    throw error;
  }
}

/**
 * Handle help/support requests
 */
async function handleHelpRequest(emailInfo, aiAnalysis, userContext, knowledgeBase) {
  try {
    logger.info('🆘 Processing help request...');
    
    // Generate helpful response
    const responseText = await ai.generateResponse(emailInfo, aiAnalysis, userContext, knowledgeBase);
    
    // Send response
    await gmail.sendEmail(
      emailInfo.from,
      emailInfo.subject,
      responseText,
      emailInfo
    );
    
    // Log activity
    await supabase.logActivity('help_provided', {
      customer: emailInfo.from,
      category: aiAnalysis.category || 'general',
      knowledgeUsed: aiAnalysis.knowledgeUsed || []
    });
    
    return {
      action: 'help_provided',
      category: aiAnalysis.category,
      confidence: aiAnalysis.confidence
    };
    
  } catch (error) {
    logger.error('❌ Help request handling failed:', error);
    throw error;
  }
}

/**
 * Handle general information requests
 */
async function handleGeneralInfo(emailInfo, aiAnalysis, knowledgeBase) {
  try {
    logger.info('ℹ️ Processing general info request...');
    
    const responseText = await ai.generateResponse(emailInfo, aiAnalysis, null, knowledgeBase);
    
    await gmail.sendEmail(
      emailInfo.from,
      emailInfo.subject,
      responseText,
      emailInfo
    );
    
    await supabase.logActivity('info_provided', {
      customer: emailInfo.from,
      topic: aiAnalysis.topic || 'general'
    });
    
    return {
      action: 'info_provided',
      topic: aiAnalysis.topic
    };
    
  } catch (error) {
    logger.error('❌ General info handling failed:', error);
    throw error;
  }
}

/**
 * Handle escalation to human support
 */
async function handleEscalation(emailInfo, aiAnalysis, escalationCheck, userContext) {
  try {
    logger.info(`🚨 Escalating email: ${escalationCheck.reasons.join(', ')}`);
    
    // Send admin notification
    const adminSubject = `[ESCALATED] ${emailInfo.subject}`;
    const adminBody = `Customer support escalation:

FROM: ${emailInfo.from}
SUBJECT: ${emailInfo.subject}
ESCALATION REASONS: ${escalationCheck.reasons.join(', ')}
PRIORITY: ${escalationCheck.priority || 'medium'}

ORIGINAL EMAIL:
${emailInfo.body}

AI ANALYSIS:
${JSON.stringify(aiAnalysis, null, 2)}

USER CONTEXT:
${JSON.stringify(userContext, null, 2)}

Please review and respond manually.`;
    
    await gmail.sendEmail(
      config.email.adminEmail,
      adminSubject,
      adminBody
    );
    
    // Send customer acknowledgment
    const customerResponse = `Hi there,

Thank you for contacting Komplier support. I've received your message about "${emailInfo.subject}" and I'm reviewing it carefully.

A team member will get back to you shortly with a detailed response.

Best regards,
Komplier Support Team`;
    
    await gmail.sendEmail(
      emailInfo.from,
      emailInfo.subject,
      customerResponse,
      emailInfo
    );
    
    // Log escalation
    await supabase.logActivity('escalated', {
      customer: emailInfo.from,
      reasons: escalationCheck.reasons,
      priority: escalationCheck.priority
    });
    
    return {
      action: 'escalated',
      reasons: escalationCheck.reasons,
      priority: escalationCheck.priority
    };
    
  } catch (error) {
    logger.error('❌ Escalation handling failed:', error);
    throw error;
  }
}

/**
 * Emergency escalation for system errors
 */
async function handleEmergencyEscalation(emailData, error) {
  try {
    const emergencySubject = `[SYSTEM ERROR] Email processing failed`;
    const emergencyBody = `Critical: Email processing system error

EMAIL DETAILS:
From: ${emailData.from}
Subject: ${emailData.subject}

ERROR:
${error.message}

STACK:
${error.stack}

Please review system status and respond to customer manually.`;
    
    // Try to send admin alert (may also fail)
    await gmail.sendEmail(
      config.email.adminEmail,
      emergencySubject,
      emergencyBody
    );
    
  } catch (emergencyError) {
    logger.error('❌ Emergency escalation failed:', emergencyError);
    // Log to console as last resort
    console.error('CRITICAL ERROR: Both email processing and emergency escalation failed');
    console.error('Original error:', error);
    console.error('Emergency error:', emergencyError);
  }
}
