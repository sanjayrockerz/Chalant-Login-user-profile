import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  ManyToOne, 
  JoinColumn,
  Index,
  Check
} from 'typeorm';
import { PushPlatform, PushTokenType } from '../dto/push-token.dto';

@Entity('push_tokens')
@Index('idx_push_tokens_user_active', ['userId', 'active', 'platform'], { 
  where: 'active = true AND deleted_at IS NULL' 
})
@Index('idx_push_tokens_validation', ['lastValidatedAt', 'platform'], { 
  where: 'active = true AND deleted_at IS NULL' 
})
@Index('idx_push_tokens_failures', ['failureCount', 'lastFailureAt'], { 
  where: 'active = true AND failure_count > 0' 
})
@Index('idx_push_tokens_tenant', ['tenantId', 'active'], { 
  where: 'active = true AND deleted_at IS NULL' 
})
@Index('idx_push_tokens_targeting', ['tenantId', 'platform', 'active', 'lastValidatedAt'], { 
  where: 'active = true AND deleted_at IS NULL' 
})
@Check('valid_platform_token_type', 
  "(platform = 'ios' AND token_type = 'apns') OR (platform = 'android' AND token_type = 'fcm')"
)
export class PushToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  @Index('idx_push_tokens_user_id')
  userId: string;

  @Column('varchar', { length: 4096 })
  token: string;

  @Column('varchar', { length: 64, name: 'token_hash', nullable: true })
  @Index('idx_push_tokens_hash')
  tokenHash?: string;

  @Column({
    type: 'enum',
    enum: PushPlatform,
    enumName: 'push_platform'
  })
  platform: PushPlatform;

  @Column({
    type: 'enum',
    enum: PushTokenType,
    enumName: 'push_token_type',
    name: 'token_type'
  })
  tokenType: PushTokenType;

  @Column('jsonb', { name: 'device_metadata', default: {} })
  deviceMetadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column('timestamp with time zone', { 
    name: 'last_validated_at',
    default: () => 'NOW()'
  })
  lastValidatedAt: Date;

  @Column('timestamp with time zone', { 
    name: 'last_used_at',
    nullable: true
  })
  lastUsedAt?: Date;

  @Column('boolean', { default: true })
  active: boolean;

  @Column('integer', { name: 'failure_count', default: 0 })
  failureCount: number;

  @Column('timestamp with time zone', { 
    name: 'last_failure_at',
    nullable: true
  })
  lastFailureAt?: Date;

  @Column('text', { name: 'failure_reason', nullable: true })
  failureReason?: string;

  @Column('varchar', { length: 50, name: 'tenant_id', default: 'default' })
  @Index('idx_push_tokens_tenant_id')
  tenantId: string;

  @Column('varchar', { length: 100, name: 'created_by', nullable: true })
  createdBy?: string;

  @Column('timestamp with time zone', { 
    name: 'deleted_at',
    nullable: true
  })
  deletedAt?: Date;
}

// Unique constraint index (using unique index instead of constraint for conditional uniqueness)
@Index('idx_push_tokens_unique_user_token', ['userId', 'tokenHash', 'platform'], {
  unique: true,
  where: 'active = true AND deleted_at IS NULL'
})
export class PushTokenUniqueConstraint {}