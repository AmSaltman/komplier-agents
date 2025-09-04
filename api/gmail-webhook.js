/**
 * Gmail Push Notification Webhook
 * 
 * This endpoint receives Gmail push notifications via Google Cloud Pub/Sub
 * and triggers the autonomous agent to process new emails.
 * 
 * Setup required:
 * 1. Enable Gmail Push notifications in Google Cloud Console
 * 2. Configure Pub/Sub topic and subscription
 * 3. Set up push subscription to call this webhook
 */

import { KomplierAgent } from '../index.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('gmail-webhook');

// Global agent instance for serverless functions
let globalAgent = null;

/**
 * Initialize agent if not already running
 */
async function ensureAgentInitialized() {
  if (!globalAgent) {
    logger.info('🚀 Initializing Komplier Agent for webhook...');
    globalAgent = new KomplierAgent();
    await globalAgent.initialize();
    globalAgent.isRunning = true;
    logger.info('✅ Agent initialized for webhook processing');
  }
  return globalAgent;
}

/**
 * Handle Gmail push notifications
 */
export default async function handler(req, res) {
  // Set CORS headers for Google Cloud Pub/Sub
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'This endpoint only accepts POST requests from Gmail Push notifications'
    });
  }

  const startTime = Date.now();
  logger.info('📬 Received Gmail push notification');

  try {
    // Parse Pub/Sub message
    const pubsubMessage = req.body;
    
    if (!pubsubMessage?.message?.data) {
      logger.warn('⚠️  Invalid Pub/Sub message format');
      return res.status(400).json({ 
        error: 'Invalid message format',
        message: 'Expected Pub/Sub message with data field'
      });
    }

    // Decode base64 message data
    const messageData = Buffer.from(pubsubMessage.message.data, 'base64').toString();
    const notification = JSON.parse(messageData);
    
    logger.info('📧 Gmail notification details:', {
      historyId: notification.historyId,
      emailAddress: notification.emailAddress
    });

    // Verify this is for our monitored email address
    const supportEmail = 'zach@komplier.co';
    if (notification.emailAddress !== supportEmail) {
      logger.info(`🚫 Ignoring notification for ${notification.emailAddress} (not ${supportEmail})`);
      return res.status(200).json({ 
        message: 'Notification ignored - not for monitored email address',
        emailAddress: notification.emailAddress
      });
    }

    // Initialize agent and process emails
    const agent = await ensureAgentInitialized();
    const processed = await agent.processEmailsOnDemand();
    
    const processingTime = Date.now() - startTime;
    
    if (processed) {
      logger.info(`✅ Gmail webhook processing completed in ${processingTime}ms`);
      return res.status(200).json({
        success: true,
        message: 'Emails processed successfully',
        processingTimeMs: processingTime,
        historyId: notification.historyId
      });
    } else {
      logger.warn('⚠️  No emails were processed');
      return res.status(200).json({
        success: true,
        message: 'No emails to process',
        processingTimeMs: processingTime
      });
    }

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('❌ Gmail webhook processing failed:', error);
    
    return res.status(500).json({
      error: 'Webhook processing failed',
      message: error.message,
      processingTimeMs: processingTime
    });
  }
}

/**
 * Verify webhook signature (optional security enhancement)
 * This can be used to verify requests are actually from Google Pub/Sub
 */
function verifyWebhookSignature(req) {
  // Implementation would verify JWT token or shared secret
  // For now, we'll trust requests from the configured endpoint
  return true;
}
