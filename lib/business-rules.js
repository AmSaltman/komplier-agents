/**
 * Business Rules Engine
 * 
 * Implements the Core Decision Matrix for:
 * - Refund approvals/denials
 * - Escalation triggers
 * - Response prioritization
 */

import { createLogger } from './logger.js';

const logger = createLogger('business-rules');

export class BusinessRulesEngine {
  constructor(config) {
    this.rules = config.businessRules;
  }

  /**
   * Evaluate if refund should be auto-approved
   */
  evaluateRefundRequest(userContext, requestedAmount = null) {
    try {
      logger.info('💰 Evaluating refund request...');
      
      const conditions = this.rules.refunds.autoApproveConditions;
      const userInfo = userContext.userInfo || {};
      
      // Check auto-approval conditions
      const checks = {
        compliantAssets: userInfo.compliantAssets < conditions.compliantAssetsMax,
        completedProjects: userInfo.completedProjects <= conditions.completedProjectsMax,
        daysSinceSignup: userInfo.daysSinceSignup <= conditions.daysSinceSignupMax
      };
      
      const allConditionsMet = Object.values(checks).every(Boolean);
      
      const decision = {
        autoApprove: allConditionsMet,
        amount: requestedAmount || this.rules.refunds.refundAmountDefault * 100, // Convert to cents
        reasoning: this._buildRefundReasoning(checks, userInfo),
        conditions: checks
      };
      
      logger.info(`💰 Refund decision: ${decision.autoApprove ? 'AUTO-APPROVE' : 'ESCALATE'}`);
      return decision;
      
    } catch (error) {
      logger.error('❌ Refund evaluation failed:', error);
      return {
        autoApprove: false,
        reasoning: 'Evaluation error - escalating to human review',
        error: error.message
      };
    }
  }

  /**
   * Check if email should be escalated to human
   */
  shouldEscalate(email, aiAnalysis, userContext = null) {
    try {
      logger.info('🚨 Checking escalation criteria...');
      
      const escalationRules = this.rules.escalation;
      const escalationReasons = [];
      
      // Check AI confidence
      if (aiAnalysis.confidence < escalationRules.aiConfidenceThreshold) {
        escalationReasons.push(`Low AI confidence: ${aiAnalysis.confidence}`);
      }
      
      // Check for escalation keywords
      const content = `${email.subject} ${email.body}`.toLowerCase();
      for (const keyword of escalationRules.keywords) {
        if (content.includes(keyword.toLowerCase())) {
          escalationReasons.push(`Escalation keyword found: ${keyword}`);
        }
      }
      
      // Check sentiment
      if (aiAnalysis.sentiment && aiAnalysis.sentiment < escalationRules.sentimentThreshold) {
        escalationReasons.push(`Negative sentiment: ${aiAnalysis.sentiment}`);
      }
      
      // Check for billing disputes
      if (userContext?.billing?.hasDisputes) {
        escalationReasons.push('Customer has active billing disputes');
      }
      
      const shouldEscalate = escalationReasons.length > 0;
      
      logger.info(`🚨 Escalation decision: ${shouldEscalate ? 'ESCALATE' : 'HANDLE'}`);
      
      return {
        escalate: shouldEscalate,
        reasons: escalationReasons,
        priority: this._calculatePriority(escalationReasons, aiAnalysis)
      };
      
    } catch (error) {
      logger.error('❌ Escalation check failed:', error);
      return {
        escalate: true,
        reasons: ['Escalation evaluation error'],
        priority: 'high'
      };
    }
  }

  /**
   * Determine response priority level
   */
  _calculatePriority(escalationReasons, aiAnalysis) {
    // High priority triggers
    const highPriorityKeywords = ['legal', 'ceo', 'urgent', 'lawsuit'];
    const hasHighPriorityKeyword = escalationReasons.some(reason => 
      highPriorityKeywords.some(keyword => reason.toLowerCase().includes(keyword))
    );
    
    if (hasHighPriorityKeyword) {
      return 'critical';
    }
    
    if (aiAnalysis.sentiment && aiAnalysis.sentiment < -0.6) {
      return 'high';
    }
    
    if (escalationReasons.length > 2) {
      return 'high';
    }
    
    return 'medium';
  }

  /**
   * Build reasoning text for refund decisions
   */
  _buildRefundReasoning(checks, userInfo) {
    const passed = [];
    const failed = [];
    
    if (checks.compliantAssets) {
      passed.push(`Low asset usage (${userInfo.compliantAssets || '0'} assets)`);
    } else {
      failed.push(`High asset usage (${userInfo.compliantAssets || '0'} assets)`);
    }
    
    if (checks.completedProjects) {
      passed.push(`No completed projects (${userInfo.completedProjects || 0})`);
    } else {
      failed.push(`Has completed projects (${userInfo.completedProjects || 0})`);
    }
    
    if (checks.daysSinceSignup) {
      passed.push(`Recent signup (${userInfo.daysSinceSignup || 0} days)`);
    } else {
      failed.push(`Long-term user (${userInfo.daysSinceSignup || 0} days)`);
    }
    
    if (failed.length === 0) {
      return `Auto-approved: ${passed.join(', ')}`;
    } else {
      return `Requires review: ${failed.join(', ')}`;
    }
  }

  /**
   * Validate business logic configuration
   */
  validateConfig() {
    const required = [
      'refunds.autoApproveConditions.compliantAssetsMax',
      'refunds.autoApproveConditions.completedProjectsMax', 
      'refunds.autoApproveConditions.daysSinceSignupMax',
      'escalation.aiConfidenceThreshold',
      'escalation.keywords',
      'escalation.sentimentThreshold'
    ];
    
    const missing = required.filter(path => {
      const value = this._getNestedValue(this.rules, path);
      return value === undefined || value === null;
    });
    
    if (missing.length > 0) {
      throw new Error(`Missing business rule configuration: ${missing.join(', ')}`);
    }
    
    logger.info('✅ Business rules configuration validated');
    return true;
  }

  /**
   * Get nested object value by dot-notation path
   */
  _getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}
