/**
 * OAuth2 Callback Handler - Komplier Agents
 * 
 * Simple, clean OAuth callback endpoint for Google Workspace authentication
 */

const fetch = require('node-fetch');

/**
 * Exchange authorization code for access tokens
 */
async function exchangeCodeForTokens(code) {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI || 'https://komplier-agents.vercel.app/oauth2callback'
      })
    });

    const tokenData = await response.json();

    if (response.ok) {
      return {
        success: true,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        scopes: tokenData.scope,
        tokenType: tokenData.token_type
      };
    } else {
      return {
        success: false,
        error: tokenData.error_description || tokenData.error || 'Token exchange failed'
      };
    }

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = async function handler(req, res) {
  try {
    // Parse URL parameters - use req.query instead of URL parsing
    const { code, error, state } = req.query;

    // Log the callback attempt
    console.log('OAuth callback received:', {
      hasCode: !!code,
      error: error,
      state: state,
      timestamp: new Date().toISOString()
    });

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error);
      res.status(400).setHeader('Content-Type', 'text/html');
      return res.send(generateErrorPage('Authorization Failed', `OAuth Error: ${error}`));
    }

    // Handle missing authorization code
    if (!code) {
      console.error('No authorization code received');
      res.status(400).setHeader('Content-Type', 'text/html');
      return res.send(generateErrorPage('No Authorization Code', 'Google did not provide an authorization code.'));
    }

    // Store the authorization code and metadata
    const authData = {
      code: code,
      state: state,
      timestamp: new Date().toISOString(),
      email: 'zach@komplier.co',
      service: 'google_workspace',
      project: 'komplier-agents'
    };

    // Exchange authorization code for access tokens
    const tokenData = await exchangeCodeForTokens(code);
    
    if (tokenData.success) {
      // Store tokens in Vercel KV or environment (for now, we'll log them)
      console.log('✅ OAuth tokens received:', {
        hasAccessToken: !!tokenData.accessToken,
        hasRefreshToken: !!tokenData.refreshToken,
        scopes: tokenData.scopes,
        email: authData.email,
        timestamp: authData.timestamp
      });
      
      // Return success page
      res.status(200).setHeader('Content-Type', 'text/html');
      return res.send(generateSuccessPage({
        ...authData,
        tokensReceived: true,
        scopes: tokenData.scopes
      }));
    } else {
      console.error('❌ Token exchange failed:', tokenData.error);
      res.status(400).setHeader('Content-Type', 'text/html');
      return res.send(generateErrorPage('Token Exchange Failed', tokenData.error));
    }

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).setHeader('Content-Type', 'text/html');
    return res.send(generateErrorPage('OAuth Callback Failed', error.message));
  }
}

function generateErrorPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Komplier Agents</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      max-width: 600px;
      margin: 100px auto;
      padding: 40px;
      text-align: center;
      background: #f8fafc;
    }
    .error-container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    .error-icon { font-size: 48px; margin-bottom: 20px; }
    h1 { color: #dc2626; margin: 0 0 16px 0; }
    p { color: #64748b; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-icon">❌</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p>Please try again or contact support if this persists.</p>
  </div>
</body>
</html>`;
}

function generateSuccessPage(authData) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Successful - Komplier Agents</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      max-width: 700px;
      margin: 50px auto;
      padding: 40px;
      text-align: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 15px;
    }
    .success-icon { font-size: 64px; margin-bottom: 20px; }
    .card {
      background: rgba(255,255,255,0.1);
      padding: 30px;
      border-radius: 12px;
      margin: 20px 0;
      backdrop-filter: blur(10px);
    }
    .capabilities { text-align: left; display: inline-block; }
    .capability { margin: 12px 0; font-size: 18px; }
    .timestamp { opacity: 0.8; font-size: 14px; margin-top: 30px; }
    h1 { margin: 0 0 10px 0; }
    h2 { margin: 20px 0 15px 0; }
  </style>
</head>
<body>
  <div class="success-icon">✅</div>
  <h1>Authorization Successful!</h1>
  
  <div class="card">
    <h2>Komplier AI Agent is Ready</h2>
    <p>Gmail access authorized for: <strong>${authData.email}</strong></p>
    
    <h3>The agent can now:</h3>
    <div class="capabilities">
      <div class="capability">📧 Read customer support emails automatically</div>
      <div class="capability">📤 Send professional responses with AI</div>
      <div class="capability">🔗 Maintain email conversation threads</div>
      <div class="capability">💰 Process refunds via Stripe integration</div>
      <div class="capability">📊 Access user data via Supabase</div>
      <div class="capability">🤖 Handle support requests 24/7 autonomously</div>
      <div class="capability">📅 Access Google Calendar for scheduling</div>
    </div>
  </div>
  
  <div class="timestamp">
    <p><em>You can close this window. The agent is now active.</em></p>
    <p>Authorized at: ${authData.timestamp}</p>
    <p>Komplier.co Autonomous Support Agent</p>
  </div>
</body>
</html>`;
}
