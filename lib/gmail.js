/**
 * Gmail Operations via Google Workspace MCP
 * 
 * Handles:
 * - Email reading and searching
 * - Email sending with threading
 * - Markdown removal for professional responses
 */

import { createLogger } from './logger.js';
import TurndownService from 'turndown';

const logger = createLogger('gmail');
const turndownService = new TurndownService();

export class GmailOperations {
  constructor(mcpClient) {
    this.mcpClient = mcpClient;
    this.userEmail = 'zach@komplier.co';
  }

  /**
   * Search for emails in inbox
   */
  async searchEmails(query = 'in:inbox', maxResults = 10) {
    try {
      logger.info(`🔍 Searching emails: ${query}`);
      
      const result = await this.mcpClient.callTool('googleWorkspace', 'search_gmail_messages', {
        query,
        user_google_email: this.userEmail,
        page_size: maxResults
      });
      
      logger.info(`✅ Found ${result?.messages?.length || 0} emails`);
      return result;
      
    } catch (error) {
      logger.error('❌ Email search failed:', error);
      throw error;
    }
  }

  /**
   * Get email content by message ID
   */
  async getEmailContent(messageId) {
    try {
      logger.info(`📧 Getting email content: ${messageId}`);
      
      const result = await this.mcpClient.callTool('googleWorkspace', 'get_gmail_message_content', {
        message_id: messageId,
        user_google_email: this.userEmail
      });
      
      return result;
      
    } catch (error) {
      logger.error('❌ Failed to get email content:', error);
      throw error;
    }
  }

  /**
   * Send email with proper threading and markdown removal
   */
  async sendEmail(to, subject, body, originalEmail = null) {
    try {
      logger.info(`📤 Sending email to: ${to}`);
      
      // Remove markdown formatting for professional appearance
      const cleanBody = this._removeMarkdown(body);
      
      // Prepare email parameters
      const emailParams = {
        user_google_email: this.userEmail,
        to,
        subject,
        body: cleanBody
      };
      
      // Add threading if replying to an email
      if (originalEmail) {
        emailParams.in_reply_to = originalEmail.messageId;
        emailParams.references = originalEmail.messageId;
        
        if (originalEmail.threadId) {
          emailParams.thread_id = originalEmail.threadId;
        }
        
        // Ensure subject has "Re:" prefix for replies
        if (!subject.toLowerCase().startsWith('re:')) {
          emailParams.subject = `Re: ${originalEmail.subject?.replace(/^Re:\s*/i, '') || subject}`;
        }
        
        logger.info(`🔗 Threading email - Thread: ${originalEmail.threadId}`);
      }
      
      const result = await this.mcpClient.callTool('googleWorkspace', 'send_gmail_message', emailParams);
      
      logger.info('✅ Email sent successfully');
      return result;
      
    } catch (error) {
      logger.error('❌ Email sending failed:', error);
      throw error;
    }
  }

  /**
   * Draft email without sending
   */
  async draftEmail(to, subject, body, originalEmail = null) {
    try {
      logger.info(`📝 Creating email draft to: ${to}`);
      
      const cleanBody = this._removeMarkdown(body);
      
      const draftParams = {
        user_google_email: this.userEmail,
        to,
        subject,
        body: cleanBody
      };
      
      if (originalEmail) {
        draftParams.in_reply_to = originalEmail.messageId;
        draftParams.references = originalEmail.messageId;
      }
      
      const result = await this.mcpClient.callTool('googleWorkspace', 'draft_gmail_message', draftParams);
      
      logger.info('✅ Email draft created');
      return result;
      
    } catch (error) {
      logger.error('❌ Email draft creation failed:', error);
      throw error;
    }
  }

  /**
   * List Gmail labels
   */
  async getLabels() {
    try {
      const result = await this.mcpClient.callTool('googleWorkspace', 'list_gmail_labels', {
        user_google_email: this.userEmail
      });
      
      return result;
      
    } catch (error) {
      logger.error('❌ Failed to get Gmail labels:', error);
      throw error;
    }
  }

  /**
   * Remove markdown formatting for professional email appearance
   */
  _removeMarkdown(text) {
    if (!text) return text;
    
    try {
      // Convert markdown to plain text
      let cleanText = text
        // Remove headers
        .replace(/^#{1,6}\s+/gm, '')
        // Remove bold/italic
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        // Remove code blocks
        .replace(/```[\s\S]*?```/g, '[code block]')
        .replace(/`([^`]+)`/g, '$1')
        // Remove links but keep text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Remove list bullets
        .replace(/^[\s]*[-*+]\s+/gm, '• ')
        // Clean up extra whitespace
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      
      return cleanText;
      
    } catch (error) {
      logger.warn('⚠️ Markdown removal failed, using original text:', error);
      return text;
    }
  }

  /**
   * Parse email headers for threading information
   */
  _parseEmailHeaders(email) {
    return {
      messageId: email.message_id || email.id,
      threadId: email.thread_id,
      subject: email.subject,
      from: email.from,
      to: email.to,
      date: email.date,
      inReplyTo: email.in_reply_to,
      references: email.references
    };
  }

  /**
   * Mark email as read by removing UNREAD label
   */
  async markEmailAsRead(messageId) {
    try {
      logger.info(`📖 Marking email as read: ${messageId}`);
      
      const result = await this.mcpClient.callTool('googleWorkspace', 'modify_gmail_message_labels', {
        user_google_email: this.userEmail,
        message_id: messageId,
        remove_label_ids: ['UNREAD']
      });
      
      logger.info(`✅ Email marked as read: ${messageId}`);
      return result;
      
    } catch (error) {
      logger.error('❌ Failed to mark email as read:', error);
      throw error;
    }
  }

  /**
   * Check if email is a support request (not automated/spam)
   */
  isValidSupportEmail(email) {
    const subject = email.subject?.toLowerCase() || '';
    const from = email.from?.toLowerCase() || '';
    
    // Skip automated emails
    const skipPatterns = [
      'noreply',
      'no-reply', 
      'donotreply',
      'automated',
      'notification',
      'unsubscribe',
      'delivery-subsystem'
    ];
    
    for (const pattern of skipPatterns) {
      if (from.includes(pattern) || subject.includes(pattern)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Set up Gmail watch request for push notifications
   */
  async setupWatch(emailAddress, watchConfig) {
    try {
      logger.info(`🔔 Setting up Gmail watch for ${emailAddress}...`);
      
      const result = await this.mcpClient.callTool('google_workspace', 'create_gmail_watch', {
        email_address: emailAddress,
        topic_name: watchConfig.topicName,
        label_ids: watchConfig.labelIds || ['INBOX']
      });
      
      if (result.success) {
        logger.info(`✅ Gmail watch request created successfully`);
        logger.info(`📬 History ID: ${result.historyId}`);
        logger.info(`⏰ Expires: ${new Date(parseInt(result.expiration))}`);
        return { success: true, result };
      } else {
        logger.error('❌ Gmail watch request failed:', result.error);
        return { success: false, error: result.error };
      }
      
    } catch (error) {
      logger.error('❌ Gmail watch setup error:', error);
      return { success: false, error: error.message };
    }
  }
}
