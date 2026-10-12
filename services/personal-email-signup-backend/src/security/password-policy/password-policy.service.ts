import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import zxcvbn, { ZXCVBNResult, ZXCVBNFeedback, ZXCVBNSequence } from 'zxcvbn';
import { PasswordBreachService } from '../password-breach.service';

export interface PasswordPolicyViolation {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface PasswordPolicyResult {
  compliant: boolean;
  score: number;
  crackTimesDisplay: ZXCVBNResult['crack_times_display'];
  warnings: string[];
  violations: PasswordPolicyViolation[];
  breached: boolean;
  hash?: string;
}

export interface PasswordPolicyOptions {
  /**
   * Additional inputs provided to zxcvbn to reduce score where appropriate
   * (e.g. email, username, pet names).
   */
  userInputs?: string[];
  /**
   * Skip the HaveIBeenPwned network call. Useful for tests or degraded modes.
   */
  skipHIBP?: boolean;
  /**
   * Skip bcrypt hashing and return compliance only.
   */
  skipHashing?: boolean;
}

const MIN_LENGTH = 8;
const MAX_LENGTH = 64;
const BCRYPT_COST = 12;

// Dictionary names shipped with zxcvbn that map to the SecLists/HIBP top lists
// and common language dictionaries. These names are stable across versions.
const COMMON_PASSWORD_DICTIONARIES = new Set<string>([
  'passwords',
  'passwords_common',
]);

const LANGUAGE_DICTIONARIES = new Set<string>([
  'english',
  'english_wikipedia',
  'surnames',
  'male_names',
  'female_names',
  'spanish',
  'french',
  'german',
  'italian',
]);

@Injectable()
export class PasswordPolicyService {
  private readonly logger = new Logger(PasswordPolicyService.name);

  constructor(private readonly breachService: PasswordBreachService) {}

  async evaluate(password: string, options: PasswordPolicyOptions = {}): Promise<PasswordPolicyResult> {
    const violations: PasswordPolicyViolation[] = [];
    const warnings: string[] = [];

    if (typeof password !== 'string') {
      violations.push({
        code: 'invalid_type',
        message: 'Password must be provided as a string value.',
      });
      return this.buildResult({
        compliant: false,
        warnings,
        violations,
        score: 0,
        crackTimes: this.emptyCrackTimes(),
        breached: false,
      });
    }

    const normalized = password.normalize('NFKC');
    const graphemeLength = [...normalized].length;

    if (graphemeLength < MIN_LENGTH) {
      violations.push({
        code: 'too_short',
        message: `Password must be at least ${MIN_LENGTH} characters long.`,
        context: { length: graphemeLength },
      });
    }

    if (graphemeLength > MAX_LENGTH) {
      violations.push({
        code: 'too_long',
        message: `Password must be ${MAX_LENGTH} characters or fewer to ensure reliable hashing performance.`,
        context: { length: graphemeLength },
      });
    }

    const zxcvbnResult = this.calculateStrength(normalized, options.userInputs ?? []);
    warnings.push(...this.collectWarnings(zxcvbnResult.feedback));

    const commonPasswordViolation = this.detectCommonPassword(zxcvbnResult.sequence, normalized);
    if (commonPasswordViolation) {
      violations.push(commonPasswordViolation);
    }

    const dictionaryViolation = this.detectDictionaryWord(zxcvbnResult.sequence, normalized);
    if (dictionaryViolation) {
      violations.push(dictionaryViolation);
    }

    const keyboardViolation = this.detectKeyboardPattern(zxcvbnResult.sequence, normalized);
    if (keyboardViolation) {
      violations.push(keyboardViolation);
    }

    if (zxcvbnResult.score < 3) {
      warnings.push('Consider choosing a longer passphrase to improve resistance against guessing attacks.');
    }

    let breached = false;
    if (!options.skipHIBP) {
      try {
        const breachResult = await this.breachService.checkPassword(normalized);
        breached = breachResult.isBreached;
        if (breachResult.isBreached) {
          violations.push({
            code: 'breached_password',
            message: 'This password appears in known data breaches. Please choose a different password.',
            context: breachResult.breachCount ? { breachCount: breachResult.breachCount } : undefined,
          });
        }
      } catch (error) {
        // As required, fail open but emit diagnostic logging for visibility.
        this.logger.warn('Password breach lookup failed, allowing registration but logging event.', error as Error);
      }
    }

    const compliant = violations.length === 0;
    let hash: string | undefined;

    if (compliant && !options.skipHashing) {
      hash = await bcrypt.hash(normalized, BCRYPT_COST);
    }

    return this.buildResult({
      compliant,
      warnings,
      violations,
      score: zxcvbnResult.score,
      crackTimes: zxcvbnResult.crack_times_display,
      breached,
      hash,
    });
  }

  private calculateStrength(password: string, userInputs: string[]): ZXCVBNResult {
    try {
      return zxcvbn(password, userInputs.filter((value) => typeof value === 'string' && value.length > 0));
    } catch (error) {
      this.logger.error('Failed to calculate password strength with zxcvbn', error as Error);
      // Provide a conservative fallback result when zxcvbn cannot be executed.
      return {
        password,
        score: 0,
        guesses: 0,
        guesses_log10: 0,
        sequence: [],
        calc_time: 0,
        feedback: {
          warning: 'Unable to evaluate password strength. Treat as weak.' as unknown as ZXCVBNFeedback['warning'],
          suggestions: [],
        },
        crack_times_seconds: this.emptyCrackTimesSeconds(),
        crack_times_display: this.emptyCrackTimes(),
      } as unknown as ZXCVBNResult;
    }
  }

  private collectWarnings(feedback: ZXCVBNFeedback | undefined): string[] {
    const messages: string[] = [];

    if (!feedback) {
      return messages;
    }

    if (feedback.warning) {
      messages.push(feedback.warning);
    }

    if (feedback.suggestions) {
      messages.push(...feedback.suggestions);
    }

    return messages;
  }

  private detectCommonPassword(sequence: ZXCVBNSequence[], password: string): PasswordPolicyViolation | undefined {
    return sequence.find((entry) => {
      if (entry.pattern !== 'dictionary') {
        return false;
      }

      const dictionaryName = (entry as any).dictionary_name as string | undefined;
      if (!dictionaryName || !COMMON_PASSWORD_DICTIONARIES.has(dictionaryName)) {
        return false;
      }

      // zxcvbn ranks draw from the SecLists top entries. Enforce the top 10k block list.
      if (typeof (entry as any).rank === 'number' && (entry as any).rank > 10000) {
        return false;
      }

      return entry.token.length === password.length;
    })
      ? {
          code: 'common_password',
          message: 'This password is one of the most common choices and is easily guessable.',
        }
      : undefined;
  }

  private detectDictionaryWord(sequence: ZXCVBNSequence[], password: string): PasswordPolicyViolation | undefined {
    const dictionaryEntry = sequence.find((entry) => {
      if (entry.pattern !== 'dictionary') {
        return false;
      }

      const dictionaryName = (entry as any).dictionary_name as string | undefined;
      if (!dictionaryName || !LANGUAGE_DICTIONARIES.has(dictionaryName)) {
        return false;
      }

      return entry.token.length === password.length;
    });

    if (!dictionaryEntry) {
      return undefined;
    }

    return {
      code: 'dictionary_word',
      message: 'Passwords based on dictionary words are easy to guess. Please choose a unique passphrase.',
      context: {
        dictionary: (dictionaryEntry as any).dictionary_name,
      },
    };
  }

  private detectKeyboardPattern(sequence: ZXCVBNSequence[], password: string): PasswordPolicyViolation | undefined {
    const spatialEntry = sequence.find((entry) => entry.pattern === 'spatial' && entry.token.length === password.length);

    if (!spatialEntry) {
      return undefined;
    }

    return {
      code: 'keyboard_pattern',
      message: 'Keyboard walk patterns (for example "qwerty" or sequential digits) are unsafe. Choose a less predictable passphrase.',
      context: {
        graph: (spatialEntry as any).graph,
      },
    };
  }

  private buildResult(params: {
    compliant: boolean;
    warnings: string[];
    violations: PasswordPolicyViolation[];
    score: number;
    crackTimes: ZXCVBNResult['crack_times_display'];
    breached: boolean;
    hash?: string;
  }): PasswordPolicyResult {
    return {
      compliant: params.compliant,
      warnings: params.warnings,
      violations: params.violations,
      score: params.score,
      crackTimesDisplay: params.crackTimes,
      breached: params.breached,
      hash: params.hash,
    };
  }

  private emptyCrackTimes(): ZXCVBNResult['crack_times_display'] {
    return {
      online_throttling_100_per_hour: 'unknown',
      online_no_throttling_10_per_second: 'unknown',
      offline_slow_hashing_1e4_per_second: 'unknown',
      offline_fast_hashing_1e10_per_second: 'unknown',
    };
  }

  private emptyCrackTimesSeconds(): ZXCVBNResult['crack_times_seconds'] {
    return {
      online_throttling_100_per_hour: 0,
      online_no_throttling_10_per_second: 0,
      offline_slow_hashing_1e4_per_second: 0,
      offline_fast_hashing_1e10_per_second: 0,
    };
  }
}
