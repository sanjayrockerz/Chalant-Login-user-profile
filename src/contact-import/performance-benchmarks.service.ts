import { ContactMatchingService } from './matching.service';
import { ContactNormalizationService } from './normalization.service';
import { DeduplicationEngine } from './deduplication.service';
import { ContactCacheService } from './contact-cache.service';

/**
 * Comprehensive Performance Benchmark Suite for Contact Discovery System
 * 
 * This suite provides extensive performance testing capabilities for:
 * - Contact normalization performance under various loads
 * - Deduplication algorithm efficiency with different dataset sizes
 * - Matching engine throughput and latency analysis
 * - Memory usage patterns and optimization recommendations
 * - Scalability testing and bottleneck identification
 * - Cache performance and hit rate optimization
 * 
 * Features:
 * - Realistic test data generation with configurable parameters
 * - Multi-dimensional performance analysis
 * - Detailed reporting with actionable insights
 * - Load testing with concurrent operations
 * - Memory profiling and leak detection
 * - Performance regression tracking
 */

// Local type definitions for testing
interface MatchQuery {
  contacts: ContactRecord[];
  userId: string;
  minConfidence?: number;
  includeUserSelf?: boolean;
  maxResults?: number;
  filters?: MatchFilters;
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

interface MatchFilters {
  excludeUserIds?: string[];
  minMutualConnections?: number;
  recentActivityOnly?: boolean;
  verifiedContactsOnly?: boolean;
}

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

// Performance test configuration
interface BenchmarkConfig {
  contactCounts: number[];
  duplicateRates: number[];
  iterations: number;
  concurrency: number;
  warmupRuns: number;
  includeMemoryProfiling: boolean;
  includeLoadTesting: boolean;
  outputFormat: 'console' | 'json' | 'csv';
}

// Performance metrics
interface PerformanceMetrics {
  operation: string;
  contactCount: number;
  duplicateRate: number;
  iteration: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  memoryBeforeMB: number;
  memoryAfterMB: number;
  memoryDeltaMB: number;
  peakMemoryMB: number;
  throughputPerSecond: number;
  successRate: number;
  errorCount: number;
  cacheHitRate?: number;
  duplicatesDetected?: number;
  matchesFound?: number;
}

// Benchmark results
interface BenchmarkResults {
  config: BenchmarkConfig;
  metrics: PerformanceMetrics[];
  summary: {
    totalOperations: number;
    totalDuration: number;
    averageLatency: number;
    peakThroughput: number;
    averageMemoryUsage: number;
    peakMemoryUsage: number;
    averageSuccessRate: number;
    recommendations: string[];
  };
  operationBreakdown: {
    normalization: OperationStats;
    deduplication: OperationStats;
    matching: OperationStats;
    caching: OperationStats;
  };
  scalabilityAnalysis: {
    linearityScore: number; // How linear is performance scaling
    bottlenecks: string[];
    optimalBatchSize: number;
    recommendedConcurrency: number;
  };
}

interface OperationStats {
  averageLatency: number;
  throughput: number;
  memoryEfficiency: number;
  errorRate: number;
  recommendations: string[];
}

// Test data generation
interface TestContact {
  id: string;
  phone?: string;
  email?: string;
  name?: string;
  userId?: string;
}

interface TestDataset {
  contacts: TestContact[];
  expectedDuplicates: number;
  expectedMatches: number;
  dataQuality: 'high' | 'medium' | 'low';
}

/**
 * Test Data Generator
 * 
 * Generates realistic test datasets for performance benchmarking.
 */
export class TestDataGenerator {
  private readonly phoneFormats = [
    '+1{areaCode}{exchange}{number}',
    '1{areaCode}{exchange}{number}',
    '({areaCode}) {exchange}-{number}',
    '{areaCode}-{exchange}-{number}',
    '{areaCode}.{exchange}.{number}',
  ];

  private readonly emailDomains = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
    'icloud.com', 'aol.com', 'protonmail.com', 'company.com'
  ];

  private readonly firstNames = [
    'John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily',
    'Christopher', 'Jessica', 'Matthew', 'Ashley', 'Daniel', 'Amanda',
    'James', 'Melissa', 'Robert', 'Jennifer', 'William', 'Linda'
  ];

  private readonly lastNames = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia',
    'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez',
    'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore'
  ];

  /**
   * Generate test dataset with specified parameters
   */
  generateDataset(
    count: number,
    duplicateRate: number = 0.1,
    dataQuality: 'high' | 'medium' | 'low' = 'medium'
  ): TestDataset {
    const uniqueCount = Math.floor(count * (1 - duplicateRate));
    const duplicateCount = count - uniqueCount;
    
    // Generate base contacts
    const baseContacts = this.generateUniqueContacts(uniqueCount, dataQuality);
    const allContacts = [...baseContacts];
    
    // Generate duplicates with variations
    for (let i = 0; i < duplicateCount; i++) {
      const originalIndex = Math.floor(Math.random() * baseContacts.length);
      const original = baseContacts[originalIndex];
      const duplicate = this.createContactVariation(original, dataQuality);
      allContacts.push(duplicate);
    }
    
    // Shuffle array
    this.shuffleArray(allContacts);
    
    return {
      contacts: allContacts,
      expectedDuplicates: duplicateCount,
      expectedMatches: Math.floor(count * 0.05), // Estimate 5% match rate
      dataQuality,
    };
  }

  /**
   * Generate unique contacts
   */
  private generateUniqueContacts(count: number, quality: 'high' | 'medium' | 'low'): TestContact[] {
    const contacts: TestContact[] = [];
    
    for (let i = 0; i < count; i++) {
      const contact: TestContact = {
        id: `contact_${i}`,
        userId: `user_${Math.floor(Math.random() * Math.min(count / 2, 10000))}`,
      };
      
      // Add phone number based on quality
      if (quality === 'high' || (quality === 'medium' && Math.random() > 0.1) || (quality === 'low' && Math.random() > 0.3)) {
        contact.phone = this.generatePhone();
      }
      
      // Add email based on quality
      if (quality === 'high' || (quality === 'medium' && Math.random() > 0.05) || (quality === 'low' && Math.random() > 0.2)) {
        contact.email = this.generateEmail();
      }
      
      // Add name based on quality
      if (quality === 'high' || (quality === 'medium' && Math.random() > 0.05) || (quality === 'low' && Math.random() > 0.1)) {
        contact.name = this.generateName();
      }
      
      contacts.push(contact);
    }
    
    return contacts;
  }

  /**
   * Create contact variation for duplicate testing
   */
  private createContactVariation(original: TestContact, quality: 'high' | 'medium' | 'low'): TestContact {
    const variation: TestContact = {
      id: `dup_${original.id}_${Math.random().toString(36).substr(2, 9)}`,
      userId: original.userId,
    };
    
    // Vary phone number
    if (original.phone) {
      variation.phone = this.varyPhone(original.phone, quality);
    }
    
    // Vary email
    if (original.email) {
      variation.email = this.varyEmail(original.email, quality);
    }
    
    // Vary name
    if (original.name) {
      variation.name = this.varyName(original.name, quality);
    }
    
    return variation;
  }

  /**
   * Generate random phone number
   */
  private generatePhone(): string {
    const areaCode = (Math.floor(Math.random() * 900) + 100).toString();
    const exchange = (Math.floor(Math.random() * 900) + 100).toString();
    const number = (Math.floor(Math.random() * 9000) + 1000).toString();
    
    const format = this.phoneFormats[Math.floor(Math.random() * this.phoneFormats.length)];
    return format
      .replace('{areaCode}', areaCode)
      .replace('{exchange}', exchange)
      .replace('{number}', number);
  }

  /**
   * Generate random email
   */
  private generateEmail(): string {
    const firstName = this.firstNames[Math.floor(Math.random() * this.firstNames.length)].toLowerCase();
    const lastName = this.lastNames[Math.floor(Math.random() * this.lastNames.length)].toLowerCase();
    const domain = this.emailDomains[Math.floor(Math.random() * this.emailDomains.length)];
    const number = Math.floor(Math.random() * 100);
    
    const formats = [
      `${firstName}.${lastName}@${domain}`,
      `${firstName}${lastName}@${domain}`,
      `${firstName}${number}@${domain}`,
      `${firstName}.${lastName}${number}@${domain}`,
    ];
    
    return formats[Math.floor(Math.random() * formats.length)];
  }

  /**
   * Generate random name
   */
  private generateName(): string {
    const firstName = this.firstNames[Math.floor(Math.random() * this.firstNames.length)];
    const lastName = this.lastNames[Math.floor(Math.random() * this.lastNames.length)];
    return `${firstName} ${lastName}`;
  }

  /**
   * Create phone number variation
   */
  private varyPhone(phone: string, quality: 'high' | 'medium' | 'low'): string {
    const variations = [
      phone, // Keep original
      phone.replace(/^\+1/, '1'), // Remove +
      phone.replace(/^\+1/, ''), // Remove country code
      phone.replace(/[^\d]/g, ''), // Numbers only
      phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3'), // Format variation
      phone.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3'), // Format variation
    ];
    
    if (quality === 'low') {
      // Add more aggressive variations for low quality
      variations.push(
        phone.replace(/\d$/, (Math.floor(Math.random() * 10)).toString()), // Change last digit
        phone.slice(0, -1), // Remove last character
      );
    }
    
    return variations[Math.floor(Math.random() * variations.length)];
  }

  /**
   * Create email variation
   */
  private varyEmail(email: string, quality: 'high' | 'medium' | 'low'): string {
    const [local, domain] = email.split('@');
    
    if (domain === 'gmail.com') {
      // Gmail-specific variations
      const variations = [
        email,
        `${local.replace(/\./g, '')}@${domain}`, // Remove dots
        `${local}+tag@${domain}`, // Add plus addressing
        `${local.slice(0, 3)}.${local.slice(3)}@${domain}`, // Add dot
      ];
      return variations[Math.floor(Math.random() * variations.length)];
    }
    
    const variations = [
      email,
      email.toLowerCase(),
      email.toUpperCase(),
    ];
    
    if (quality === 'low') {
      variations.push(
        `${local}1@${domain}`, // Add number
        `${local.slice(0, -1)}@${domain}`, // Remove character
      );
    }
    
    return variations[Math.floor(Math.random() * variations.length)];
  }

  /**
   * Create name variation
   */
  private varyName(name: string, quality: 'high' | 'medium' | 'low'): string {
    const variations = [
      name,
      name.toLowerCase(),
      name.toUpperCase(),
      name.split(' ').map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' '),
    ];
    
    if (quality === 'low') {
      const parts = name.split(' ');
      variations.push(
        parts[0], // First name only
        parts.slice(-1)[0], // Last name only
        `${parts[0][0]}. ${parts.slice(-1)[0]}`, // Initial + last name
      );
    }
    
    return variations[Math.floor(Math.random() * variations.length)];
  }

  /**
   * Shuffle array in place
   */
  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}

/**
 * Performance Benchmark Runner
 * 
 * Executes comprehensive performance tests on the contact discovery system.
 */
export class PerformanceBenchmarkRunner {
  private testDataGenerator: TestDataGenerator;
  private normalizationService: ContactNormalizationService;
  private deduplicationEngine: DeduplicationEngine;
  private matchingService: ContactMatchingService;
  private cacheService?: ContactCacheService;

  constructor() {
    this.testDataGenerator = new TestDataGenerator();
    this.normalizationService = new ContactNormalizationService();
    this.deduplicationEngine = new DeduplicationEngine();
    this.matchingService = new ContactMatchingService();
  }

  /**
   * Run comprehensive benchmark suite
   */
  async runBenchmarks(config: BenchmarkConfig): Promise<BenchmarkResults> {
    console.log('Starting comprehensive performance benchmarks...');
    console.log('Configuration:', config);
    
    const metrics: PerformanceMetrics[] = [];
    
    // Warmup runs
    if (config.warmupRuns > 0) {
      console.log(`Performing ${config.warmupRuns} warmup runs...`);
      await this.performWarmup(config.warmupRuns);
    }
    
    // Main benchmark runs
    for (const contactCount of config.contactCounts) {
      for (const duplicateRate of config.duplicateRates) {
        console.log(`\nTesting ${contactCount} contacts with ${duplicateRate * 100}% duplicate rate...`);
        
        for (let iteration = 0; iteration < config.iterations; iteration++) {
          const iterationMetrics = await this.runSingleBenchmark(
            contactCount,
            duplicateRate,
            iteration,
            config
          );
          metrics.push(...iterationMetrics);
        }
      }
    }
    
    // Load testing
    if (config.includeLoadTesting) {
      console.log('\nPerforming load testing...');
      const loadTestMetrics = await this.runLoadTests(config);
      metrics.push(...loadTestMetrics);
    }
    
    // Analyze results
    const results = this.analyzeResults(config, metrics);
    
    // Output results
    this.outputResults(results, config.outputFormat);
    
    return results;
  }

  /**
   * Run single benchmark iteration
   */
  private async runSingleBenchmark(
    contactCount: number,
    duplicateRate: number,
    iteration: number,
    config: BenchmarkConfig
  ): Promise<PerformanceMetrics[]> {
    const metrics: PerformanceMetrics[] = [];
    
    // Generate test data
    const dataset = this.testDataGenerator.generateDataset(contactCount, duplicateRate, 'medium');
    
    // Test normalization
    const normalizationMetrics = await this.benchmarkNormalization(
      dataset.contacts,
      iteration,
      duplicateRate,
      config.includeMemoryProfiling
    );
    metrics.push(normalizationMetrics);
    
    // Test deduplication
    const deduplicationMetrics = await this.benchmarkDeduplication(
      dataset.contacts,
      iteration,
      duplicateRate,
      config.includeMemoryProfiling
    );
    metrics.push(deduplicationMetrics);
    
    // Test matching
    const matchingMetrics = await this.benchmarkMatching(
      dataset.contacts,
      iteration,
      duplicateRate,
      config.includeMemoryProfiling
    );
    metrics.push(matchingMetrics);
    
    return metrics;
  }

  /**
   * Benchmark normalization performance
   */
  private async benchmarkNormalization(
    contacts: TestContact[],
    iteration: number,
    duplicateRate: number,
    includeMemoryProfiling: boolean
  ): Promise<PerformanceMetrics> {
    const startTime = Date.now();
    const memoryBefore = includeMemoryProfiling ? this.getMemoryUsage() : 0;
    let peakMemory = memoryBefore;
    let errorCount = 0;
    
    try {
      for (const contact of contacts) {
        try {
          await this.normalizationService.normalizeContact(contact);
          
          if (includeMemoryProfiling && contacts.indexOf(contact) % 100 === 0) {
            peakMemory = Math.max(peakMemory, this.getMemoryUsage());
          }
        } catch (error) {
          errorCount++;
        }
      }
    } catch (error) {
      console.error('Normalization benchmark error:', error);
      errorCount++;
    }
    
    const endTime = Date.now();
    const memoryAfter = includeMemoryProfiling ? this.getMemoryUsage() : 0;
    const duration = endTime - startTime;
    
    return {
      operation: 'normalization',
      contactCount: contacts.length,
      duplicateRate,
      iteration,
      startTime,
      endTime,
      durationMs: duration,
      memoryBeforeMB: memoryBefore,
      memoryAfterMB: memoryAfter,
      memoryDeltaMB: memoryAfter - memoryBefore,
      peakMemoryMB: peakMemory,
      throughputPerSecond: contacts.length / (duration / 1000),
      successRate: (contacts.length - errorCount) / contacts.length,
      errorCount,
    };
  }

  /**
   * Benchmark deduplication performance
   */
  private async benchmarkDeduplication(
    contacts: TestContact[],
    iteration: number,
    duplicateRate: number,
    includeMemoryProfiling: boolean
  ): Promise<PerformanceMetrics> {
    const startTime = Date.now();
    const memoryBefore = includeMemoryProfiling ? this.getMemoryUsage() : 0;
    let peakMemory = memoryBefore;
    let errorCount = 0;
    let duplicatesDetected = 0;
    
    try {
      const result = await this.deduplicationEngine.batchDeduplicateContacts(contacts, 1000);
      duplicatesDetected = result.stats.duplicatesFound;
      
      if (includeMemoryProfiling) {
        peakMemory = Math.max(peakMemory, this.getMemoryUsage());
      }
    } catch (error) {
      console.error('Deduplication benchmark error:', error);
      errorCount++;
    }
    
    const endTime = Date.now();
    const memoryAfter = includeMemoryProfiling ? this.getMemoryUsage() : 0;
    const duration = endTime - startTime;
    
    return {
      operation: 'deduplication',
      contactCount: contacts.length,
      duplicateRate,
      iteration,
      startTime,
      endTime,
      durationMs: duration,
      memoryBeforeMB: memoryBefore,
      memoryAfterMB: memoryAfter,
      memoryDeltaMB: memoryAfter - memoryBefore,
      peakMemoryMB: peakMemory,
      throughputPerSecond: contacts.length / (duration / 1000),
      successRate: errorCount === 0 ? 1 : 0,
      errorCount,
      duplicatesDetected,
    };
  }

  /**
   * Benchmark matching performance
   */
  private async benchmarkMatching(
    contacts: TestContact[],
    iteration: number,
    duplicateRate: number,
    includeMemoryProfiling: boolean
  ): Promise<PerformanceMetrics> {
    const startTime = Date.now();
    const memoryBefore = includeMemoryProfiling ? this.getMemoryUsage() : 0;
    let peakMemory = memoryBefore;
    let errorCount = 0;
    let matchesFound = 0;
    
    try {
      const query: MatchQuery = {
        contacts: contacts.map(c => ({
          ...c,
          normalizedPhone: c.phone,
          normalizedEmail: c.email,
          normalizedName: c.name,
        })),
        userId: 'test_user',
        minConfidence: 0.5,
        maxResults: 100,
      };
      
      const matches = await this.matchingService.findMatches(query);
      matchesFound = matches.length;
      
      if (includeMemoryProfiling) {
        peakMemory = Math.max(peakMemory, this.getMemoryUsage());
      }
    } catch (error) {
      console.error('Matching benchmark error:', error);
      errorCount++;
    }
    
    const endTime = Date.now();
    const memoryAfter = includeMemoryProfiling ? this.getMemoryUsage() : 0;
    const duration = endTime - startTime;
    
    return {
      operation: 'matching',
      contactCount: contacts.length,
      duplicateRate,
      iteration,
      startTime,
      endTime,
      durationMs: duration,
      memoryBeforeMB: memoryBefore,
      memoryAfterMB: memoryAfter,
      memoryDeltaMB: memoryAfter - memoryBefore,
      peakMemoryMB: peakMemory,
      throughputPerSecond: contacts.length / (duration / 1000),
      successRate: errorCount === 0 ? 1 : 0,
      errorCount,
      matchesFound,
    };
  }

  /**
   * Run load tests with concurrent operations
   */
  private async runLoadTests(config: BenchmarkConfig): Promise<PerformanceMetrics[]> {
    const metrics: PerformanceMetrics[] = [];
    const contactCount = Math.max(...config.contactCounts);
    const dataset = this.testDataGenerator.generateDataset(contactCount, 0.1, 'medium');
    
    // Test different concurrency levels
    const concurrencyLevels = [1, 2, 4, 8, 16, config.concurrency].filter((v, i, a) => a.indexOf(v) === i);
    
    for (const concurrency of concurrencyLevels) {
      console.log(`Testing concurrency level: ${concurrency}`);
      
      const batchSize = Math.ceil(dataset.contacts.length / concurrency);
      const batches = this.createBatches(dataset.contacts, batchSize);
      
      const startTime = Date.now();
      const memoryBefore = this.getMemoryUsage();
      
      const promises = batches.map(async (batch, index) => {
        const query: MatchQuery = {
          contacts: batch.map(c => ({
            ...c,
            normalizedPhone: c.phone,
            normalizedEmail: c.email,
            normalizedName: c.name,
          })),
          userId: `test_user_${index}`,
          minConfidence: 0.5,
          maxResults: 50,
        };
        
        return this.matchingService.findMatches(query);
      });
      
      try {
        const results = await Promise.all(promises);
        const endTime = Date.now();
        const memoryAfter = this.getMemoryUsage();
        const duration = endTime - startTime;
        const totalMatches = results.reduce((sum, matches) => sum + matches.length, 0);
        
        metrics.push({
          operation: `concurrent_matching_${concurrency}`,
          contactCount: dataset.contacts.length,
          duplicateRate: 0.1,
          iteration: 0,
          startTime,
          endTime,
          durationMs: duration,
          memoryBeforeMB: memoryBefore,
          memoryAfterMB: memoryAfter,
          memoryDeltaMB: memoryAfter - memoryBefore,
          peakMemoryMB: memoryAfter,
          throughputPerSecond: dataset.contacts.length / (duration / 1000),
          successRate: 1,
          errorCount: 0,
          matchesFound: totalMatches,
        });
      } catch (error) {
        console.error(`Concurrency test failed at level ${concurrency}:`, error);
      }
    }
    
    return metrics;
  }

  /**
   * Perform warmup runs
   */
  private async performWarmup(warmupRuns: number): Promise<void> {
    const smallDataset = this.testDataGenerator.generateDataset(100, 0.1, 'medium');
    
    for (let i = 0; i < warmupRuns; i++) {
      try {
        // Warmup normalization
        for (const contact of smallDataset.contacts.slice(0, 10)) {
          await this.normalizationService.normalizeContact(contact);
        }
        
        // Warmup deduplication
        await this.deduplicationEngine.batchDeduplicateContacts(smallDataset.contacts.slice(0, 10), 10);
        
        // Warmup matching
        const query: MatchQuery = {
          contacts: smallDataset.contacts.slice(0, 5).map(c => ({
            ...c,
            normalizedPhone: c.phone,
            normalizedEmail: c.email,
            normalizedName: c.name,
          })),
          userId: 'warmup_user',
          minConfidence: 0.5,
          maxResults: 10,
        };
        await this.matchingService.findMatches(query);
      } catch (error) {
        // Ignore warmup errors
      }
    }
  }

  /**
   * Analyze benchmark results
   */
  private analyzeResults(config: BenchmarkConfig, metrics: PerformanceMetrics[]): BenchmarkResults {
    const operationGroups = this.groupMetricsByOperation(metrics);
    
    // Calculate summary statistics
    const totalDuration = metrics.reduce((sum, m) => sum + m.durationMs, 0);
    const averageLatency = totalDuration / metrics.length;
    const peakThroughput = Math.max(...metrics.map(m => m.throughputPerSecond));
    const averageMemoryUsage = metrics.reduce((sum, m) => sum + m.memoryAfterMB, 0) / metrics.length;
    const peakMemoryUsage = Math.max(...metrics.map(m => m.peakMemoryMB));
    const averageSuccessRate = metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length;
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(metrics);
    
    // Analyze scalability
    const scalabilityAnalysis = this.analyzeScalability(metrics);
    
    return {
      config,
      metrics,
      summary: {
        totalOperations: metrics.length,
        totalDuration,
        averageLatency,
        peakThroughput,
        averageMemoryUsage,
        peakMemoryUsage,
        averageSuccessRate,
        recommendations,
      },
      operationBreakdown: {
        normalization: this.calculateOperationStats(operationGroups.normalization || []),
        deduplication: this.calculateOperationStats(operationGroups.deduplication || []),
        matching: this.calculateOperationStats(operationGroups.matching || []),
        caching: this.calculateOperationStats(operationGroups.caching || []),
      },
      scalabilityAnalysis,
    };
  }

  /**
   * Group metrics by operation type
   */
  private groupMetricsByOperation(metrics: PerformanceMetrics[]): Record<string, PerformanceMetrics[]> {
    return metrics.reduce((groups, metric) => {
      const operation = metric.operation.split('_')[0]; // Get base operation name
      if (!groups[operation]) {
        groups[operation] = [];
      }
      groups[operation].push(metric);
      return groups;
    }, {} as Record<string, PerformanceMetrics[]>);
  }

  /**
   * Calculate operation statistics
   */
  private calculateOperationStats(metrics: PerformanceMetrics[]): OperationStats {
    if (metrics.length === 0) {
      return {
        averageLatency: 0,
        throughput: 0,
        memoryEfficiency: 0,
        errorRate: 0,
        recommendations: [],
      };
    }
    
    const averageLatency = metrics.reduce((sum, m) => sum + m.durationMs, 0) / metrics.length;
    const throughput = metrics.reduce((sum, m) => sum + m.throughputPerSecond, 0) / metrics.length;
    const totalContacts = metrics.reduce((sum, m) => sum + m.contactCount, 0);
    const totalMemory = metrics.reduce((sum, m) => sum + m.memoryDeltaMB, 0);
    const memoryEfficiency = totalMemory > 0 ? totalContacts / totalMemory : 0;
    const errorRate = metrics.reduce((sum, m) => sum + (1 - m.successRate), 0) / metrics.length;
    
    const recommendations = this.generateOperationRecommendations(metrics);
    
    return {
      averageLatency,
      throughput,
      memoryEfficiency,
      errorRate,
      recommendations,
    };
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(metrics: PerformanceMetrics[]): string[] {
    const recommendations: string[] = [];
    
    const avgLatency = metrics.reduce((sum, m) => sum + m.durationMs, 0) / metrics.length;
    const avgThroughput = metrics.reduce((sum, m) => sum + m.throughputPerSecond, 0) / metrics.length;
    const avgMemoryDelta = metrics.reduce((sum, m) => sum + m.memoryDeltaMB, 0) / metrics.length;
    const errorRate = metrics.reduce((sum, m) => sum + (1 - m.successRate), 0) / metrics.length;
    
    if (avgLatency > 1000) {
      recommendations.push('High average latency detected. Consider optimizing database queries and implementing connection pooling.');
    }
    
    if (avgThroughput < 100) {
      recommendations.push('Low throughput detected. Consider implementing parallel processing and batch operations.');
    }
    
    if (avgMemoryDelta > 100) {
      recommendations.push('High memory usage detected. Consider implementing memory pooling and object reuse patterns.');
    }
    
    if (errorRate > 0.01) {
      recommendations.push('Error rate above 1%. Review error handling and input validation.');
    }
    
    // Analysis-specific recommendations
    const matchingMetrics = metrics.filter(m => m.operation.includes('matching'));
    if (matchingMetrics.length > 0) {
      const avgMatchingLatency = matchingMetrics.reduce((sum, m) => sum + m.durationMs, 0) / matchingMetrics.length;
      if (avgMatchingLatency > 500) {
        recommendations.push('Matching operations are slow. Consider implementing result caching and database indexing.');
      }
    }
    
    return recommendations;
  }

  /**
   * Generate operation-specific recommendations
   */
  private generateOperationRecommendations(metrics: PerformanceMetrics[]): string[] {
    const recommendations: string[] = [];
    const operation = metrics[0]?.operation.split('_')[0];
    
    const avgLatency = metrics.reduce((sum, m) => sum + m.durationMs, 0) / metrics.length;
    
    switch (operation) {
      case 'normalization':
        if (avgLatency > 100) {
          recommendations.push('Normalize contacts in batches to improve performance');
          recommendations.push('Consider caching normalization results for repeated patterns');
        }
        break;
      case 'deduplication':
        if (avgLatency > 500) {
          recommendations.push('Increase Bloom filter size to reduce false positives');
          recommendations.push('Implement multi-threaded deduplication for large datasets');
        }
        break;
      case 'matching':
        if (avgLatency > 300) {
          recommendations.push('Implement result caching with appropriate TTL');
          recommendations.push('Add database indexes on signature hash columns');
        }
        break;
    }
    
    return recommendations;
  }

  /**
   * Analyze scalability characteristics
   */
  private analyzeScalability(metrics: PerformanceMetrics[]): {
    linearityScore: number;
    bottlenecks: string[];
    optimalBatchSize: number;
    recommendedConcurrency: number;
  } {
    // Group by contact count for scalability analysis
    const countGroups = metrics.reduce((groups, metric) => {
      if (!groups[metric.contactCount]) {
        groups[metric.contactCount] = [];
      }
      groups[metric.contactCount].push(metric);
      return groups;
    }, {} as Record<number, PerformanceMetrics[]>);
    
    // Calculate linearity score (how well does performance scale linearly)
    const contactCounts = Object.keys(countGroups).map(Number).sort((a, b) => a - b);
    let linearityScore = 1.0;
    
    if (contactCounts.length > 1) {
      const latencyRatios: number[] = [];
      for (let i = 1; i < contactCounts.length; i++) {
        const prevCount = contactCounts[i - 1];
        const currCount = contactCounts[i];
        const prevLatency = countGroups[prevCount].reduce((sum, m) => sum + m.durationMs, 0) / countGroups[prevCount].length;
        const currLatency = countGroups[currCount].reduce((sum, m) => sum + m.durationMs, 0) / countGroups[currCount].length;
        
        const expectedRatio = currCount / prevCount;
        const actualRatio = currLatency / prevLatency;
        latencyRatios.push(Math.abs(actualRatio - expectedRatio) / expectedRatio);
      }
      linearityScore = Math.max(0, 1 - (latencyRatios.reduce((sum, ratio) => sum + ratio, 0) / latencyRatios.length));
    }
    
    // Identify bottlenecks
    const bottlenecks: string[] = [];
    const operationGroups = this.groupMetricsByOperation(metrics);
    
    const avgLatencies = Object.entries(operationGroups).map(([operation, opMetrics]) => ({
      operation,
      avgLatency: opMetrics.reduce((sum, m) => sum + m.durationMs, 0) / opMetrics.length,
    }));
    
    avgLatencies.sort((a, b) => b.avgLatency - a.avgLatency);
    if (avgLatencies.length > 0 && avgLatencies[0].avgLatency > 200) {
      bottlenecks.push(`${avgLatencies[0].operation} operations are the primary bottleneck`);
    }
    
    // Analyze memory usage growth
    const memoryGrowth = contactCounts.map(count => {
      const groupMetrics = countGroups[count];
      return groupMetrics.reduce((sum, m) => sum + m.memoryDeltaMB, 0) / groupMetrics.length;
    });
    
    if (memoryGrowth.length > 1) {
      const growthRate = (memoryGrowth[memoryGrowth.length - 1] - memoryGrowth[0]) / (contactCounts[contactCounts.length - 1] - contactCounts[0]);
      if (growthRate > 0.1) {
        bottlenecks.push('Memory usage grows too quickly with dataset size');
      }
    }
    
    // Find optimal batch size (size that gives best throughput)
    const concurrentMetrics = metrics.filter(m => m.operation.includes('concurrent'));
    let optimalBatchSize = 1000; // Default
    let recommendedConcurrency = 4; // Default
    
    if (concurrentMetrics.length > 0) {
      const bestConcurrent = concurrentMetrics.reduce((best, current) => 
        current.throughputPerSecond > best.throughputPerSecond ? current : best
      );
      
      const concurrencyMatch = bestConcurrent.operation.match(/concurrent_matching_(\d+)/);
      if (concurrencyMatch) {
        recommendedConcurrency = parseInt(concurrencyMatch[1]);
      }
    }
    
    return {
      linearityScore,
      bottlenecks,
      optimalBatchSize,
      recommendedConcurrency,
    };
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
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed / 1024 / 1024;
    }
    return 0;
  }

  /**
   * Output benchmark results
   */
  private outputResults(results: BenchmarkResults, format: 'console' | 'json' | 'csv'): void {
    switch (format) {
      case 'console':
        this.outputConsoleResults(results);
        break;
      case 'json':
        console.log(JSON.stringify(results, null, 2));
        break;
      case 'csv':
        this.outputCsvResults(results);
        break;
    }
  }

  /**
   * Output results to console
   */
  private outputConsoleResults(results: BenchmarkResults): void {
    console.log('\n' + '='.repeat(80));
    console.log('PERFORMANCE BENCHMARK RESULTS');
    console.log('='.repeat(80));
    
    console.log('\nSUMMARY:');
    console.log(`Total Operations: ${results.summary.totalOperations}`);
    console.log(`Average Latency: ${results.summary.averageLatency.toFixed(2)}ms`);
    console.log(`Peak Throughput: ${results.summary.peakThroughput.toFixed(2)} contacts/sec`);
    console.log(`Average Memory Usage: ${results.summary.averageMemoryUsage.toFixed(2)}MB`);
    console.log(`Peak Memory Usage: ${results.summary.peakMemoryUsage.toFixed(2)}MB`);
    console.log(`Success Rate: ${(results.summary.averageSuccessRate * 100).toFixed(2)}%`);
    
    console.log('\nOPERATION BREAKDOWN:');
    Object.entries(results.operationBreakdown).forEach(([operation, stats]) => {
      if (stats.throughput > 0) {
        console.log(`${operation.toUpperCase()}:`);
        console.log(`  Average Latency: ${stats.averageLatency.toFixed(2)}ms`);
        console.log(`  Throughput: ${stats.throughput.toFixed(2)} contacts/sec`);
        console.log(`  Memory Efficiency: ${stats.memoryEfficiency.toFixed(2)} contacts/MB`);
        console.log(`  Error Rate: ${(stats.errorRate * 100).toFixed(2)}%`);
      }
    });
    
    console.log('\nSCALABILITY ANALYSIS:');
    console.log(`Linearity Score: ${(results.scalabilityAnalysis.linearityScore * 100).toFixed(1)}%`);
    console.log(`Optimal Batch Size: ${results.scalabilityAnalysis.optimalBatchSize}`);
    console.log(`Recommended Concurrency: ${results.scalabilityAnalysis.recommendedConcurrency}`);
    
    if (results.scalabilityAnalysis.bottlenecks.length > 0) {
      console.log('\nBOTTLENECKS:');
      results.scalabilityAnalysis.bottlenecks.forEach(bottleneck => {
        console.log(`  • ${bottleneck}`);
      });
    }
    
    if (results.summary.recommendations.length > 0) {
      console.log('\nRECOMMENDATIONS:');
      results.summary.recommendations.forEach(recommendation => {
        console.log(`  • ${recommendation}`);
      });
    }
    
    console.log('\n' + '='.repeat(80));
  }

  /**
   * Output results to CSV format
   */
  private outputCsvResults(results: BenchmarkResults): void {
    const headers = [
      'operation', 'contactCount', 'duplicateRate', 'iteration',
      'durationMs', 'throughputPerSecond', 'memoryDeltaMB', 'successRate',
      'errorCount', 'duplicatesDetected', 'matchesFound'
    ];
    
    console.log(headers.join(','));
    
    results.metrics.forEach(metric => {
      const row = [
        metric.operation,
        metric.contactCount,
        metric.duplicateRate,
        metric.iteration,
        metric.durationMs,
        metric.throughputPerSecond.toFixed(2),
        metric.memoryDeltaMB.toFixed(2),
        metric.successRate.toFixed(3),
        metric.errorCount,
        metric.duplicatesDetected || 0,
        metric.matchesFound || 0,
      ];
      console.log(row.join(','));
    });
  }
}

/**
 * Default benchmark configurations
 */
export const DefaultBenchmarkConfigs = {
  quick: {
    contactCounts: [100, 500, 1000],
    duplicateRates: [0.1, 0.2],
    iterations: 3,
    concurrency: 4,
    warmupRuns: 2,
    includeMemoryProfiling: true,
    includeLoadTesting: false,
    outputFormat: 'console' as const,
  },
  
  comprehensive: {
    contactCounts: [1000, 5000, 10000, 25000],
    duplicateRates: [0.05, 0.1, 0.15, 0.2],
    iterations: 5,
    concurrency: 8,
    warmupRuns: 5,
    includeMemoryProfiling: true,
    includeLoadTesting: true,
    outputFormat: 'console' as const,
  },
  
  loadTest: {
    contactCounts: [50000, 100000],
    duplicateRates: [0.1],
    iterations: 3,
    concurrency: 16,
    warmupRuns: 3,
    includeMemoryProfiling: true,
    includeLoadTesting: true,
    outputFormat: 'json' as const,
  },
};