import { Pool, PoolClient } from 'pg';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  isEmailVerified: boolean;
  isAccountLocked: boolean;
  mfaEnabled?: boolean;
  mfaSecret?: string;
  createdAt: Date;
  updatedAt: Date;
  // Optional policy acceptance fields (added for consent tracking)
  termsVersion?: string;
  termsAcceptedAt?: Date;
}

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  deviceId?: string;
  ipAddress?: string;
  userAgent?: string;
  isRevoked: boolean;
  createdAt: Date;
}

export class DatabaseManager {
  private static instance: DatabaseManager;
  private pool: Pool;

  private constructor() {
    this.pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
      ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
      max: config.database.pool.max,
      min: config.database.pool.min,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected error on idle client', { error: err.message });
    });
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      client.release();
      logger.info('Database connected successfully');
    } catch (error) {
      logger.error('Database connection failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database connection closed');
  }

  public async disconnect(): Promise<void> {
    return this.close();
  }

  public async findUserByEmail(email: string): Promise<User | null> {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT id, email, password_hash as "passwordHash", 
               is_email_verified as "isEmailVerified", 
               is_account_locked as "isAccountLocked",
               mfa_enabled as "mfaEnabled",
               mfa_secret as "mfaSecret",
               terms_version as "termsVersion",
               terms_accepted_at as "termsAcceptedAt",
               created_at as "createdAt",
               updated_at as "updatedAt"
        FROM users 
        WHERE email = $1 AND deleted_at IS NULL
      `;
      
      const result = await client.query(query, [email]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error finding user by email', { 
        email, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    } finally {
      client.release();
    }
  }

  public async findUserById(id: string): Promise<User | null> {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT id, email, password_hash as "passwordHash", 
               is_email_verified as "isEmailVerified", 
               is_account_locked as "isAccountLocked",
               mfa_enabled as "mfaEnabled",
               mfa_secret as "mfaSecret",
               terms_version as "termsVersion",
               terms_accepted_at as "termsAcceptedAt",
               created_at as "createdAt",
               updated_at as "updatedAt"
        FROM users 
        WHERE id = $1 AND deleted_at IS NULL
      `;
      
      const result = await client.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error finding user by ID', { 
        id, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    } finally {
      client.release();
    }
  }

  public async query(text: string, params?: any[]): Promise<any> {
    const client = await this.pool.connect();
    try {
      return await client.query(text, params);
    } finally {
      client.release();
    }
  }

  public async transaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async updateUser(id: string, userData: Partial<User>): Promise<User | null> {
    const client = await this.pool.connect();
    try {
      const fields = [];
      const values = [];
      let paramIndex = 1;

      if (userData.passwordHash !== undefined) {
        fields.push(`password_hash = $${paramIndex++}`);
        values.push(userData.passwordHash);
      }
      if (userData.isEmailVerified !== undefined) {
        fields.push(`is_email_verified = $${paramIndex++}`);
        values.push(userData.isEmailVerified);
      }
      if (userData.isAccountLocked !== undefined) {
        fields.push(`is_account_locked = $${paramIndex++}`);
        values.push(userData.isAccountLocked);
      }
      if (userData.mfaEnabled !== undefined) {
        fields.push(`mfa_enabled = $${paramIndex++}`);
        values.push(userData.mfaEnabled);
      }
      if (userData.mfaSecret !== undefined) {
        fields.push(`mfa_secret = $${paramIndex++}`);
        values.push(userData.mfaSecret);
      }
      // Support terms/consent fields (camelCase from application layer)
      if ((userData as any).termsVersion !== undefined) {
        fields.push(`terms_version = $${paramIndex++}`);
        values.push((userData as any).termsVersion);
      }
      if ((userData as any).termsAcceptedAt !== undefined) {
        fields.push(`terms_accepted_at = $${paramIndex++}`);
        values.push((userData as any).termsAcceptedAt);
      }

      if (fields.length === 0) {
        return this.findUserById(id);
      }

  fields.push(`updated_at = NOW()`);
      values.push(id);

      const query = `
        UPDATE users 
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex} AND deleted_at IS NULL
        RETURNING id, email, password_hash as "passwordHash", 
                  is_email_verified as "isEmailVerified", 
                  is_account_locked as "isAccountLocked",
                  mfa_enabled as "mfaEnabled",
                  mfa_secret as "mfaSecret",
                  terms_version as "termsVersion",
                  terms_accepted_at as "termsAcceptedAt",
                  created_at as "createdAt",
                  updated_at as "updatedAt"
      `;

      const result = await client.query(query, values);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error updating user', { 
        id, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    } finally {
      client.release();
    }
  }

  public async createRefreshToken(tokenData: Partial<RefreshToken>): Promise<RefreshToken> {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, device_id, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, user_id as "userId", token_hash as "tokenHash", 
                  expires_at as "expiresAt", device_id as "deviceId",
                  ip_address as "ipAddress", user_agent as "userAgent",
                  is_revoked as "isRevoked", created_at as "createdAt"
      `;
      
      const values = [
        tokenData.userId,
        tokenData.tokenHash,
        tokenData.expiresAt,
        tokenData.deviceId,
        tokenData.ipAddress,
        tokenData.userAgent
      ];
      
      const result = await client.query(query, values);
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating refresh token', { 
        userId: tokenData.userId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    } finally {
      client.release();
    }
  }

  public async findRefreshToken(tokenHash: string): Promise<RefreshToken | null> {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT id, user_id as "userId", token_hash as "tokenHash", 
               expires_at as "expiresAt", device_id as "deviceId",
               ip_address as "ipAddress", user_agent as "userAgent",
               is_revoked as "isRevoked", created_at as "createdAt"
        FROM refresh_tokens 
        WHERE token_hash = $1
      `;
      
      const result = await client.query(query, [tokenHash]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error finding refresh token', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create an auth_credentials row for a user. This centralizes INSERTs so we can
   * ensure tenant_id is always populated and normalized.
   */
  public async createAuthCredential(data: {
    userId: string;
    tenantId?: string | null;
    passwordHash: string;
    pepperVersion: number;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
  // Insert tenant_id only. Legacy shard key column is deprecated and will be removed via a controlled migration.
      await client.query(
        `INSERT INTO auth_credentials (user_id, tenant_id, password_hash, pepper_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [data.userId, data.tenantId || null, data.passwordHash, data.pepperVersion]
      );
    } catch (error) {
      logger.error('Error creating auth credential', {
        userId: data.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update tenant_id on an auth_credentials row. Safe to call during provisioning flows.
   */
  public async updateAuthCredentialTenant(userId: string, tenantId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE auth_credentials SET tenant_id = $1, updated_at = NOW() WHERE user_id = $2`,
        [tenantId, userId]
      );
      return (result.rowCount || 0) > 0;
    } catch (error) {
      logger.error('Error updating auth credential tenant', { userId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    } finally {
      client.release();
    }
  }

  public async revokeRefreshToken(tokenHash: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE refresh_tokens 
        SET is_revoked = true, updated_at = NOW()
        WHERE token_hash = $1
      `;
      
      const result = await client.query(query, [tokenHash]);
      return (result.rowCount || 0) > 0;
    } catch (error) {
      logger.error('Error revoking refresh token', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    } finally {
      client.release();
    }
  }

  public async revokeUserTokens(userId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE refresh_tokens 
        SET is_revoked = true, updated_at = NOW()
        WHERE user_id = $1 AND is_revoked = false
      `;
      
      const result = await client.query(query, [userId]);
      return (result.rowCount || 0) > 0;
    } catch (error) {
      logger.error('Error revoking user tokens', { 
        userId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    } finally {
      client.release();
    }
  }

  public async executeQuery(query: string, params: any[] = []): Promise<any> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(query, params);
      return result;
    } catch (error) {
      logger.error('Database query execution failed', {
        query: query.substring(0, 100),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    } finally {
      client.release();
    }
  }

  public async executeTransaction<T>(queries: Array<{query: string, params: any[]}>, callback?: (client: PoolClient) => Promise<T>): Promise<T | void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      if (callback) {
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } else {
        for (const { query, params } of queries) {
          await client.query(query, params);
        }
        await client.query('COMMIT');
      }
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    } finally {
      client.release();
    }
  }

  public async getConnection() {
    return await this.pool.connect();
  }
}
