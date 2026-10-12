import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index
} from 'typeorm';
import { PushToken } from './push-token.entity';

@Entity('push_token_audit')
@Index('idx_push_token_audit_user_event', ['userId', 'eventType', 'createdAt'])
@Index('idx_push_token_audit_correlation', ['correlationId', 'createdAt'])
@Index('idx_push_token_audit_expiration', ['expiresAt'])
export class PushTokenAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'token_id', nullable: true })
  tokenId?: string;

  @Column('uuid', { name: 'user_id' })
  @Index('idx_push_token_audit_user_id')
  userId: string;

  @Column('varchar', { length: 50, name: 'event_type' })
  eventType: string; // 'registered', 'updated', 'validated', 'failed', 'deleted'

  @Column('jsonb', { name: 'event_data', default: {} })
  eventData: Record<string, any>;

  @Column('varchar', { length: 100, name: 'correlation_id', nullable: true })
  correlationId?: string;

  @Column('varchar', { length: 50, name: 'tenant_id', default: 'default' })
  @Index('idx_push_token_audit_tenant_id')
  tenantId: string;

  @Column('text', { name: 'user_agent', nullable: true })
  userAgent?: string;

  @Column('inet', { name: 'ip_address', nullable: true })
  ipAddress?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column('varchar', { length: 100, name: 'created_by', nullable: true })
  createdBy?: string;

  @Column('timestamp with time zone', { 
    name: 'expires_at',
    default: () => "(NOW() + INTERVAL '7 years')"
  })
  expiresAt: Date;

  // Optional relation to push token (may be null if token is deleted)
  @ManyToOne(() => PushToken, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'token_id' })
  token?: PushToken;
}