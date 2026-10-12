/**
 * User Entity Stub
 * 
 * User data model for database operations.
 * This stub enables TypeScript compilation and NestJS DI resolution.
 * 
 * TODO: Replace with actual user entity implementation
 * - Define complete user schema
 * - Add validation decorators
 * - Implement relationships with other entities
 * - Add audit fields and soft deletes
 * 
 * Consumers: Policies service, other services
 * Priority: Medium (data model)
 */

export interface User {
  id: string;
  email: string;
  username: string;
  password: string;
  isVerified: boolean;
  verificationToken?: string | null;
  
  // Profile fields
  displayName?: string | null;
  declaredAge?: number | null;
  profileImageUrl?: string | null;
  pronouns?: string | null;
  
  // Username management
  normalizedUsername?: string | null;
  displayUsername?: string | null;
  usernameUpdatedAt?: Date | null;
  
  // Policy acceptance
  termsVersion?: string | null;
  termsAcceptedAt?: Date | null;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User entity class for compatibility
 */
export class User {
  id: string;
  email: string;
  username: string;
  password: string;
  isVerified: boolean;
  verificationToken?: string | null;
  displayName?: string | null;
  declaredAge?: number | null;
  profileImageUrl?: string | null;
  pronouns?: string | null;
  normalizedUsername?: string | null;
  displayUsername?: string | null;
  usernameUpdatedAt?: Date | null;
  termsVersion?: string | null;
  termsAcceptedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(data: Partial<User> = {}) {
    Object.assign(this, data);
  }
}