/**
 * Stripe Operations via Stripe MCP
 * 
 * Handles:
 * - Subscription management
 * - Refund processing  
 * - Customer lookup
 * - Billing history
 */

import { createLogger } from './logger.js';

const logger = createLogger('stripe');

export class StripeOperations {
  constructor(mcpClient) {
    this.mcpClient = mcpClient;
  }

  /**
   * Find customer by email
   */
  async findCustomerByEmail(email) {
    try {
      logger.info(`👤 Looking up Stripe customer: ${email}`);
      
      const result = await this.mcpClient.callTool('stripe', 'search_customers', {
        query: `email:'${email}'`,
        limit: 1
      });
      
      if (result?.data?.length > 0) {
        const customer = result.data[0];
        logger.info(`✅ Customer found: ${customer.id}`);
        return customer;
      }
      
      logger.info('ℹ️ Customer not found in Stripe');
      return null;
      
    } catch (error) {
      logger.error('❌ Customer lookup failed:', error);
      throw error;
    }
  }

  /**
   * Get customer's active subscriptions
   */
  async getCustomerSubscriptions(customerId) {
    try {
      logger.info(`📋 Getting subscriptions for: ${customerId}`);
      
      const result = await this.mcpClient.callTool('stripe', 'list_subscriptions', {
        customer: customerId,
        status: 'all'
      });
      
      logger.info(`✅ Found ${result?.data?.length || 0} subscriptions`);
      return result?.data || [];
      
    } catch (error) {
      logger.error('❌ Subscription lookup failed:', error);
      throw error;
    }
  }

  /**
   * Cancel customer subscription
   */
  async cancelSubscription(subscriptionId, reason = 'Customer request') {
    try {
      logger.info(`🛑 Canceling subscription: ${subscriptionId}`);
      
      const result = await this.mcpClient.callTool('stripe', 'cancel_subscription', {
        id: subscriptionId,
        cancellation_details: {
          comment: reason
        }
      });
      
      logger.info('✅ Subscription canceled successfully');
      return result;
      
    } catch (error) {
      logger.error('❌ Subscription cancellation failed:', error);
      throw error;
    }
  }

  /**
   * Process refund for a customer
   */
  async processRefund(customerId, amount, reason = 'Customer request') {
    try {
      logger.info(`💰 Processing refund for customer: ${customerId}, amount: $${amount / 100}`);
      
      // First, find the most recent successful charge
      const charges = await this.mcpClient.callTool('stripe', 'list_charges', {
        customer: customerId,
        limit: 10
      });
      
      const latestPaidCharge = charges?.data?.find(charge => 
        charge.status === 'succeeded' && !charge.refunded
      );
      
      if (!latestPaidCharge) {
        throw new Error('No refundable charges found for customer');
      }
      
      // Create the refund
      const result = await this.mcpClient.callTool('stripe', 'create_refund', {
        charge: latestPaidCharge.id,
        amount,
        reason: 'requested_by_customer',
        metadata: {
          agent_processed: 'true',
          reason: reason,
          timestamp: new Date().toISOString()
        }
      });
      
      logger.info(`✅ Refund processed: ${result.id}`);
      return result;
      
    } catch (error) {
      logger.error('❌ Refund processing failed:', error);
      throw error;
    }
  }

  /**
   * Get customer's billing history
   */
  async getBillingHistory(customerId, limit = 10) {
    try {
      logger.info(`📊 Getting billing history for: ${customerId}`);
      
      const [charges, invoices] = await Promise.all([
        this.mcpClient.callTool('stripe', 'list_charges', {
          customer: customerId,
          limit
        }),
        this.mcpClient.callTool('stripe', 'list_invoices', {
          customer: customerId,
          limit
        })
      ]);
      
      return {
        charges: charges?.data || [],
        invoices: invoices?.data || []
      };
      
    } catch (error) {
      logger.error('❌ Billing history lookup failed:', error);
      throw error;
    }
  }

  /**
   * Create customer portal session for self-service
   */
  async createPortalSession(customerId, returnUrl = 'https://komplier.co') {
    try {
      logger.info(`🌐 Creating portal session for: ${customerId}`);
      
      const result = await this.mcpClient.callTool('stripe', 'create_billing_portal_session', {
        customer: customerId,
        return_url: returnUrl
      });
      
      logger.info('✅ Portal session created');
      return result;
      
    } catch (error) {
      logger.error('❌ Portal session creation failed:', error);
      throw error;
    }
  }

  /**
   * Validate refund request against business rules
   */
  async validateRefundRequest(email, amount) {
    try {
      const customer = await this.findCustomerByEmail(email);
      if (!customer) {
        return { 
          valid: false, 
          reason: 'Customer not found in billing system' 
        };
      }
      
      const billingHistory = await this.getBillingHistory(customer.id);
      const totalPaid = billingHistory.charges
        .filter(charge => charge.status === 'succeeded')
        .reduce((sum, charge) => sum + charge.amount, 0);
      
      if (amount > totalPaid) {
        return {
          valid: false,
          reason: `Refund amount ($${amount / 100}) exceeds total paid ($${totalPaid / 100})`
        };
      }
      
      return {
        valid: true,
        customer,
        totalPaid,
        reason: 'Refund request validated'
      };
      
    } catch (error) {
      logger.error('❌ Refund validation failed:', error);
      return {
        valid: false,
        reason: `Validation error: ${error.message}`
      };
    }
  }
}
