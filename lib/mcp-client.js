/**
 * MCP Client Manager for All Services
 * 
 * Handles connections to:
 * - Google Workspace MCP (Gmail, Calendar, Drive)
 * - Supabase MCP (Database operations)  
 * - Stripe MCP (Billing and subscriptions)
 */

import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { createLogger } from './logger.js';

const logger = createLogger('mcp-client');

export class MCPClientManager {
  constructor(config) {
    this.config = config.mcpServers;
    this.processes = new Map();
    this.healthStatus = new Map();
  }

  /**
   * Initialize all MCP service connections
   */
  async initialize() {
    logger.info('🔗 Initializing MCP client connections...');
    
    try {
      // Start subprocess-based servers
      await this._startSubprocessServers();
      
      // Initialize HTTP-based clients
      await this._initHttpClients();
      
      logger.info('✅ All MCP clients initialized successfully');
      
    } catch (error) {
      logger.error('❌ MCP client initialization failed:', error);
      throw error;
    }
  }

  /**
   * Resolve environment variables in configuration
   */
  _resolveEnvironmentVariables(envConfig) {
    const resolved = {};
    
    for (const [key, value] of Object.entries(envConfig)) {
      if (typeof value === 'string' && value.startsWith('ENV:')) {
        const envVarName = value.slice(4); // Remove 'ENV:' prefix
        resolved[key] = process.env[envVarName] || value;
        
        if (!process.env[envVarName]) {
          logger.warn(`⚠️ Environment variable ${envVarName} not found, using fallback`);
        }
      } else {
        resolved[key] = value;
      }
    }
    
    return resolved;
  }

  /**
   * Start subprocess MCP servers (Google Workspace, Supabase)
   */
  async _startSubprocessServers() {
    const subprocessConfigs = ['googleWorkspace', 'supabase'];
    
    for (const serviceName of subprocessConfigs) {
      const config = this.config[serviceName];
      if (!config || config.type !== 'subprocess') continue;
      
      try {
        logger.info(`🚀 Starting ${serviceName} MCP server...`);
        
        // Set up environment with variable substitution
        const env = { 
          ...process.env,
          ...this._resolveEnvironmentVariables(config.env)
        };

        // Resolve environment variables in args as well
        const resolvedArgs = config.args.map(arg => {
          if (typeof arg === 'string' && arg.includes('ENV:')) {
            return arg.replace(/ENV:(\w+)/g, (match, envVar) => {
              return process.env[envVar] || match;
            });
          }
          return arg;
        });
        
        // Start the MCP server process
        const serverProcess = spawn(config.command, resolvedArgs, {
          env,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        // Store process reference
        this.processes.set(serviceName, serverProcess);
        this.healthStatus.set(serviceName, true);
        
        // Handle process events
        serverProcess.on('error', (error) => {
          logger.error(`❌ ${serviceName} MCP server error:`, error);
          this.healthStatus.set(serviceName, false);
        });
        
        serverProcess.on('exit', (code) => {
          logger.warn(`⚠️ ${serviceName} MCP server exited with code: ${code}`);
          this.healthStatus.set(serviceName, false);
        });
        
        // Wait for server to start
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        logger.info(`✅ ${serviceName} MCP server started`);
        
      } catch (error) {
        logger.error(`❌ Failed to start ${serviceName}:`, error);
        this.healthStatus.set(serviceName, false);
        throw error;
      }
    }
  }

  /**
   * Initialize HTTP-based MCP clients (Stripe)
   */
  async _initHttpClients() {
    const httpConfigs = ['stripe'];
    
    for (const serviceName of httpConfigs) {
      const config = this.config[serviceName];
      if (!config || config.type !== 'http') continue;
      
      try {
        // Test HTTP connection
        const response = await fetch(config.url, { method: 'HEAD' });
        this.healthStatus.set(serviceName, response.ok);
        
        logger.info(`✅ ${serviceName} HTTP client initialized`);
        
      } catch (error) {
        logger.error(`❌ Failed to initialize ${serviceName}:`, error);
        this.healthStatus.set(serviceName, false);
      }
    }
  }

  /**
   * Call a tool on the specified MCP server
   */
  async callTool(serviceName, toolName, parameters) {
    if (!this.healthStatus.get(serviceName)) {
      throw new Error(`MCP service '${serviceName}' is not healthy`);
    }

    const config = this.config[serviceName];
    
    if (config.type === 'subprocess') {
      return await this._callSubprocessTool(serviceName, toolName, parameters);
    } else if (config.type === 'http') {
      return await this._callHttpTool(serviceName, toolName, parameters);
    } else {
      throw new Error(`Unknown service type for ${serviceName}`);
    }
  }

  /**
   * Call tool on subprocess-based MCP server
   */
  async _callSubprocessTool(serviceName, toolName, parameters) {
    try {
      // For subprocess servers, we'll use direct HTTP calls to their local endpoints
      // Google Workspace MCP runs on localhost:8000 when started
      // Supabase MCP has its own endpoint structure
      
      let baseUrl;
      if (serviceName === 'googleWorkspace') {
        baseUrl = 'https://komplier-agents.vercel.app';
      } else if (serviceName === 'supabase') {
        // Supabase MCP typically runs on a different port
        baseUrl = 'https://komplier-agents.vercel.app';
      }
      
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: parameters
          }
        })
      });
      
      const result = await response.json();
      
      if (result.error) {
        throw new Error(`${serviceName} tool error: ${result.error.message}`);
      }
      
      return result.result;
      
    } catch (error) {
      logger.error(`❌ ${serviceName}.${toolName} failed:`, error);
      throw error;
    }
  }

  /**
   * Call tool on HTTP-based MCP server (Stripe)
   */
  async _callHttpTool(serviceName, toolName, parameters) {
    try {
      const config = this.config[serviceName];
      
      const response = await fetch(`${config.url}/tools/${toolName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(parameters)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
      
    } catch (error) {
      logger.error(`❌ ${serviceName}.${toolName} failed:`, error);
      throw error;
    }
  }

  /**
   * Health check for all services
   */
  async healthCheck() {
    const health = {};
    
    for (const [serviceName, isHealthy] of this.healthStatus) {
      health[serviceName] = isHealthy;
    }
    
    return health;
  }

  /**
   * Cleanup all connections
   */
  async cleanup() {
    logger.info('🧹 Cleaning up MCP connections...');
    
    for (const [serviceName, process] of this.processes) {
      try {
        process.kill('SIGTERM');
        logger.info(`✅ ${serviceName} process terminated`);
      } catch (error) {
        logger.warn(`⚠️ Error terminating ${serviceName}:`, error);
      }
    }
    
    this.processes.clear();
    this.healthStatus.clear();
  }
}
