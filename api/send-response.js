/**
 * Send Response API Endpoint
 * 
 * Manual endpoint for sending AI-generated responses
 * Useful for testing and manual email handling
 */

import { MCPClientManager } from '../lib/mcp-client.js';
import { GmailOperations } from '../lib/gmail.js';
import { AIOperations } from '../lib/ai.js';
import { KnowledgeBase } from '../lib/knowledge-base.js';
import { createLogger } from '../lib/logger.js';
import config from '../config/agent-config.json' assert { type: 'json' };

const logger = createLogger('send-response');

let mcpClient, gmail, ai, knowledgeBase;

export default async function handler(req, res) {
  try {
    // Initialize services if not already done
    if (!mcpClient) {
      await initializeServices();
    }

    if (req.method === 'POST') {
      const { 
        to, 
        subject, 
        messageContent, 
        originalEmail = null,
        useAI = true 
      } = req.body;
      
      if (!to || !subject) {
        return res.status(400).json({ 
          error: 'Missing required fields: to, subject' 
        });
      }
      
      let responseBody = messageContent;
      
      // Generate AI response if requested
      if (useAI && messageContent) {
        const mockEmail = {
          from: to,
          subject: subject,
          body: messageContent
        };
        
        const knowledge = await knowledgeBase.searchKnowledge(messageContent);
        responseBody = await ai.generateResponse(mockEmail, {
          actionType: 'help_response',
          confidence: 0.8
        }, null, knowledge);
      }
      
      // Send the email
      const result = await gmail.sendEmail(to, subject, responseBody, originalEmail);
      
      logger.info(`✅ Response sent to: ${to}`);
      
      return res.status(200).json({
        success: true,
        messageId: result.id,
        to,
        subject,
        aiGenerated: useAI
      });
      
    } else if (req.method === 'GET') {
      // Get draft response without sending
      const { query, category } = req.query;
      
      if (!query) {
        return res.status(400).json({ error: 'Query parameter required' });
      }
      
      const knowledge = await knowledgeBase.searchKnowledge(query, category);
      const mockEmail = {
        from: 'customer@example.com',
        subject: query,
        body: query
      };
      
      const response = await ai.generateResponse(mockEmail, {
        actionType: 'help_response',
        confidence: 0.8
      }, null, knowledge);
      
      return res.status(200).json({
        query,
        response,
        knowledgeUsed: knowledge
      });
      
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
  } catch (error) {
    logger.error('❌ Send response endpoint error:', error);
    return res.status(500).json({
      error: 'Failed to send response',
      message: error.message
    });
  }
}

/**
 * Initialize required services
 */
async function initializeServices() {
  logger.info('🚀 Initializing response services...');
  
  mcpClient = new MCPClientManager(config);
  await mcpClient.initialize();
  
  gmail = new GmailOperations(mcpClient);
  ai = new AIOperations(config);
  knowledgeBase = new KnowledgeBase(config);
  
  logger.info('✅ Response services initialized');
}
