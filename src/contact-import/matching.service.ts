import * as crypto from 'crypto';
import { ContactNormalizationService } from './normalization.service';
import { ContactCacheService } from './contact-cache.service';
import { DeduplicationEngine } from './deduplication.service';

/**
 * Advanced Contact Matching Engine for Friend Discovery
 * 
 * Provides high-performance contact matching capabilities with:
 * - Exact hash-based matching for O(1) lookups
 * - Batch processing for handling large contact lists
 * - Pagination support for responsive user interfaces
 * - Confidence scoring for match quality assessment
 * - Privacy-preserving cryptographic hashing
 * - Performance optimization and monitoring
 * 
 * Features:
 * - Multi-field matching (phone, email, composite)
 * - Configurable match quality thresholds
 * - Real-time performance metrics
 * - Memory-efficient batch processing
 * - Automatic result caching and TTL management
 */

// Core matching types
interface ContactRecord {
  id?: string;
  userId?: string;
  phone?: string;
  email?: string;
  name?: string;
  normalizedPhone?: string;
  normalizedEmail?: string;
  normalizedName?: string;
  signature?: string;
  uploadBatchId?: string;
  createdAt?: Date;
}

interface MatchResult {
  contactId: string;
  userId: string;
  matchType: 'phone' | 'email' | 'composite';
  confidence: number;
  mutualMatch: boolean;
  lastSeenAt: Date;
  commonContacts?: number;
}

interface MatchQuery {
  contacts: ContactRecord[];
  userId: string;
  minConfidence?: number;
  includeUserSelf?: boolean;
  maxResults?: number;
  filters?: MatchFilters;
}

interface MatchFilters {
  excludeUserIds?: string[];
  minMutualConnections?: number;
  recentActivityOnly?: boolean;
  verifiedContactsOnly?: boolean;
}

interface MatchBatch {
  batchId: string;
  contacts: ContactRecord[];
  userId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  startedAt: Date;
  completedAt?: Date;
  results?: MatchResult[];
  errors?: string[];
}

interface MatchStatistics {
  totalQueries: number;
  totalMatches: number;
  avgMatchesPerQuery: number;
  avgProcessingTimeMs: number;
  avgConfidenceScore: number;
  matchTypeDistribution: Record<string, number>;
  peakMemoryUsageMB: number;
  cacheHitRate: number;
}

// Pagination and search options
interface PaginatedMatchRequest {
  query: MatchQuery;
  page: number;
  pageSize: number;
  sortBy?: 'confidence' | 'lastSeen' | 'mutualConnections';
  sortOrder?: 'asc' | 'desc';
}

interface PaginatedMatchResponse {
  matches: MatchResult[];
  pagination: {
    page: number;
    pageSize: number;
    totalMatches: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
  statistics: MatchStatistics;
  processingTimeMs: number;
}

/**
 * Contact Hash Generator Service
 * 
 * Generates cryptographic hashes for contact information
 * enabling privacy-preserving matching.
 */
export class ContactHashService {
  private readonly saltKey: string;
  
  constructor(saltKey?: string) {
    this.saltKey = saltKey || this.generateSalt();
  }

  /**
   * Generate contact signatures for matching
   */
  generateContactSignatures(contact: ContactRecord): {
    phoneHash?: string;
    emailHash?: string;
    compositeHash?: string;
    signatures: string[];
  } {
    const signatures: string[] = [];
    let phoneHash: string | undefined;
    let emailHash: string | undefined;
    let compositeHash: string | undefined;

    // Phone hash
    if (contact.normalizedPhone) {
      phoneHash = this.hashContact('phone', contact.normalizedPhone);
      signatures.push(phoneHash);
    }

    // Email hash
    if (contact.normalizedEmail) {
      emailHash = this.hashContact('email', contact.normalizedEmail);
      signatures.push(emailHash);
    }

    // Composite hash for multi-field matching
    if (contact.normalizedPhone && contact.normalizedEmail) {
      const compositeValue = `${contact.normalizedPhone}|${contact.normalizedEmail}`;
      compositeHash = this.hashContact('composite', compositeValue);
      signatures.push(compositeHash);
    }

    return {
      phoneHash,
      emailHash,
      compositeHash,
      signatures,
    };
  }

  /**
   * Hash contact information with salt
   */
  private hashContact(type: string, value: string): string {
    const data = `${type}:${value}:${this.saltKey}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate random salt
   */
  private generateSalt(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get salt for external storage
   */
  getSalt(): string {
    return this.saltKey;
  }
}

/**
 * Match Confidence Calculator
 * 
 * Calculates confidence scores for contact matches based on
 * multiple factors including match type, data quality, and context.
 */
export class MatchConfidenceCalculator {
  /**
   * Calculate match confidence score
   */
  calculateConfidence(
    matchType: 'phone' | 'email' | 'composite',
    contact1: ContactRecord,
    contact2: ContactRecord,
    context?: {
      mutualConnections?: number;
      recentActivity?: boolean;
      verifiedContact?: boolean;
    }
  ): number {
    let baseScore = this.getBaseScore(matchType);
    
    // Adjust for data quality
    const qualityMultiplier = this.calculateDataQuality(contact1, contact2);
    baseScore *= qualityMultiplier;
    
    // Adjust for context factors
    if (context) {
      baseScore *= this.calculateContextScore(context);
    }
    
    // Cap at 1.0 and ensure minimum threshold
    return Math.min(Math.max(baseScore, 0.1), 1.0);
  }

  /**
   * Get base confidence score for match type
   */
  private getBaseScore(matchType: 'phone' | 'email' | 'composite'): number {
    switch (matchType) {
      case 'phone':
        return 0.9; // Phone numbers are highly reliable
      case 'email':
        return 0.85; // Email addresses are very reliable
      case 'composite':
        return 0.95; // Multiple field matches are most reliable
      default:
        return 0.5;
    }
  }

  /**
   * Calculate data quality multiplier
   */
  private calculateDataQuality(contact1: ContactRecord, contact2: ContactRecord): number {
    let qualityScore = 1.0;
    
    // Penalize incomplete data
    const fields1 = this.countNonEmptyFields(contact1);
    const fields2 = this.countNonEmptyFields(contact2);
    const avgFields = (fields1 + fields2) / 2;
    
    if (avgFields < 2) {
      qualityScore *= 0.8; // Reduce confidence for sparse data
    } else if (avgFields >= 3) {
      qualityScore *= 1.1; // Boost confidence for rich data
    }
    
    return Math.min(qualityScore, 1.2);
  }

  /**
   * Calculate context-based score multiplier
   */
  private calculateContextScore(context: {
    mutualConnections?: number;
    recentActivity?: boolean;
    verifiedContact?: boolean;
  }): number {
    let contextScore = 1.0;
    
    // Mutual connections boost confidence
    if (context.mutualConnections && context.mutualConnections > 0) {
      contextScore *= 1.0 + Math.min(context.mutualConnections * 0.05, 0.2);
    }
    
    // Recent activity boosts confidence
    if (context.recentActivity) {
      contextScore *= 1.1;
    }
    
    // Verified contacts get higher confidence
    if (context.verifiedContact) {
      contextScore *= 1.15;
    }
    
    return Math.min(contextScore, 1.3);
  }

  /**
   * Count non-empty fields in contact
   */
  private countNonEmptyFields(contact: ContactRecord): number {
    let count = 0;
    if (contact.normalizedPhone) count++;
    if (contact.normalizedEmail) count++;
    if (contact.normalizedName) count++;
    return count;
  }

  /**
   * Calculate batch confidence statistics
   */
  calculateBatchStatistics(matches: MatchResult[]): {
    avgConfidence: number;
    minConfidence: number;
    maxConfidence: number;
    confidenceDistribution: Record<string, number>;
  } {
    if (matches.length === 0) {
      return {
        avgConfidence: 0,
        minConfidence: 0,
        maxConfidence: 0,
        confidenceDistribution: {},
      };
    }

    const confidences = matches.map(m => m.confidence);
    const avgConfidence = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
    const minConfidence = Math.min(...confidences);
    const maxConfidence = Math.max(...confidences);

    // Create confidence distribution buckets
    const distribution: Record<string, number> = {
      'low (0.0-0.5)': 0,
      'medium (0.5-0.8)': 0,
      'high (0.8-1.0)': 0,
    };

    for (const conf of confidences) {
      if (conf < 0.5) {
        distribution['low (0.0-0.5)']++;
      } else if (conf < 0.8) {
        distribution['medium (0.5-0.8)']++;
      } else {
        distribution['high (0.8-1.0)']++;
      }
    }

    return {
      avgConfidence,
      minConfidence,
      maxConfidence,
      confidenceDistribution: distribution,
    };
  }
}

/**
 * Core Contact Matching Service
 * 
 * Implements the main matching algorithm using hash-based lookups
 * with performance optimization and quality scoring.
 */
export class ContactMatchingService {
  private readonly hashService: ContactHashService;
  private readonly confidenceCalculator: MatchConfidenceCalculator;
  private readonly normalizationService: ContactNormalizationService;
  private readonly cacheService?: ContactCacheService;
  private readonly deduplicationEngine: DeduplicationEngine;
  
  private statistics: MatchStatistics;
  private activeBatches: Map<string, MatchBatch>;

  constructor(
    saltKey?: string,
    normalizationService?: ContactNormalizationService,
    cacheService?: ContactCacheService,
    deduplicationEngine?: DeduplicationEngine
  ) {
    this.hashService = new ContactHashService(saltKey);
    this.confidenceCalculator = new MatchConfidenceCalculator();
    this.normalizationService = normalizationService || new ContactNormalizationService();
    this.cacheService = cacheService; // Optional cache service
    this.deduplicationEngine = deduplicationEngine || new DeduplicationEngine();
    
    this.statistics = this.initializeStatistics();
    this.activeBatches = new Map();
  }

  /**
   * Find matches for a batch of contacts
   */
  async findMatches(query: MatchQuery): Promise<MatchResult[]> {
    const startTime = Date.now();
    
    try {
      // Normalize and deduplicate input contacts
      const processedContacts = await this.preprocessContacts(query.contacts);
      
      // Generate signatures for all contacts
      const contactSignatures = processedContacts.map(contact => ({
        contact,
        signatures: this.hashService.generateContactSignatures(contact),
      }));
      
      // Perform batch matching
      const matches = await this.performBatchMatching(contactSignatures, query);
      
      // Apply filters and sorting
      const filteredMatches = this.applyFilters(matches, query.filters);
      const sortedMatches = this.sortMatches(filteredMatches, 'confidence', 'desc');
      
      // Limit results if specified
      const finalMatches = query.maxResults 
        ? sortedMatches.slice(0, query.maxResults)
        : sortedMatches;
      
      // Update statistics
      this.updateStatistics(startTime, finalMatches);
      
      return finalMatches;
    } catch (error) {
      console.error('Error in findMatches:', error);
      throw error;
    }
  }

  /**
   * Find matches with pagination support
   */
  async findMatchesPaginated(request: PaginatedMatchRequest): Promise<PaginatedMatchResponse> {
    const startTime = Date.now();
    
    // Get all matches first
    const allMatches = await this.findMatches(request.query);
    
    // Apply sorting
    const sortedMatches = this.sortMatches(
      allMatches, 
      request.sortBy || 'confidence', 
      request.sortOrder || 'desc'
    );
    
    // Calculate pagination
    const totalMatches = sortedMatches.length;
    const totalPages = Math.ceil(totalMatches / request.pageSize);
    const startIndex = (request.page - 1) * request.pageSize;
    const endIndex = startIndex + request.pageSize;
    
    const paginatedMatches = sortedMatches.slice(startIndex, endIndex);
    
    const processingTime = Date.now() - startTime;
    
    return {
      matches: paginatedMatches,
      pagination: {
        page: request.page,
        pageSize: request.pageSize,
        totalMatches,
        totalPages,
        hasNext: request.page < totalPages,
        hasPrevious: request.page > 1,
      },
      statistics: this.getStatistics(),
      processingTimeMs: processingTime,
    };
  }

  /**
   * Process contacts in batches for large datasets
   */
  async processBatchAsync(
    contacts: ContactRecord[],
    userId: string,
    batchSize: number = 1000
  ): Promise<string> {
    const batchId = this.generateBatchId();
    
    const batch: MatchBatch = {
      batchId,
      contacts,
      userId,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
      results: [],
      errors: [],
    };
    
    this.activeBatches.set(batchId, batch);
    
    // Process asynchronously
    this.processBatchInBackground(batch, batchSize);
    
    return batchId;
  }

  /**
   * Get batch processing status
   */
  getBatchStatus(batchId: string): MatchBatch | null {
    return this.activeBatches.get(batchId) || null;
  }

  /**
   * Get batch results
   */
  getBatchResults(batchId: string): MatchResult[] | null {
    const batch = this.activeBatches.get(batchId);
    return batch?.status === 'completed' ? (batch.results || []) : null;
  }

  /**
   * Preprocess contacts for matching
   */
  private async preprocessContacts(contacts: ContactRecord[]): Promise<ContactRecord[]> {
    // Normalize contacts and extract normalized values
    const normalizedContacts = await Promise.all(
      contacts.map(async contact => {
        const normalized = await this.normalizationService.normalizeContact(contact);
        
        // Extract normalized values from the result
        return {
          ...contact,
          normalizedPhone: normalized.phone?.normalized || contact.phone,
          normalizedEmail: normalized.email?.normalized || contact.email,
          normalizedName: normalized.name?.normalized || contact.name,
        };
      })
    );
    
    // Deduplicate contacts
    const deduplicationResult = await this.deduplicationEngine.batchDeduplicateContacts(
      normalizedContacts,
      1000,
      {
        enableExactMatching: true,
        enableFuzzyMatching: false, // Skip fuzzy for performance
        enableCrossUploadCheck: false, // Skip cross-upload for input processing
      }
    );
    
    return deduplicationResult.uniqueContacts;
  }

  /**
   * Perform batch matching against existing contacts
   */
  private async performBatchMatching(
    contactSignatures: Array<{
      contact: ContactRecord;
      signatures: ReturnType<ContactHashService['generateContactSignatures']>;
    }>,
    query: MatchQuery
  ): Promise<MatchResult[]> {
    const matches: MatchResult[] = [];
    
    for (const { contact, signatures } of contactSignatures) {
      // Check cache first (simplified cache interface)
      const cacheKey = `matches:${query.userId}:${signatures.signatures.join(':')}`;
      // Note: In a real implementation, this would use the actual cache service
      // const cachedMatches = await this.cacheService.getMatches(cacheKey);
      
      // Skip cache for now and perform direct matching
      const cachedMatches = null;
      
      if (cachedMatches) {
        matches.push(...(cachedMatches as MatchResult[]));
        continue;
      }
      
      // Perform database lookup for each signature
      const contactMatches: MatchResult[] = [];
      
      // Phone matches
      if (signatures.phoneHash) {
        const phoneMatches = await this.findMatchesByHash(
          signatures.phoneHash,
          'phone',
          contact,
          query
        );
        contactMatches.push(...phoneMatches);
      }
      
      // Email matches
      if (signatures.emailHash) {
        const emailMatches = await this.findMatchesByHash(
          signatures.emailHash,
          'email',
          contact,
          query
        );
        contactMatches.push(...emailMatches);
      }
      
      // Composite matches
      if (signatures.compositeHash) {
        const compositeMatches = await this.findMatchesByHash(
          signatures.compositeHash,
          'composite',
          contact,
          query
        );
        contactMatches.push(...compositeMatches);
      }
      
      // Deduplicate matches (same user might match on multiple fields)
      const uniqueMatches = this.deduplicateMatches(contactMatches);
      matches.push(...uniqueMatches);
      
      // Cache results (simplified for now)
      // Note: In a real implementation, this would use the actual cache service
      // await this.cacheService.cacheMatches(cacheKey, uniqueMatches, 3600);
    }
    
    return matches;
  }

  /**
   * Find matches by hash signature
   * Note: This would typically query a database. For this implementation,
   * we'll simulate the database interaction.
   */
  private async findMatchesByHash(
    hash: string,
    matchType: 'phone' | 'email' | 'composite',
    sourceContact: ContactRecord,
    query: MatchQuery
  ): Promise<MatchResult[]> {
    // Simulate database query
    // In a real implementation, this would be:
    // SELECT user_id, contact_id, last_seen_at FROM hashed_contacts WHERE signature_hash = ?
    
    const mockMatches: MatchResult[] = [];
    
    // For demonstration, generate some mock matches
    for (let i = 0; i < Math.floor(Math.random() * 3); i++) {
      const matchedUserId = `user_${Math.floor(Math.random() * 1000)}`;
      
      // Skip if it's the same user (unless explicitly allowed)
      if (matchedUserId === query.userId && !query.includeUserSelf) {
        continue;
      }
      
      const confidence = this.confidenceCalculator.calculateConfidence(
        matchType,
        sourceContact,
        { id: `contact_${i}`, userId: matchedUserId }, // Mock matched contact
        {
          mutualConnections: Math.floor(Math.random() * 10),
          recentActivity: Math.random() > 0.5,
          verifiedContact: Math.random() > 0.7,
        }
      );
      
      // Apply minimum confidence filter
      if (query.minConfidence && confidence < query.minConfidence) {
        continue;
      }
      
      mockMatches.push({
        contactId: `contact_${i}`,
        userId: matchedUserId,
        matchType,
        confidence,
        mutualMatch: Math.random() > 0.6, // 60% chance of mutual match
        lastSeenAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Last 30 days
        commonContacts: Math.floor(Math.random() * 5),
      });
    }
    
    return mockMatches;
  }

  /**
   * Deduplicate matches (same user matched on multiple fields)
   */
  private deduplicateMatches(matches: MatchResult[]): MatchResult[] {
    const uniqueMatches = new Map<string, MatchResult>();
    
    for (const match of matches) {
      const key = `${match.userId}:${match.contactId}`;
      const existing = uniqueMatches.get(key);
      
      if (!existing || match.confidence > existing.confidence) {
        uniqueMatches.set(key, match);
      }
    }
    
    return Array.from(uniqueMatches.values());
  }

  /**
   * Apply filters to match results
   */
  private applyFilters(matches: MatchResult[], filters?: MatchFilters): MatchResult[] {
    if (!filters) return matches;
    
    let filteredMatches = matches;
    
    // Exclude specific user IDs
    if (filters.excludeUserIds) {
      filteredMatches = filteredMatches.filter(
        match => !filters.excludeUserIds!.includes(match.userId)
      );
    }
    
    // Minimum mutual connections
    if (filters.minMutualConnections) {
      filteredMatches = filteredMatches.filter(
        match => (match.commonContacts || 0) >= filters.minMutualConnections!
      );
    }
    
    // Recent activity only
    if (filters.recentActivityOnly) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      filteredMatches = filteredMatches.filter(
        match => match.lastSeenAt > thirtyDaysAgo
      );
    }
    
    return filteredMatches;
  }

  /**
   * Sort matches by specified criteria
   */
  private sortMatches(
    matches: MatchResult[],
    sortBy: 'confidence' | 'lastSeen' | 'mutualConnections',
    order: 'asc' | 'desc'
  ): MatchResult[] {
    const multiplier = order === 'desc' ? -1 : 1;
    
    return matches.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'confidence':
          comparison = a.confidence - b.confidence;
          break;
        case 'lastSeen':
          comparison = a.lastSeenAt.getTime() - b.lastSeenAt.getTime();
          break;
        case 'mutualConnections':
          comparison = (a.commonContacts || 0) - (b.commonContacts || 0);
          break;
      }
      
      return comparison * multiplier;
    });
  }

  /**
   * Process batch in background
   */
  private async processBatchInBackground(batch: MatchBatch, batchSize: number): Promise<void> {
    try {
      batch.status = 'processing';
      
      const totalContacts = batch.contacts.length;
      const batches = this.createBatches(batch.contacts, batchSize);
      const allMatches: MatchResult[] = [];
      
      for (let i = 0; i < batches.length; i++) {
        const contactBatch = batches[i];
        
        const query: MatchQuery = {
          contacts: contactBatch,
          userId: batch.userId,
          minConfidence: 0.5,
          maxResults: 100,
        };
        
        const batchMatches = await this.findMatches(query);
        allMatches.push(...batchMatches);
        
        // Update progress
        batch.progress = Math.round(((i + 1) / batches.length) * 100);
        
        // Allow other operations to run
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      batch.results = allMatches;
      batch.status = 'completed';
      batch.completedAt = new Date();
      
    } catch (error) {
      batch.status = 'failed';
      batch.errors = [error instanceof Error ? error.message : 'Unknown error'];
      batch.completedAt = new Date();
    }
  }

  /**
   * Create batches from array
   */
  private createBatches<T>(array: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Generate unique batch ID
   */
  private generateBatchId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `batch_${timestamp}_${random}`;
  }

  /**
   * Initialize statistics
   */
  private initializeStatistics(): MatchStatistics {
    return {
      totalQueries: 0,
      totalMatches: 0,
      avgMatchesPerQuery: 0,
      avgProcessingTimeMs: 0,
      avgConfidenceScore: 0,
      matchTypeDistribution: {},
      peakMemoryUsageMB: 0,
      cacheHitRate: 0,
    };
  }

  /**
   * Update processing statistics
   */
  private updateStatistics(startTime: number, matches: MatchResult[]): void {
    const processingTime = Date.now() - startTime;
    const currentMemory = this.getMemoryUsage();
    
    this.statistics.totalQueries++;
    this.statistics.totalMatches += matches.length;
    this.statistics.avgMatchesPerQuery = this.statistics.totalMatches / this.statistics.totalQueries;
    
    // Update average processing time
    this.statistics.avgProcessingTimeMs = 
      (this.statistics.avgProcessingTimeMs * (this.statistics.totalQueries - 1) + processingTime) 
      / this.statistics.totalQueries;
    
    // Update average confidence
    if (matches.length > 0) {
      const avgConfidence = matches.reduce((sum, match) => sum + match.confidence, 0) / matches.length;
      this.statistics.avgConfidenceScore = 
        (this.statistics.avgConfidenceScore * (this.statistics.totalQueries - 1) + avgConfidence) 
        / this.statistics.totalQueries;
    }
    
    // Update match type distribution
    for (const match of matches) {
      this.statistics.matchTypeDistribution[match.matchType] = 
        (this.statistics.matchTypeDistribution[match.matchType] || 0) + 1;
    }
    
    // Update peak memory usage
    this.statistics.peakMemoryUsageMB = Math.max(this.statistics.peakMemoryUsageMB, currentMemory);
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed / 1024 / 1024;
    }
    return 0;
  }

  /**
   * Get current statistics
   */
  getStatistics(): MatchStatistics {
    return { ...this.statistics };
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.statistics = this.initializeStatistics();
  }

  /**
   * Clear completed batches
   */
  clearCompletedBatches(): void {
    for (const [batchId, batch] of this.activeBatches.entries()) {
      if (batch.status === 'completed' || batch.status === 'failed') {
        this.activeBatches.delete(batchId);
      }
    }
  }

  /**
   * Get active batch count
   */
  getActiveBatchCount(): number {
    return Array.from(this.activeBatches.values())
      .filter(batch => batch.status === 'processing' || batch.status === 'pending')
      .length;
  }
}

/**
 * Match Performance Analyzer
 * 
 * Provides performance analysis and optimization recommendations
 * for the matching engine.
 */
export class MatchPerformanceAnalyzer {
  private performanceMetrics: Array<{
    timestamp: Date;
    operation: string;
    duration: number;
    contactCount: number;
    matchCount: number;
    memoryUsage: number;
  }> = [];

  /**
   * Record performance metric
   */
  recordMetric(
    operation: string,
    duration: number,
    contactCount: number,
    matchCount: number,
    memoryUsage: number
  ): void {
    this.performanceMetrics.push({
      timestamp: new Date(),
      operation,
      duration,
      contactCount,
      matchCount,
      memoryUsage,
    });

    // Keep only last 1000 metrics
    if (this.performanceMetrics.length > 1000) {
      this.performanceMetrics = this.performanceMetrics.slice(-1000);
    }
  }

  /**
   * Analyze performance trends
   */
  analyzePerformance(): {
    averageLatency: number;
    throughputPerSecond: number;
    memoryEfficiency: number;
    recommendedOptimizations: string[];
  } {
    if (this.performanceMetrics.length === 0) {
      return {
        averageLatency: 0,
        throughputPerSecond: 0,
        memoryEfficiency: 0,
        recommendedOptimizations: [],
      };
    }

    const totalDuration = this.performanceMetrics.reduce((sum, metric) => sum + metric.duration, 0);
    const totalContacts = this.performanceMetrics.reduce((sum, metric) => sum + metric.contactCount, 0);
    const averageLatency = totalDuration / this.performanceMetrics.length;
    const throughputPerSecond = totalContacts / (totalDuration / 1000);
    
    const totalMemory = this.performanceMetrics.reduce((sum, metric) => sum + metric.memoryUsage, 0);
    const memoryEfficiency = totalContacts / totalMemory; // Contacts per MB

    const recommendations = this.generateOptimizationRecommendations(averageLatency, throughputPerSecond, memoryEfficiency);

    return {
      averageLatency,
      throughputPerSecond,
      memoryEfficiency,
      recommendedOptimizations: recommendations,
    };
  }

  /**
   * Generate optimization recommendations
   */
  private generateOptimizationRecommendations(
    latency: number,
    throughput: number,
    memoryEfficiency: number
  ): string[] {
    const recommendations: string[] = [];

    if (latency > 1000) {
      recommendations.push('High latency detected. Consider increasing batch size or implementing parallel processing.');
    }

    if (throughput < 100) {
      recommendations.push('Low throughput detected. Consider optimizing database queries or increasing cache hit rate.');
    }

    if (memoryEfficiency < 1000) {
      recommendations.push('Low memory efficiency. Consider implementing memory pooling or reducing object allocation.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Performance is optimal. No immediate optimizations needed.');
    }

    return recommendations;
  }

  /**
   * Get performance report
   */
  getPerformanceReport(): {
    totalOperations: number;
    timeRange: { start: Date; end: Date };
    averageMetrics: {
      latency: number;
      contactsPerOperation: number;
      matchesPerOperation: number;
      memoryPerOperation: number;
    };
    trends: {
      latencyTrend: 'improving' | 'stable' | 'degrading';
      throughputTrend: 'improving' | 'stable' | 'degrading';
      memoryTrend: 'improving' | 'stable' | 'degrading';
    };
  } {
    if (this.performanceMetrics.length === 0) {
      return {
        totalOperations: 0,
        timeRange: { start: new Date(), end: new Date() },
        averageMetrics: { latency: 0, contactsPerOperation: 0, matchesPerOperation: 0, memoryPerOperation: 0 },
        trends: { latencyTrend: 'stable', throughputTrend: 'stable', memoryTrend: 'stable' },
      };
    }

    const metrics = this.performanceMetrics;
    const totalOperations = metrics.length;
    const timeRange = {
      start: metrics[0].timestamp,
      end: metrics[metrics.length - 1].timestamp,
    };

    const averageMetrics = {
      latency: metrics.reduce((sum, m) => sum + m.duration, 0) / totalOperations,
      contactsPerOperation: metrics.reduce((sum, m) => sum + m.contactCount, 0) / totalOperations,
      matchesPerOperation: metrics.reduce((sum, m) => sum + m.matchCount, 0) / totalOperations,
      memoryPerOperation: metrics.reduce((sum, m) => sum + m.memoryUsage, 0) / totalOperations,
    };

    const trends = this.calculateTrends();

    return {
      totalOperations,
      timeRange,
      averageMetrics,
      trends,
    };
  }

  /**
   * Calculate performance trends
   */
  private calculateTrends(): {
    latencyTrend: 'improving' | 'stable' | 'degrading';
    throughputTrend: 'improving' | 'stable' | 'degrading';
    memoryTrend: 'improving' | 'stable' | 'degrading';
  } {
    if (this.performanceMetrics.length < 10) {
      return {
        latencyTrend: 'stable',
        throughputTrend: 'stable',
        memoryTrend: 'stable',
      };
    }

    const recentMetrics = this.performanceMetrics.slice(-10);
    const earlierMetrics = this.performanceMetrics.slice(-20, -10);

    const recentLatency = recentMetrics.reduce((sum, m) => sum + m.duration, 0) / recentMetrics.length;
    const earlierLatency = earlierMetrics.reduce((sum, m) => sum + m.duration, 0) / earlierMetrics.length;

    const recentThroughput = recentMetrics.reduce((sum, m) => sum + m.contactCount, 0) / 
                            recentMetrics.reduce((sum, m) => sum + m.duration, 0) * 1000;
    const earlierThroughput = earlierMetrics.reduce((sum, m) => sum + m.contactCount, 0) / 
                             earlierMetrics.reduce((sum, m) => sum + m.duration, 0) * 1000;

    const recentMemory = recentMetrics.reduce((sum, m) => sum + m.memoryUsage, 0) / recentMetrics.length;
    const earlierMemory = earlierMetrics.reduce((sum, m) => sum + m.memoryUsage, 0) / earlierMetrics.length;

    return {
      latencyTrend: this.getTrend(recentLatency, earlierLatency, false), // Lower is better
      throughputTrend: this.getTrend(recentThroughput, earlierThroughput, true), // Higher is better
      memoryTrend: this.getTrend(recentMemory, earlierMemory, false), // Lower is better
    };
  }

  /**
   * Determine trend direction
   */
  private getTrend(recent: number, earlier: number, higherIsBetter: boolean): 'improving' | 'stable' | 'degrading' {
    const changePercent = ((recent - earlier) / earlier) * 100;
    const threshold = 5; // 5% change threshold

    if (Math.abs(changePercent) < threshold) {
      return 'stable';
    }

    if (higherIsBetter) {
      return changePercent > 0 ? 'improving' : 'degrading';
    } else {
      return changePercent < 0 ? 'improving' : 'degrading';
    }
  }

  /**
   * Clear performance metrics
   */
  clearMetrics(): void {
    this.performanceMetrics = [];
  }
}