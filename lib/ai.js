/**
 * AI Operations with Gemini 2.5 Flash
 * 
 * Handles:
 * - Email content analysis
 * - Response generation
 * - Sentiment analysis
 * - Action plan creation
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createLogger } from './logger.js';

const logger = createLogger('ai');

export class AIOperations {
  constructor(config) {
    this.genai = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    this.model = this.genai.getGenerativeModel({ 
      model: config.ai.model,
      generationConfig: {
        temperature: config.ai.temperature,
        maxOutputTokens: config.ai.maxTokens
      }
    });
    
    this.config = config;
  }

  /**
   * Analyze incoming email and determine action plan
   */
  async analyzeEmail(email, userContext = null, knowledgeBase = null) {
    try {
      logger.info(`🧠 Analyzing email: ${email.subject}`);
      
      const prompt = this._buildAnalysisPrompt(email, userContext, knowledgeBase);
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      const analysis = JSON.parse(response);
      
      logger.info(`✅ Email classified as: ${analysis.actionType}`);
      return analysis;
      
    } catch (error) {
      logger.error('❌ Email analysis failed:', error);
      
      // Fallback analysis
      return {
        actionType: 'escalate',
        confidence: 0.1,
        reasoning: 'Analysis failed - escalating to human',
        suggestedResponse: 'Thanks for contacting us. A team member will review your request and respond shortly.',
        escalationReason: `AI analysis error: ${error.message}`
      };
    }
  }

  /**
   * Generate response to customer email
   */
  async generateResponse(email, actionPlan, userContext = null, knowledgeBase = null) {
    try {
      logger.info(`✍️ Generating response for: ${actionPlan.actionType}`);
      
      const prompt = this._buildResponsePrompt(email, actionPlan, userContext, knowledgeBase);
      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      logger.info('✅ Response generated successfully');
      return response;
      
    } catch (error) {
      logger.error('❌ Response generation failed:', error);
      
      // Fallback response
      return `Hi there,

Thank you for contacting Komplier support. I received your message about "${email.subject}" and I'm looking into it.

A team member will review your request and get back to you shortly.

Best regards,
Komplier Support Team`;
    }
  }

  /**
   * Build analysis prompt for email classification
   */
  _buildAnalysisPrompt(email, userContext, knowledgeBase) {
    return `You are an AI customer support analyst for Komplier.co, a platform that helps businesses create Apple Pay marketing assets.

ANALYZE this customer email and determine the best action:

EMAIL:
From: ${email.from}
Subject: ${email.subject}
Body: ${email.body}

${userContext ? `USER CONTEXT:
${JSON.stringify(userContext, null, 2)}` : ''}

${knowledgeBase ? `KNOWLEDGE BASE:
${JSON.stringify(knowledgeBase, null, 2)}` : ''}

BUSINESS RULES:
- Auto-approve refunds if: < 5 compliant assets, 0 completed projects, < 30 days since signup
- Escalate if: legal keywords, CEO mention, very negative sentiment
- Help with: Apple Pay guidelines, logo compliance, technical issues

RESPONSE FORMAT (JSON only):
{
  "actionType": "refund|help_response|escalate|general_info",
  "confidence": 0.0-1.0,
  "reasoning": "Why this action was chosen",
  "suggestedResponse": "Draft response to customer",
  "escalationReason": "If escalating, why?",
  "refundAmount": "If refund, amount in cents",
  "knowledgeUsed": ["Which knowledge files were relevant"]
}

Analyze the email and respond with JSON only:`;
  }

  /**
   * Build response generation prompt
   */
  _buildResponsePrompt(email, actionPlan, userContext, knowledgeBase) {
    return `You are a professional customer support agent for Komplier.co.

CUSTOMER EMAIL:
From: ${email.from}
Subject: ${email.subject}  
Body: ${email.body}

ACTION PLAN:
${JSON.stringify(actionPlan, null, 2)}

${userContext ? `USER CONTEXT:
${JSON.stringify(userContext, null, 2)}` : ''}

${knowledgeBase ? `KNOWLEDGE BASE:
${JSON.stringify(knowledgeBase, null, 2)}` : ''}

RESPONSE GUIDELINES:
- Be professional and helpful
- NO markdown formatting (no *, **, #, etc.)
- Always reply in email threads, never start new conversations
- Reference specific user data when available
- Provide actionable solutions
- Sign as "Komplier Support Team"

Generate a professional email response (plain text only, no markdown):`;
  }

  /**
   * Analyze email sentiment
   */
  async analyzeSentiment(emailBody) {
    try {
      const prompt = `Analyze the sentiment of this customer email on a scale from -1.0 (very negative) to 1.0 (very positive).

EMAIL: ${emailBody}

Respond with only a number between -1.0 and 1.0:`;
      
      const result = await this.model.generateContent(prompt);
      const sentimentScore = parseFloat(result.response.text().trim());
      
      return isNaN(sentimentScore) ? 0 : sentimentScore;
      
    } catch (error) {
      logger.warn('⚠️ Sentiment analysis failed:', error);
      return 0; // Neutral fallback
    }
  }

  /**
   * Extract key information from email
   */
  extractEmailInfo(email) {
    const info = {
      from: email.from,
      subject: email.subject,
      body: email.body,
      timestamp: email.date || new Date().toISOString(),
      messageId: email.message_id || email.id,
      threadId: email.thread_id
    };
    
    // Extract potential user identifiers
    const emailMatch = info.from.match(/[\w\.-]+@[\w\.-]+\.\w+/);
    if (emailMatch) {
      info.customerEmail = emailMatch[0];
    }
    
    // Classify urgency based on subject/content
    const urgentKeywords = ['urgent', 'asap', 'immediately', 'emergency', 'broken', 'not working'];
    info.isUrgent = urgentKeywords.some(keyword => 
      info.subject?.toLowerCase().includes(keyword) || 
      info.body?.toLowerCase().includes(keyword)
    );
    
    return info;
  }
}
