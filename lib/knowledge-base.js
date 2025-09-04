/**
 * Knowledge Base Reader
 * 
 * Reads and provides access to JSON reference files
 * for contextual support responses
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { createLogger } from './logger.js';

const logger = createLogger('knowledge-base');

export class KnowledgeBase {
  constructor(config) {
    this.jsonPath = config.knowledgeBase.jsonPath;
    this.files = config.knowledgeBase.files;
    this.cache = new Map();
    this.lastLoaded = null;
  }

  /**
   * Load all knowledge base files
   */
  async loadKnowledgeBase() {
    try {
      logger.info('📚 Loading knowledge base files...');
      
      const knowledgeData = {};
      
      for (const filename of this.files) {
        try {
          const filePath = join(process.cwd(), this.jsonPath, filename);
          const content = await readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          
          // Use filename without extension as key
          const key = filename.replace('.json', '');
          knowledgeData[key] = data;
          
          logger.info(`✅ Loaded: ${filename}`);
          
        } catch (fileError) {
          logger.warn(`⚠️ Failed to load ${filename}:`, fileError.message);
          // Continue loading other files
        }
      }
      
      this.cache.set('knowledge', knowledgeData);
      this.lastLoaded = new Date();
      
      logger.info(`📚 Knowledge base loaded: ${Object.keys(knowledgeData).length} files`);
      return knowledgeData;
      
    } catch (error) {
      logger.error('❌ Knowledge base loading failed:', error);
      throw error;
    }
  }

  /**
   * Get knowledge base data (with caching)
   */
  async getKnowledge(refresh = false) {
    // Refresh cache if older than 1 hour or forced
    const cacheAge = this.lastLoaded ? Date.now() - this.lastLoaded.getTime() : Infinity;
    const shouldRefresh = refresh || cacheAge > 3600000; // 1 hour
    
    if (shouldRefresh || !this.cache.has('knowledge')) {
      await this.loadKnowledgeBase();
    }
    
    return this.cache.get('knowledge') || {};
  }

  /**
   * Search knowledge base for relevant information
   */
  async searchKnowledge(query, category = null) {
    try {
      const knowledge = await this.getKnowledge();
      const results = [];
      
      const searchTerms = query.toLowerCase().split(' ');
      
      // Search in specific category or all categories
      const categoriesToSearch = category ? [category] : Object.keys(knowledge);
      
      for (const cat of categoriesToSearch) {
        const data = knowledge[cat];
        if (!data) continue;
        
        const relevantItems = this._searchInData(data, searchTerms);
        if (relevantItems.length > 0) {
          results.push({
            category: cat,
            items: relevantItems
          });
        }
      }
      
      logger.info(`🔍 Knowledge search "${query}": ${results.length} categories with results`);
      return results;
      
    } catch (error) {
      logger.error('❌ Knowledge search failed:', error);
      return [];
    }
  }

  /**
   * Get specific knowledge category
   */
  async getCategory(categoryName) {
    const knowledge = await this.getKnowledge();
    return knowledge[categoryName] || null;
  }

  /**
   * Search within data structure for matching terms
   */
  _searchInData(data, searchTerms) {
    const results = [];
    
    const searchObject = (obj, path = '') => {
      if (typeof obj === 'string') {
        const matches = searchTerms.filter(term => 
          obj.toLowerCase().includes(term)
        );
        
        if (matches.length > 0) {
          results.push({
            path,
            content: obj,
            relevance: matches.length / searchTerms.length
          });
        }
      } else if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
          searchObject(item, `${path}[${index}]`);
        });
      } else if (typeof obj === 'object' && obj !== null) {
        Object.entries(obj).forEach(([key, value]) => {
          const newPath = path ? `${path}.${key}` : key;
          searchObject(value, newPath);
        });
      }
    };
    
    searchObject(data);
    
    // Sort by relevance
    return results
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10); // Top 10 results
  }

  /**
   * Get knowledge summary for AI context
   */
  async getKnowledgeSummary() {
    try {
      const knowledge = await this.getKnowledge();
      const summary = {};
      
      for (const [category, data] of Object.entries(knowledge)) {
        summary[category] = {
          type: Array.isArray(data) ? 'array' : typeof data,
          itemCount: Array.isArray(data) ? data.length : Object.keys(data).length,
          sampleKeys: Array.isArray(data) 
            ? data.slice(0, 3).map((item, i) => `[${i}]`)
            : Object.keys(data).slice(0, 3)
        };
      }
      
      return summary;
      
    } catch (error) {
      logger.error('❌ Knowledge summary failed:', error);
      return {};
    }
  }
}
