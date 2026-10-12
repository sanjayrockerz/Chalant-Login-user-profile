import * as crypto from 'crypto';

/**
 * Advanced Deduplication Engine for Contact Import System
 * 
 * Provides comprehensive deduplication capabilities using multiple algorithms:
 * - Hash sets for exact duplicate detection
 * - Bloom filters for memory-efficient approximate duplicate detection
 * - Similarity-based fuzzy deduplication
 * - Cross-upload deduplication tracking
 * - Batch processing optimization
 * 
 * Features:
 * - Memory-efficient processing of large contact lists
 * - Configurable similarity thresholds
 * - Performance metrics and monitoring
 * - Automatic cleanup and TTL management
 */

// Deduplication result types
interface DeduplicationResult {
  totalContacts: number;
  duplicatesFound: number;
  uniqueContacts: number;
  withinUploadDuplicates: number;
  crossUploadDuplicates: number;
  processingTimeMs: number;
  memoryUsageMB: number;
}

interface DuplicateMatch {
  originalIndex: number;
  duplicateIndex: number;
  matchType: 'exact' | 'fuzzy' | 'cross_upload';
  similarity: number;
  field: 'phone' | 'email' | 'name' | 'composite';
}

interface ContactRecord {
  id?: string;
  phone?: string;
  email?: string;
  name?: string;
  normalizedPhone?: string;
  normalizedEmail?: string;
  normalizedName?: string;
  signature?: string;
}

// Bloom filter configuration
interface BloomFilterConfig {
  expectedElements: number;
  falsePositiveRate: number;
  bitArraySize: number;
  hashFunctions: number;
}

// Performance metrics
interface DeduplicationMetrics {
  totalOperations: number;
  avgProcessingTime: number;
  peakMemoryUsage: number;
  duplicateDetectionRate: number;
  falsePositiveRate: number;
}

/**
 * Hash Set Deduplication Service
 * 
 * Provides exact duplicate detection using hash sets for O(1) lookup performance.
 */
export class HashSetDeduplicationService {
  private readonly duplicateCache = new Map<string, number>();
  private readonly signatureCache = new Set<string>();
  
  /**
   * Detect exact duplicates within a contact list using hash sets
   */
  detectExactDuplicates(contacts: ContactRecord[]): {
    duplicates: DuplicateMatch[];
    uniqueContacts: ContactRecord[];
    stats: DeduplicationResult;
  } {
    const startTime = Date.now();
    const initialMemory = this.getMemoryUsage();
    
    const duplicates: DuplicateMatch[] = [];
    const uniqueContacts: ContactRecord[] = [];
    const seenHashes = new Map<string, number>();
    
    let duplicateCount = 0;
    
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const signatures = this.generateContactSignatures(contact);
      
      let isDuplicate = false;
      let originalIndex = -1;
      
      // Check each signature for duplicates
      for (const { field, signature } of signatures) {
        const existingIndex = seenHashes.get(signature);
        
        if (existingIndex !== undefined) {
          duplicates.push({
            originalIndex: existingIndex,
            duplicateIndex: i,
            matchType: 'exact',
            similarity: 1.0,
            field,
          });
          
          isDuplicate = true;
          originalIndex = existingIndex;
          duplicateCount++;
          break;
        }
      }
      
      if (!isDuplicate) {
        // Store all signatures for this contact
        for (const { signature } of signatures) {
          seenHashes.set(signature, i);
        }
        uniqueContacts.push(contact);
      }
    }
    
    const processingTime = Date.now() - startTime;
    const finalMemory = this.getMemoryUsage();
    
    return {
      duplicates,
      uniqueContacts,
      stats: {
        totalContacts: contacts.length,
        duplicatesFound: duplicateCount,
        uniqueContacts: uniqueContacts.length,
        withinUploadDuplicates: duplicateCount,
        crossUploadDuplicates: 0,
        processingTimeMs: processingTime,
        memoryUsageMB: finalMemory - initialMemory,
      },
    };
  }

  /**
   * Generate multiple signatures for a contact
   */
  private generateContactSignatures(contact: ContactRecord): Array<{
    field: 'phone' | 'email' | 'name' | 'composite';
    signature: string;
  }> {
    const signatures: Array<{ field: 'phone' | 'email' | 'name' | 'composite'; signature: string }> = [];
    
    // Phone signature
    if (contact.normalizedPhone) {
      signatures.push({
        field: 'phone',
        signature: this.hashValue(`phone:${contact.normalizedPhone}`),
      });
    }
    
    // Email signature
    if (contact.normalizedEmail) {
      signatures.push({
        field: 'email',
        signature: this.hashValue(`email:${contact.normalizedEmail}`),
      });
    }
    
    // Name signature (if available)
    if (contact.normalizedName) {
      signatures.push({
        field: 'name',
        signature: this.hashValue(`name:${contact.normalizedName}`),
      });
    }
    
    // Composite signature for multi-field matching
    const compositeParts = [];
    if (contact.normalizedPhone) compositeParts.push(`phone:${contact.normalizedPhone}`);
    if (contact.normalizedEmail) compositeParts.push(`email:${contact.normalizedEmail}`);
    
    if (compositeParts.length > 1) {
      signatures.push({
        field: 'composite',
        signature: this.hashValue(compositeParts.sort().join('|')),
      });
    }
    
    return signatures;
  }

  /**
   * Hash a value using SHA-256
   */
  private hashValue(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  /**
   * Get current memory usage in MB
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed / 1024 / 1024;
    }
    return 0;
  }

  /**
   * Clear internal caches
   */
  clearCache(): void {
    this.duplicateCache.clear();
    this.signatureCache.clear();
  }
}

/**
 * Bloom Filter Deduplication Service
 * 
 * Memory-efficient approximate duplicate detection using Bloom filters.
 */
export class BloomFilterDeduplicationService {
  private bloomFilter!: Uint8Array;
  private config: BloomFilterConfig;
  private metrics: DeduplicationMetrics;
  
  constructor(config?: Partial<BloomFilterConfig>) {
    this.config = {
      expectedElements: config?.expectedElements || 1000000,
      falsePositiveRate: config?.falsePositiveRate || 0.01,
      bitArraySize: 0,
      hashFunctions: 0,
    };
    
    this.initializeBloomFilter();
    this.metrics = {
      totalOperations: 0,
      avgProcessingTime: 0,
      peakMemoryUsage: 0,
      duplicateDetectionRate: 0,
      falsePositiveRate: 0,
    };
  }

  /**
   * Initialize Bloom filter with calculated parameters
   */
  private initializeBloomFilter(): void {
    const { expectedElements, falsePositiveRate } = this.config;
    
    // Calculate optimal bit array size: m = -n * ln(p) / (ln(2)^2)
    const bitArraySize = Math.ceil(
      (-expectedElements * Math.log(falsePositiveRate)) / (Math.log(2) ** 2)
    );
    
    // Calculate optimal number of hash functions: k = (m/n) * ln(2)
    const hashFunctions = Math.ceil((bitArraySize / expectedElements) * Math.log(2));
    
    this.config.bitArraySize = bitArraySize;
    this.config.hashFunctions = Math.min(hashFunctions, 10); // Cap at 10 for performance
    
    // Initialize bit array
    this.bloomFilter = new Uint8Array(Math.ceil(bitArraySize / 8));
    
    console.log('Bloom filter initialized:', {
      expectedElements,
      falsePositiveRate,
      bitArraySize,
      hashFunctions: this.config.hashFunctions,
      memoryUsageKB: this.bloomFilter.length / 1024,
    });
  }

  /**
   * Add contact signatures to Bloom filter
   */
  addContacts(contacts: ContactRecord[]): void {
    const startTime = Date.now();
    
    for (const contact of contacts) {
      const signatures = this.generateSignatures(contact);
      for (const signature of signatures) {
        this.addToFilter(signature);
      }
    }
    
    this.updateMetrics(Date.now() - startTime, contacts.length);
  }

  /**
   * Check if contacts might be duplicates
   */
  checkDuplicates(contacts: ContactRecord[]): {
    possibleDuplicates: Array<{ contact: ContactRecord; index: number; probability: number }>;
    stats: DeduplicationResult;
  } {
    const startTime = Date.now();
    const possibleDuplicates: Array<{ contact: ContactRecord; index: number; probability: number }> = [];
    
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const signatures = this.generateSignatures(contact);
      
      let maxProbability = 0;
      for (const signature of signatures) {
        if (this.mightContain(signature)) {
          maxProbability = Math.max(maxProbability, this.estimateProbability(signature));
        }
      }
      
      if (maxProbability > 0) {
        possibleDuplicates.push({
          contact,
          index: i,
          probability: maxProbability,
        });
      }
    }
    
    const processingTime = Date.now() - startTime;
    
    return {
      possibleDuplicates,
      stats: {
        totalContacts: contacts.length,
        duplicatesFound: possibleDuplicates.length,
        uniqueContacts: contacts.length - possibleDuplicates.length,
        withinUploadDuplicates: 0,
        crossUploadDuplicates: possibleDuplicates.length,
        processingTimeMs: processingTime,
        memoryUsageMB: this.bloomFilter.length / 1024 / 1024,
      },
    };
  }

  /**
   * Add signature to Bloom filter
   */
  private addToFilter(signature: string): void {
    const hashes = this.generateHashes(signature);
    
    for (const hash of hashes) {
      const bitIndex = hash % this.config.bitArraySize;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      
      this.bloomFilter[byteIndex] |= 1 << bitOffset;
    }
  }

  /**
   * Check if signature might be in filter
   */
  private mightContain(signature: string): boolean {
    const hashes = this.generateHashes(signature);
    
    for (const hash of hashes) {
      const bitIndex = hash % this.config.bitArraySize;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      
      if ((this.bloomFilter[byteIndex] & (1 << bitOffset)) === 0) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Generate hash values for signature
   */
  private generateHashes(signature: string): number[] {
    const hashes: number[] = [];
    
    for (let i = 0; i < this.config.hashFunctions; i++) {
      const hash = crypto.createHash('sha256');
      hash.update(signature + i.toString());
      const digest = hash.digest();
      
      // Convert first 4 bytes to number
      const hashValue = digest.readUInt32BE(0);
      hashes.push(hashValue);
    }
    
    return hashes;
  }

  /**
   * Generate signatures for contact
   */
  private generateSignatures(contact: ContactRecord): string[] {
    const signatures: string[] = [];
    
    if (contact.normalizedPhone) {
      signatures.push(`phone:${contact.normalizedPhone}`);
    }
    
    if (contact.normalizedEmail) {
      signatures.push(`email:${contact.normalizedEmail}`);
    }
    
    if (contact.normalizedName) {
      signatures.push(`name:${contact.normalizedName}`);
    }
    
    return signatures;
  }

  /**
   * Estimate probability of being a true positive
   */
  private estimateProbability(signature: string): number {
    // Simple estimation based on current false positive rate
    return 1 - this.config.falsePositiveRate;
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(processingTime: number, contactCount: number): void {
    this.metrics.totalOperations++;
    this.metrics.avgProcessingTime = 
      (this.metrics.avgProcessingTime * (this.metrics.totalOperations - 1) + processingTime) 
      / this.metrics.totalOperations;
  }

  /**
   * Get current metrics
   */
  getMetrics(): DeduplicationMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset Bloom filter
   */
  reset(): void {
    this.bloomFilter.fill(0);
    this.metrics = {
      totalOperations: 0,
      avgProcessingTime: 0,
      peakMemoryUsage: 0,
      duplicateDetectionRate: 0,
      falsePositiveRate: 0,
    };
  }

  /**
   * Get filter statistics
   */
  getFilterStats(): {
    config: BloomFilterConfig;
    fillRatio: number;
    estimatedElements: number;
    memoryUsageKB: number;
  } {
    let setBits = 0;
    for (let i = 0; i < this.bloomFilter.length; i++) {
      setBits += this.popCount(this.bloomFilter[i]);
    }
    
    const fillRatio = setBits / this.config.bitArraySize;
    const estimatedElements = -this.config.bitArraySize * Math.log(1 - fillRatio) / this.config.hashFunctions;
    
    return {
      config: this.config,
      fillRatio,
      estimatedElements,
      memoryUsageKB: this.bloomFilter.length / 1024,
    };
  }

  /**
   * Count set bits in a byte
   */
  private popCount(byte: number): number {
    let count = 0;
    while (byte) {
      count += byte & 1;
      byte >>= 1;
    }
    return count;
  }
}

/**
 * Fuzzy Deduplication Service
 * 
 * Similarity-based duplicate detection for handling variations
 * in contact information that aren't caught by exact matching.
 */
export class FuzzyDeduplicationService {
  private readonly similarityThreshold: number;
  
  constructor(similarityThreshold: number = 0.85) {
    this.similarityThreshold = similarityThreshold;
  }

  /**
   * Detect fuzzy duplicates using similarity algorithms
   */
  detectFuzzyDuplicates(contacts: ContactRecord[]): {
    duplicates: DuplicateMatch[];
    clusters: ContactRecord[][];
    stats: DeduplicationResult;
  } {
    const startTime = Date.now();
    const duplicates: DuplicateMatch[] = [];
    const clusters: ContactRecord[][] = [];
    const processed = new Set<number>();
    
    for (let i = 0; i < contacts.length; i++) {
      if (processed.has(i)) continue;
      
      const cluster = [contacts[i]];
      processed.add(i);
      
      for (let j = i + 1; j < contacts.length; j++) {
        if (processed.has(j)) continue;
        
        const similarity = this.calculateContactSimilarity(contacts[i], contacts[j]);
        
        if (similarity >= this.similarityThreshold) {
          cluster.push(contacts[j]);
          processed.add(j);
          
          duplicates.push({
            originalIndex: i,
            duplicateIndex: j,
            matchType: 'fuzzy',
            similarity,
            field: 'composite',
          });
        }
      }
      
      clusters.push(cluster);
    }
    
    const processingTime = Date.now() - startTime;
    
    return {
      duplicates,
      clusters,
      stats: {
        totalContacts: contacts.length,
        duplicatesFound: duplicates.length,
        uniqueContacts: clusters.length,
        withinUploadDuplicates: duplicates.length,
        crossUploadDuplicates: 0,
        processingTimeMs: processingTime,
        memoryUsageMB: this.getMemoryUsage(),
      },
    };
  }

  /**
   * Calculate similarity between two contacts
   */
  private calculateContactSimilarity(contact1: ContactRecord, contact2: ContactRecord): number {
    const scores: number[] = [];
    const weights: number[] = [];
    
    // Phone similarity
    if (contact1.normalizedPhone && contact2.normalizedPhone) {
      scores.push(this.calculatePhoneSimilarity(contact1.normalizedPhone, contact2.normalizedPhone));
      weights.push(0.4);
    }
    
    // Email similarity
    if (contact1.normalizedEmail && contact2.normalizedEmail) {
      scores.push(this.calculateEmailSimilarity(contact1.normalizedEmail, contact2.normalizedEmail));
      weights.push(0.4);
    }
    
    // Name similarity
    if (contact1.normalizedName && contact2.normalizedName) {
      scores.push(this.calculateNameSimilarity(contact1.normalizedName, contact2.normalizedName));
      weights.push(0.2);
    }
    
    // Calculate weighted average
    if (scores.length === 0) return 0;
    
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const weightedSum = scores.reduce((sum, score, index) => sum + score * weights[index], 0);
    
    return weightedSum / totalWeight;
  }

  /**
   * Calculate phone number similarity
   */
  private calculatePhoneSimilarity(phone1: string, phone2: string): number {
    // Exact match
    if (phone1 === phone2) return 1.0;
    
    // Remove country codes and compare
    const digits1 = phone1.replace(/^\+\d{1,3}/, '');
    const digits2 = phone2.replace(/^\+\d{1,3}/, '');
    
    if (digits1 === digits2) return 0.95;
    
    // Levenshtein similarity
    return this.calculateLevenshteinSimilarity(phone1, phone2);
  }

  /**
   * Calculate email similarity
   */
  private calculateEmailSimilarity(email1: string, email2: string): number {
    // Exact match
    if (email1 === email2) return 1.0;
    
    const [local1, domain1] = email1.split('@');
    const [local2, domain2] = email2.split('@');
    
    // Same domain is a strong indicator
    if (domain1 === domain2) {
      return 0.7 + 0.3 * this.calculateLevenshteinSimilarity(local1, local2);
    }
    
    // Different domains - lower similarity
    return 0.3 * this.calculateLevenshteinSimilarity(email1, email2);
  }

  /**
   * Calculate name similarity
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    // Exact match
    if (name1 === name2) return 1.0;
    
    const parts1 = name1.split(' ');
    const parts2 = name2.split(' ');
    
    // Jaccard similarity for name parts
    const set1 = new Set(parts1);
    const set2 = new Set(parts2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    const jaccardSimilarity = intersection.size / union.size;
    
    // Also consider string similarity
    const stringSimilarity = this.calculateLevenshteinSimilarity(name1, name2);
    
    return Math.max(jaccardSimilarity, stringSimilarity);
  }

  /**
   * Calculate Levenshtein similarity
   */
  private calculateLevenshteinSimilarity(str1: string, str2: string): number {
    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    return maxLength === 0 ? 1 : 1 - distance / maxLength;
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + cost
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Get memory usage
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed / 1024 / 1024;
    }
    return 0;
  }
}

/**
 * Comprehensive Deduplication Engine
 * 
 * Combines all deduplication strategies for optimal duplicate detection.
 */
export class DeduplicationEngine {
  private readonly hashSetService: HashSetDeduplicationService;
  private readonly bloomFilterService: BloomFilterDeduplicationService;
  private readonly fuzzyService: FuzzyDeduplicationService;
  
  constructor(
    bloomConfig?: Partial<BloomFilterConfig>,
    fuzzyThreshold: number = 0.85
  ) {
    this.hashSetService = new HashSetDeduplicationService();
    this.bloomFilterService = new BloomFilterDeduplicationService(bloomConfig);
    this.fuzzyService = new FuzzyDeduplicationService(fuzzyThreshold);
  }

  /**
   * Comprehensive deduplication using all strategies
   */
  deduplicateContacts(
    contacts: ContactRecord[],
    options: {
      enableExactMatching: boolean;
      enableFuzzyMatching: boolean;
      enableCrossUploadCheck: boolean;
      batchSize?: number;
    } = {
      enableExactMatching: true,
      enableFuzzyMatching: true,
      enableCrossUploadCheck: true,
      batchSize: 1000,
    }
  ): {
    uniqueContacts: ContactRecord[];
    allDuplicates: DuplicateMatch[];
    exactDuplicates: DuplicateMatch[];
    fuzzyDuplicates: DuplicateMatch[];
    crossUploadDuplicates: DuplicateMatch[];
    stats: DeduplicationResult;
  } {
    const startTime = Date.now();
    const allDuplicates: DuplicateMatch[] = [];
    let uniqueContacts = [...contacts];
    
    let exactDuplicates: DuplicateMatch[] = [];
    let fuzzyDuplicates: DuplicateMatch[] = [];
    let crossUploadDuplicates: DuplicateMatch[] = [];

    // Step 1: Exact deduplication
    if (options.enableExactMatching) {
      const exactResult = this.hashSetService.detectExactDuplicates(uniqueContacts);
      exactDuplicates = exactResult.duplicates;
      uniqueContacts = exactResult.uniqueContacts;
      allDuplicates.push(...exactDuplicates);
    }

    // Step 2: Cross-upload duplicate check
    if (options.enableCrossUploadCheck) {
      const crossUploadResult = this.bloomFilterService.checkDuplicates(uniqueContacts);
      // Convert possible duplicates to duplicate matches
      crossUploadDuplicates = crossUploadResult.possibleDuplicates.map((dup, index) => ({
        originalIndex: -1, // Unknown original
        duplicateIndex: dup.index,
        matchType: 'cross_upload' as const,
        similarity: dup.probability,
        field: 'composite' as const,
      }));
      allDuplicates.push(...crossUploadDuplicates);
    }

    // Step 3: Fuzzy deduplication (on remaining contacts)
    if (options.enableFuzzyMatching && uniqueContacts.length > 0) {
      const fuzzyResult = this.fuzzyService.detectFuzzyDuplicates(uniqueContacts);
      fuzzyDuplicates = fuzzyResult.duplicates;
      allDuplicates.push(...fuzzyDuplicates);
      
      // Remove fuzzy duplicates from final unique list
      const fuzzyDuplicateIndices = new Set(fuzzyDuplicates.map(d => d.duplicateIndex));
      uniqueContacts = uniqueContacts.filter((_, index) => !fuzzyDuplicateIndices.has(index));
    }

    const processingTime = Date.now() - startTime;

    const stats: DeduplicationResult = {
      totalContacts: contacts.length,
      duplicatesFound: allDuplicates.length,
      uniqueContacts: uniqueContacts.length,
      withinUploadDuplicates: exactDuplicates.length + fuzzyDuplicates.length,
      crossUploadDuplicates: crossUploadDuplicates.length,
      processingTimeMs: processingTime,
      memoryUsageMB: this.getMemoryUsage(),
    };

    return {
      uniqueContacts,
      allDuplicates,
      exactDuplicates,
      fuzzyDuplicates,
      crossUploadDuplicates,
      stats,
    };
  }

  /**
   * Batch process large contact lists
   */
  async batchDeduplicateContacts(
    contacts: ContactRecord[],
    batchSize: number = 1000,
    options: {
      enableExactMatching?: boolean;
      enableFuzzyMatching?: boolean;
      enableCrossUploadCheck?: boolean;
    } = {}
  ): Promise<{
    uniqueContacts: ContactRecord[];
    allDuplicates: DuplicateMatch[];
    stats: DeduplicationResult;
  }> {
    const batches = this.createBatches(contacts, batchSize);
    const allUniqueContacts: ContactRecord[] = [];
    const allDuplicates: DuplicateMatch[] = [];
    
    let totalProcessingTime = 0;
    let totalMemoryUsage = 0;
    
    // Set default options
    const mergedOptions = {
      enableExactMatching: options.enableExactMatching ?? true,
      enableFuzzyMatching: options.enableFuzzyMatching ?? true,
      enableCrossUploadCheck: options.enableCrossUploadCheck ?? true,
      batchSize,
    };
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const result = this.deduplicateContacts(batch, mergedOptions);
      
      // Adjust indices for global context
      const indexOffset = i * batchSize;
      const adjustedDuplicates = result.allDuplicates.map(dup => ({
        ...dup,
        originalIndex: dup.originalIndex >= 0 ? dup.originalIndex + indexOffset : -1,
        duplicateIndex: dup.duplicateIndex + indexOffset,
      }));
      
      allUniqueContacts.push(...result.uniqueContacts);
      allDuplicates.push(...adjustedDuplicates);
      
      totalProcessingTime += result.stats.processingTimeMs;
      totalMemoryUsage = Math.max(totalMemoryUsage, result.stats.memoryUsageMB);
      
      // Allow event loop to breathe
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    return {
      uniqueContacts: allUniqueContacts,
      allDuplicates,
      stats: {
        totalContacts: contacts.length,
        duplicatesFound: allDuplicates.length,
        uniqueContacts: allUniqueContacts.length,
        withinUploadDuplicates: allDuplicates.filter(d => d.matchType !== 'cross_upload').length,
        crossUploadDuplicates: allDuplicates.filter(d => d.matchType === 'cross_upload').length,
        processingTimeMs: totalProcessingTime,
        memoryUsageMB: totalMemoryUsage,
      },
    };
  }

  /**
   * Create batches from contact array
   */
  private createBatches<T>(array: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Update cross-upload tracking with new contacts
   */
  updateCrossUploadTracking(contacts: ContactRecord[]): void {
    this.bloomFilterService.addContacts(contacts);
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics(): {
    bloomFilter: DeduplicationMetrics;
    filterStats: ReturnType<BloomFilterDeduplicationService['getFilterStats']>;
  } {
    return {
      bloomFilter: this.bloomFilterService.getMetrics(),
      filterStats: this.bloomFilterService.getFilterStats(),
    };
  }

  /**
   * Reset all deduplication services
   */
  reset(): void {
    this.hashSetService.clearCache();
    this.bloomFilterService.reset();
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
}

/**
 * Deduplication Performance Tester
 * 
 * Utilities for testing and benchmarking deduplication performance.
 */
export class DeduplicationPerformanceTester {
  /**
   * Generate test contact data
   */
  generateTestContacts(count: number, duplicateRate: number = 0.1): ContactRecord[] {
    const contacts: ContactRecord[] = [];
    const baseContacts: ContactRecord[] = [];
    
    // Generate base unique contacts
    const uniqueCount = Math.floor(count * (1 - duplicateRate));
    for (let i = 0; i < uniqueCount; i++) {
      baseContacts.push({
        id: `contact_${i}`,
        phone: this.generateRandomPhone(),
        email: this.generateRandomEmail(),
        name: this.generateRandomName(),
      });
    }
    
    contacts.push(...baseContacts);
    
    // Generate duplicates
    const duplicateCount = count - uniqueCount;
    for (let i = 0; i < duplicateCount; i++) {
      const originalIndex = Math.floor(Math.random() * baseContacts.length);
      const original = baseContacts[originalIndex];
      
      // Create slight variations
      contacts.push({
        id: `duplicate_${i}`,
        phone: this.varyPhone(original.phone || ''),
        email: this.varyEmail(original.email || ''),
        name: this.varyName(original.name || ''),
      });
    }
    
    // Shuffle the array
    return this.shuffleArray(contacts);
  }

  /**
   * Run performance benchmark
   */
  async runBenchmark(
    contactCounts: number[],
    duplicateRates: number[] = [0.05, 0.1, 0.15, 0.2]
  ): Promise<any[]> {
    const results = [];
    
    for (const count of contactCounts) {
      for (const rate of duplicateRates) {
        const contacts = this.generateTestContacts(count, rate);
        const engine = new DeduplicationEngine();
        
        const startTime = Date.now();
        const result = await engine.batchDeduplicateContacts(contacts);
        const endTime = Date.now();
        
        results.push({
          contactCount: count,
          duplicateRate: rate,
          processingTimeMs: endTime - startTime,
          memoryUsageMB: result.stats.memoryUsageMB,
          duplicatesDetected: result.stats.duplicatesFound,
          accuracy: this.calculateAccuracy(result.allDuplicates, count * rate),
        });
        
        // Cleanup
        engine.reset();
      }
    }
    
    return results;
  }

  private generateRandomPhone(): string {
    const areaCode = Math.floor(Math.random() * 900) + 100;
    const exchange = Math.floor(Math.random() * 900) + 100;
    const number = Math.floor(Math.random() * 9000) + 1000;
    return `+1${areaCode}${exchange}${number}`;
  }

  private generateRandomEmail(): string {
    const names = ['john', 'jane', 'bob', 'alice', 'charlie', 'diana'];
    const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'example.com'];
    const name = names[Math.floor(Math.random() * names.length)];
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const number = Math.floor(Math.random() * 1000);
    return `${name}${number}@${domain}`;
  }

  private generateRandomName(): string {
    const firstNames = ['John', 'Jane', 'Bob', 'Alice', 'Charlie', 'Diana'];
    const lastNames = ['Smith', 'Johnson', 'Brown', 'Davis', 'Wilson', 'Miller'];
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    return `${first} ${last}`;
  }

  private varyPhone(phone: string): string {
    // Add random formatting variations
    const variations = [
      phone,
      phone.replace(/^\+1/, '1'),
      phone.replace(/(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3'),
      phone.replace(/(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3'),
    ];
    return variations[Math.floor(Math.random() * variations.length)];
  }

  private varyEmail(email: string): string {
    // Add random variations
    if (email.includes('gmail.com')) {
      const [local, domain] = email.split('@');
      // Add dots to Gmail address
      const withDots = local.slice(0, 2) + '.' + local.slice(2);
      return `${withDots}@${domain}`;
    }
    return email;
  }

  private varyName(name: string): string {
    // Add random case variations
    const variations = [
      name,
      name.toLowerCase(),
      name.toUpperCase(),
      name.split(' ').map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' '),
    ];
    return variations[Math.floor(Math.random() * variations.length)];
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private calculateAccuracy(detectedDuplicates: DuplicateMatch[], expectedDuplicates: number): number {
    if (expectedDuplicates === 0) return detectedDuplicates.length === 0 ? 1 : 0;
    return Math.min(detectedDuplicates.length / expectedDuplicates, 1);
  }
}