import * as crypto from 'crypto';

/**
 * Contact Normalization and Validation Utilities
 * 
 * Provides comprehensive normalization for phone numbers and email addresses
 * to ensure consistent hashing and improved match quality while maintaining privacy.
 * 
 * Features:
 * - E.164 phone number normalization with country code detection
 * - Email normalization with Gmail-specific optimizations
 * - Name field fuzzy matching and normalization
 * - Comprehensive validation and error handling
 * - Extensive test coverage for edge cases
 */

// Phone number normalization types
interface PhoneNormalizationResult {
  normalized: string;
  original: string;
  countryCode: string;
  isValid: boolean;
  errorMessage?: string;
}

// Email normalization types
interface EmailNormalizationResult {
  normalized: string;
  original: string;
  domain: string;
  localPart: string;
  isValid: boolean;
  errorMessage?: string;
}

// Name normalization types
interface NameNormalizationResult {
  normalized: string;
  original: string;
  parts: string[];
  similarity?: number;
  isValid: boolean;
  errorMessage?: string;
}

// Validation error types
class ValidationError extends Error {
  constructor(message: string, public readonly field: string, public readonly value: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Phone Number Normalization Service
 * 
 * Handles international phone number normalization to E.164 format
 * with comprehensive country code detection and validation.
 */
export class PhoneNormalizationService {
  // Country code mapping for common formats
  private readonly COUNTRY_CODES = {
    // North America
    'US': '1', 'CA': '1',
    // Europe
    'GB': '44', 'DE': '49', 'FR': '33', 'IT': '39', 'ES': '34',
    'NL': '31', 'BE': '32', 'AT': '43', 'CH': '41', 'SE': '46',
    // Asia
    'IN': '91', 'CN': '86', 'JP': '81', 'KR': '82', 'SG': '65',
    'HK': '852', 'TW': '886', 'TH': '66', 'MY': '60',
    // Oceania
    'AU': '61', 'NZ': '64',
    // Others
    'BR': '55', 'MX': '52', 'AR': '54', 'RU': '7',
  };

  // Common country code patterns
  private readonly COUNTRY_CODE_PATTERNS = [
    { code: '1', pattern: /^1[2-9]\d{9}$/, countries: ['US', 'CA'] },
    { code: '44', pattern: /^44[1-9]\d{8,9}$/, countries: ['GB'] },
    { code: '49', pattern: /^49[1-9]\d{10,11}$/, countries: ['DE'] },
    { code: '33', pattern: /^33[1-9]\d{8}$/, countries: ['FR'] },
    { code: '91', pattern: /^91[6-9]\d{9}$/, countries: ['IN'] },
    { code: '86', pattern: /^86[1]\d{10}$/, countries: ['CN'] },
    { code: '81', pattern: /^81[789]\d{8}$/, countries: ['JP'] },
    { code: '61', pattern: /^61[2-9]\d{8}$/, countries: ['AU'] },
  ];

  /**
   * Normalize phone number to E.164 format
   */
  normalizePhoneNumber(
    phoneNumber: string,
    defaultCountryCode: string = 'US'
  ): PhoneNormalizationResult {
    const original = phoneNumber;
    
    try {
      // Basic validation
      if (!phoneNumber || typeof phoneNumber !== 'string') {
        throw new ValidationError('Phone number is required', 'phone', phoneNumber);
      }
      
      // Remove all non-digit characters except + at the start
      let cleaned = phoneNumber.trim();
      const hasPlus = cleaned.startsWith('+');
      cleaned = cleaned.replace(/\D/g, '');
      
      if (cleaned.length === 0) {
        throw new ValidationError('Phone number contains no digits', 'phone', original);
      }
      
      // Handle different input formats
      let normalized: string;
      let detectedCountryCode: string;
      
      if (hasPlus || cleaned.length > 10) {
        // International format or long number
        const result = this.normalizeInternationalNumber(cleaned);
        normalized = result.normalized;
        detectedCountryCode = result.countryCode;
      } else {
        // Domestic format - apply default country code
        const result = this.normalizeDomesticNumber(cleaned, defaultCountryCode);
        normalized = result.normalized;
        detectedCountryCode = result.countryCode;
      }
      
      // Final validation
      if (!this.isValidE164Number(normalized)) {
        throw new ValidationError('Invalid phone number format', 'phone', original);
      }
      
      return {
        normalized,
        original,
        countryCode: detectedCountryCode,
        isValid: true,
      };
      
    } catch (error) {
      return {
        normalized: '',
        original,
        countryCode: '',
        isValid: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Normalize international phone number
   */
  private normalizeInternationalNumber(digits: string): { normalized: string; countryCode: string } {
    // Try to detect country code
    for (const pattern of this.COUNTRY_CODE_PATTERNS) {
      const testNumber = `+${digits}`;
      if (pattern.pattern.test(digits)) {
        return {
          normalized: testNumber,
          countryCode: pattern.countries[0],
        };
      }
    }
    
    // Fallback: assume first 1-3 digits are country code
    for (let i = 1; i <= 3 && i < digits.length; i++) {
      const potentialCC = digits.substring(0, i);
      const remaining = digits.substring(i);
      
      if (remaining.length >= 7 && remaining.length <= 15) {
        return {
          normalized: `+${digits}`,
          countryCode: this.getCountryByCode(potentialCC) || 'UNKNOWN',
        };
      }
    }
    
    throw new ValidationError('Unable to parse international number', 'phone', digits);
  }

  /**
   * Normalize domestic phone number
   */
  private normalizeDomesticNumber(
    digits: string,
    countryCode: string
  ): { normalized: string; countryCode: string } {
    const cc = this.COUNTRY_CODES[countryCode] || '1';
    
    // Handle US/CA 10-digit numbers
    if (cc === '1' && digits.length === 10) {
      return {
        normalized: `+1${digits}`,
        countryCode,
      };
    }
    
    // Handle US/CA 11-digit numbers (with leading 1)
    if (cc === '1' && digits.length === 11 && digits.startsWith('1')) {
      return {
        normalized: `+${digits}`,
        countryCode,
      };
    }
    
    // For other countries, prepend country code
    if (digits.length >= 7 && digits.length <= 12) {
      return {
        normalized: `+${cc}${digits}`,
        countryCode,
      };
    }
    
    throw new ValidationError('Invalid domestic number length', 'phone', digits);
  }

  /**
   * Validate E.164 format
   */
  private isValidE164Number(number: string): boolean {
    // E.164: + followed by 1-15 digits
    const e164Pattern = /^\+[1-9]\d{1,14}$/;
    return e164Pattern.test(number);
  }

  /**
   * Get country by country code
   */
  private getCountryByCode(code: string): string | undefined {
    return Object.keys(this.COUNTRY_CODES).find(
      country => this.COUNTRY_CODES[country] === code
    );
  }

  /**
   * Batch normalize phone numbers
   */
  batchNormalizePhoneNumbers(
    phoneNumbers: string[],
    defaultCountryCode: string = 'US'
  ): PhoneNormalizationResult[] {
    return phoneNumbers.map(phone => 
      this.normalizePhoneNumber(phone, defaultCountryCode)
    );
  }
}

/**
 * Email Normalization Service
 * 
 * Handles email address normalization with special handling for Gmail
 * and other providers that support aliasing and dot notation.
 */
export class EmailNormalizationService {
  // Gmail-specific normalization rules
  private readonly GMAIL_DOMAINS = [
    'gmail.com', 'googlemail.com'
  ];

  // Providers that ignore dots in local part
  private readonly DOT_IGNORE_PROVIDERS = [
    'gmail.com', 'googlemail.com'
  ];

  // Providers that support plus addressing
  private readonly PLUS_ADDRESSING_PROVIDERS = [
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
    'yahoo.com', 'icloud.com', 'me.com', 'mac.com'
  ];

  /**
   * Normalize email address
   */
  normalizeEmailAddress(emailAddress: string): EmailNormalizationResult {
    const original = emailAddress;
    
    try {
      // Basic validation
      if (!emailAddress || typeof emailAddress !== 'string') {
        throw new ValidationError('Email address is required', 'email', emailAddress);
      }
      
      let cleaned = emailAddress.trim().toLowerCase();
      
      // Basic email format validation
      if (!this.isValidEmailFormat(cleaned)) {
        throw new ValidationError('Invalid email format', 'email', original);
      }
      
      const [localPart, domain] = cleaned.split('@');
      
      // Validate domain
      if (!this.isValidDomain(domain)) {
        throw new ValidationError('Invalid email domain', 'email', original);
      }
      
      // Apply provider-specific normalization
      const normalizedLocal = this.normalizeLocalPart(localPart, domain);
      const normalized = `${normalizedLocal}@${domain}`;
      
      return {
        normalized,
        original,
        domain,
        localPart: normalizedLocal,
        isValid: true,
      };
      
    } catch (error) {
      return {
        normalized: '',
        original,
        domain: '',
        localPart: '',
        isValid: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Normalize local part based on provider rules
   */
  private normalizeLocalPart(localPart: string, domain: string): string {
    let normalized = localPart;
    
    // Remove dots for providers that ignore them
    if (this.DOT_IGNORE_PROVIDERS.includes(domain)) {
      normalized = normalized.replace(/\./g, '');
    }
    
    // Remove plus addressing for providers that support it
    if (this.PLUS_ADDRESSING_PROVIDERS.includes(domain)) {
      const plusIndex = normalized.indexOf('+');
      if (plusIndex !== -1) {
        normalized = normalized.substring(0, plusIndex);
      }
    }
    
    return normalized;
  }

  /**
   * Validate email format using RFC 5322 compliant regex
   */
  private isValidEmailFormat(email: string): boolean {
    // Simplified but robust email validation
    const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return emailPattern.test(email) && email.length <= 254;
  }

  /**
   * Validate domain name
   */
  private isValidDomain(domain: string): boolean {
    if (!domain || domain.length > 253) return false;
    
    const domainPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return domainPattern.test(domain);
  }

  /**
   * Batch normalize email addresses
   */
  batchNormalizeEmailAddresses(emailAddresses: string[]): EmailNormalizationResult[] {
    return emailAddresses.map(email => this.normalizeEmailAddress(email));
  }

  /**
   * Generate email variations for matching
   */
  generateEmailVariations(email: string): string[] {
    const result = this.normalizeEmailAddress(email);
    if (!result.isValid) return [];
    
    const variations = [result.normalized];
    const [localPart, domain] = email.toLowerCase().split('@');
    
    // Add original if different from normalized
    if (email.toLowerCase() !== result.normalized) {
      variations.push(email.toLowerCase());
    }
    
    // Add variations for Gmail
    if (this.GMAIL_DOMAINS.includes(domain)) {
      // Add version with dots
      const withDots = this.addGmailDots(localPart);
      if (withDots !== localPart) {
        variations.push(`${withDots}@${domain}`);
      }
      
      // Add googlemail.com variant if gmail.com
      if (domain === 'gmail.com') {
        variations.push(`${result.localPart}@googlemail.com`);
      }
    }
    
    return [...new Set(variations)]; // Remove duplicates
  }

  /**
   * Add dots to Gmail local part for variation generation
   */
  private addGmailDots(localPart: string): string {
    // Add a dot in the middle if length > 3
    if (localPart.length > 3) {
      const middle = Math.floor(localPart.length / 2);
      return localPart.substring(0, middle) + '.' + localPart.substring(middle);
    }
    return localPart;
  }
}

/**
 * Name Normalization and Fuzzy Matching Service
 * 
 * Handles name field normalization and similarity matching
 * for improved contact matching without exact name requirements.
 */
export class NameNormalizationService {
  // Common name variations
  private readonly NAME_VARIATIONS = {
    'john': ['jon', 'johnny', 'jack'],
    'william': ['bill', 'billy', 'will', 'willy'],
    'robert': ['rob', 'bob', 'bobby'],
    'richard': ['rick', 'dick', 'rich'],
    'michael': ['mike', 'micky', 'mick'],
    'elizabeth': ['liz', 'beth', 'betty', 'eliza'],
    'jennifer': ['jen', 'jenny', 'jenn'],
    'christopher': ['chris', 'christopher'],
    'matthew': ['matt', 'matty'],
    'anthony': ['tony', 'ant'],
    'patricia': ['pat', 'patty', 'trish'],
    'linda': ['lin', 'lindy'],
    'barbara': ['barb', 'babs'],
    'susan': ['sue', 'suzy', 'susie'],
    'jessica': ['jess', 'jessie'],
    'sarah': ['sara'],
    'karen': ['kay'],
    'nancy': ['nan'],
    'lisa': ['lise'],
    'betty': ['bet'],
    'helen': ['elle'],
    'sandra': ['sandy'],
    'donna': ['don'],
    'carol': ['carrie'],
    'ruth': ['ruthie'],
    'sharon': ['shari'],
    'michelle': ['shell', 'mickey'],
    'laura': ['laurie'],
    'emily': ['em', 'emmy'],
    'kimberly': ['kim', 'kimmy'],
    'deborah': ['deb', 'debbie'],
    'dorothy': ['dot', 'dottie'],
    'amy': ['aims'],
    'angela': ['angie'],
    'ashley': ['ash'],
    'brenda': ['bren'],
    'emma': ['em'],
    'olivia': ['liv', 'livvy'],
    'cynthia': ['cindy', 'cyn'],
    'marie': ['mary'],
    'janet': ['jan'],
    'catherine': ['cathy', 'cat', 'kate', 'katie'],
    'frances': ['fran', 'frankie'],
    'ann': ['annie'],
    'joyce': ['joy'],
    'diane': ['di'],
    'alice': ['al'],
    'julie': ['jules'],
    'heather': ['heath'],
    'teresa': ['terry', 'tess'],
    'gloria': ['glory'],
    'jacqueline': ['jackie', 'jack'],
    'tina': ['teeny'],
    'anita': ['nita'],
    'louise': ['lou'],
    'marie': ['mary'],
    'lillian': ['lilly', 'lil'],
    'norma': ['norm'],
    'lois': ['lo'],
    'wayne': ['way'],
    'roy': ['ray'],
    'eugene': ['gene'],
    'louis': ['lou', 'louie'],
    'philip': ['phil'],
    'bobby': ['bob'],
  };

  /**
   * Normalize name field
   */
  normalizeName(name: string): NameNormalizationResult {
    const original = name;
    
    try {
      if (!name || typeof name !== 'string') {
        throw new ValidationError('Name is required', 'name', name);
      }
      
      // Clean and normalize
      let cleaned = name.trim().toLowerCase();
      
      // Remove extra whitespace and special characters
      cleaned = cleaned.replace(/[^\w\s'-]/g, '');
      cleaned = cleaned.replace(/\s+/g, ' ');
      
      // Split into parts
      const parts = cleaned.split(' ').filter(part => part.length > 0);
      
      if (parts.length === 0) {
        throw new ValidationError('Name contains no valid characters', 'name', original);
      }
      
      // Normalize each part
      const normalizedParts = parts.map(part => this.normalizeSingleName(part));
      const normalized = normalizedParts.join(' ');
      
      return {
        normalized,
        original,
        parts: normalizedParts,
        isValid: true,
      };
      
    } catch (error) {
      return {
        normalized: '',
        original,
        parts: [],
        isValid: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Calculate name similarity score
   */
  calculateNameSimilarity(name1: string, name2: string): number {
    const norm1 = this.normalizeName(name1);
    const norm2 = this.normalizeName(name2);
    
    if (!norm1.isValid || !norm2.isValid) {
      return 0;
    }
    
    // Exact match
    if (norm1.normalized === norm2.normalized) {
      return 1.0;
    }
    
    // Check for name variations
    const variationScore = this.checkNameVariations(norm1.parts, norm2.parts);
    if (variationScore > 0) {
      return variationScore;
    }
    
    // Levenshtein distance similarity
    const levenshteinScore = this.calculateLevenshteinSimilarity(
      norm1.normalized,
      norm2.normalized
    );
    
    // Jaccard similarity for parts
    const jaccardScore = this.calculateJaccardSimilarity(norm1.parts, norm2.parts);
    
    // Weighted combination
    return Math.max(levenshteinScore * 0.6 + jaccardScore * 0.4, variationScore);
  }

  /**
   * Normalize a single name part
   */
  private normalizeSingleName(name: string): string {
    // Remove common prefixes/suffixes
    const cleaned = name
      .replace(/^(mr|mrs|ms|dr|prof)\.?/i, '')
      .replace(/(jr|sr|ii|iii|iv)\.?$/i, '');
    
    return cleaned.trim();
  }

  /**
   * Check for known name variations
   */
  private checkNameVariations(parts1: string[], parts2: string[]): number {
    let matches = 0;
    let totalComparisons = 0;
    
    for (const part1 of parts1) {
      for (const part2 of parts2) {
        totalComparisons++;
        
        if (part1 === part2) {
          matches++;
          continue;
        }
        
        // Check if they're variations of each other
        const variations1 = this.getNameVariations(part1);
        const variations2 = this.getNameVariations(part2);
        
        if (variations1.includes(part2) || variations2.includes(part1)) {
          matches += 0.8; // Slight penalty for variations
        }
      }
    }
    
    return totalComparisons > 0 ? matches / totalComparisons : 0;
  }

  /**
   * Get known variations for a name
   */
  private getNameVariations(name: string): string[] {
    const variations = this.NAME_VARIATIONS[name.toLowerCase()] || [];
    
    // Also check reverse mappings
    for (const [canonical, vars] of Object.entries(this.NAME_VARIATIONS)) {
      if (vars.includes(name.toLowerCase())) {
        variations.push(canonical, ...vars);
      }
    }
    
    return [...new Set(variations)];
  }

  /**
   * Calculate Levenshtein distance similarity
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
        const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + substitutionCost // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate Jaccard similarity for name parts
   */
  private calculateJaccardSimilarity(parts1: string[], parts2: string[]): number {
    const set1 = new Set(parts1);
    const set2 = new Set(parts2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Batch normalize names
   */
  batchNormalizeNames(names: string[]): NameNormalizationResult[] {
    return names.map(name => this.normalizeName(name));
  }
}

/**
 * Comprehensive Contact Normalization Service
 * 
 * Combines all normalization services for complete contact processing.
 */
export class ContactNormalizationService {
  constructor(
    private readonly phoneService = new PhoneNormalizationService(),
    private readonly emailService = new EmailNormalizationService(),
    private readonly nameService = new NameNormalizationService(),
  ) {}

  /**
   * Normalize a complete contact record
   */
  normalizeContact(contact: {
    phone?: string;
    email?: string;
    name?: string;
    defaultCountryCode?: string;
  }): {
    phone?: PhoneNormalizationResult;
    email?: EmailNormalizationResult;
    name?: NameNormalizationResult;
    isValid: boolean;
    hasValidIdentifier: boolean;
  } {
    const results: any = {};
    let hasValidIdentifier = false;
    
    if (contact.phone) {
      results.phone = this.phoneService.normalizePhoneNumber(
        contact.phone,
        contact.defaultCountryCode
      );
      if (results.phone.isValid) hasValidIdentifier = true;
    }
    
    if (contact.email) {
      results.email = this.emailService.normalizeEmailAddress(contact.email);
      if (results.email.isValid) hasValidIdentifier = true;
    }
    
    if (contact.name) {
      results.name = this.nameService.normalizeName(contact.name);
    }
    
    return {
      ...results,
      isValid: hasValidIdentifier,
      hasValidIdentifier,
    };
  }

  /**
   * Batch normalize contacts
   */
  batchNormalizeContacts(contacts: Array<{
    phone?: string;
    email?: string;
    name?: string;
    defaultCountryCode?: string;
  }>): Array<ReturnType<typeof this.normalizeContact>> {
    return contacts.map(contact => this.normalizeContact(contact));
  }

  /**
   * Generate contact hash signature for deduplication
   */
  generateContactSignature(contact: {
    phone?: string;
    email?: string;
    name?: string;
    defaultCountryCode?: string;
  }): string {
    const normalized = this.normalizeContact(contact);
    
    const parts = [];
    if (normalized.phone?.isValid) parts.push(`phone:${normalized.phone.normalized}`);
    if (normalized.email?.isValid) parts.push(`email:${normalized.email.normalized}`);
    if (normalized.name?.isValid) parts.push(`name:${normalized.name.normalized}`);
    
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  }
}