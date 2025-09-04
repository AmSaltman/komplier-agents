/**
 * Supabase Operations via Supabase MCP
 * 
 * Handles:
 * - User data queries
 * - Project information lookup
 * - Usage tracking
 * - Account status verification
 */

import { createLogger } from './logger.js';

const logger = createLogger('supabase');

export class SupabaseOperations {
  constructor(mcpClient) {
    this.mcpClient = mcpClient;
  }

  /**
   * Find user by email address
   */
  async findUserByEmail(email) {
    try {
      logger.info(`👤 Looking up user: ${email}`);
      
      const result = await this.mcpClient.callTool('supabase', 'query', {
        sql: `
          SELECT 
            id,
            email, 
            name,
            user_type,
            created_at,
            stripe_customer_id,
            subscription_status,
            subscription_plan
          FROM users 
          WHERE email = $1
        `,
        params: [email]
      });
      
      if (result?.data?.length > 0) {
        logger.info(`✅ User found: ${result.data[0].name}`);
        return result.data[0];
      }
      
      logger.info('ℹ️ User not found');
      return null;
      
    } catch (error) {
      logger.error('❌ User lookup failed:', error);
      throw error;
    }
  }

  /**
   * Get user's project information
   */
  async getUserProjects(userId) {
    try {
      logger.info(`📁 Getting projects for user: ${userId}`);
      
      const result = await this.mcpClient.callTool('supabase', 'query', {
        sql: `
          SELECT 
            id,
            name,
            status,
            created_at,
            completed_at,
            asset_count
          FROM projects 
          WHERE user_id = $1
          ORDER BY created_at DESC
        `,
        params: [userId]
      });
      
      logger.info(`✅ Found ${result?.data?.length || 0} projects`);
      return result?.data || [];
      
    } catch (error) {
      logger.error('❌ Project lookup failed:', error);
      throw error;
    }
  }

  /**
   * Get user's compliant assets count
   */
  async getCompliantAssets(userId) {
    try {
      logger.info(`🎨 Getting compliant assets for user: ${userId}`);
      
      const result = await this.mcpClient.callTool('supabase', 'query', {
        sql: `
          SELECT 
            COUNT(*) as compliant_count,
            asset_type,
            compliance_status
          FROM user_assets 
          WHERE user_id = $1 
          AND compliance_status = 'compliant'
          GROUP BY asset_type, compliance_status
        `,
        params: [userId]
      });
      
      // Calculate total compliant assets
      const totalCompliant = result?.data?.reduce((sum, row) => sum + parseInt(row.compliant_count), 0) || 0;
      
      logger.info(`✅ User has ${totalCompliant} compliant assets`);
      return {
        totalCompliant,
        breakdown: result?.data || []
      };
      
    } catch (error) {
      logger.error('❌ Compliant assets lookup failed:', error);
      throw error;
    }
  }

  /**
   * Calculate refund eligibility based on usage
   */
  async calculateRefundEligibility(userId) {
    try {
      logger.info(`💰 Calculating refund eligibility for: ${userId}`);
      
      // Get user info
      const user = await this.findUserByEmail(userId);
      if (!user) {
        return { eligible: false, reason: 'User not found' };
      }
      
      // Get projects and compliant assets
      const [projects, assetsData] = await Promise.all([
        this.getUserProjects(user.id),
        this.getCompliantAssets(user.id)
      ]);
      
      // Calculate eligibility based on business rules
      const daysSinceSignup = Math.floor(
        (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      const completedProjects = projects.filter(p => p.status === 'completed').length;
      const compliantAssets = assetsData.totalCompliant;
      
      const eligibility = {
        eligible: false,
        reason: '',
        userInfo: {
          daysSinceSignup,
          completedProjects,
          compliantAssets,
          subscriptionStatus: user.subscription_status
        }
      };
      
      // Business rules from config
      if (daysSinceSignup <= 30 && completedProjects === 0 && compliantAssets < 5) {
        eligibility.eligible = true;
        eligibility.reason = 'Meets auto-approval criteria';
      } else {
        eligibility.reason = `Exceeds limits: ${daysSinceSignup}d since signup, ${completedProjects} projects, ${compliantAssets} compliant assets`;
      }
      
      logger.info(`💰 Refund eligibility: ${eligibility.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}`);
      return eligibility;
      
    } catch (error) {
      logger.error('❌ Refund eligibility calculation failed:', error);
      throw error;
    }
  }

  /**
   * Log agent activity for reporting
   */
  async logActivity(activityType, details) {
    try {
      const result = await this.mcpClient.callTool('supabase', 'query', {
        sql: `
          INSERT INTO agent_activity (
            activity_type,
            details,
            timestamp
          ) VALUES ($1, $2, $3)
        `,
        params: [
          activityType,
          JSON.stringify(details),
          new Date().toISOString()
        ]
      });
      
      return result;
      
    } catch (error) {
      logger.warn('⚠️ Activity logging failed:', error);
      // Don't throw - logging failures shouldn't stop the agent
    }
  }

  /**
   * Get daily activity summary for reporting
   */
  async getDailyActivity(date = new Date().toISOString().split('T')[0]) {
    try {
      const result = await this.mcpClient.callTool('supabase', 'query', {
        sql: `
          SELECT 
            activity_type,
            COUNT(*) as count,
            details
          FROM agent_activity 
          WHERE DATE(timestamp) = $1
          GROUP BY activity_type, details
          ORDER BY count DESC
        `,
        params: [date]
      });
      
      return result?.data || [];
      
    } catch (error) {
      logger.error('❌ Daily activity lookup failed:', error);
      throw error;
    }
  }
}
