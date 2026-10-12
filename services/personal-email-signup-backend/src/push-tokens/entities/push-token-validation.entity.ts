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

@Entity('push_token_validation')
@Index('idx_push_token_validation_token', ['tokenId', 'validatedAt'])
@Index('idx_push_token_validation_result', ['validationResult', 'validatedAt'])
export class PushTokenValidation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'token_id' })
  @Index('idx_push_token_validation_token_id')
  tokenId: string;

  @Column('varchar', { length: 50, name: 'validation_type' })
  validationType: string; // 'registration', 'periodic', 'feedback', 'delivery'

  @Column('varchar', { length: 50, name: 'validation_result' })
  validationResult: string; // 'valid', 'invalid', 'expired', 'unregistered'

  @Column('varchar', { length: 50, name: 'validation_source' })
  validationSource: string; // 'fcm_api', 'apns_api', 'delivery_feedback'

  @Column('integer', { name: 'response_code', nullable: true })
  responseCode?: number;

  @Column('text', { name: 'response_message', nullable: true })
  responseMessage?: string;

  @Column('jsonb', { name: 'response_data', default: {} })
  responseData: Record<string, any>;

  @CreateDateColumn({ name: 'validated_at' })
  validatedAt: Date;

  @Column('varchar', { length: 100, name: 'correlation_id', nullable: true })
  correlationId?: string;

  @Column('varchar', { length: 50, name: 'tenant_id', default: 'default' })
  @Index('idx_push_token_validation_tenant_id')
  tenantId: string;

  // Relation to push token
  @ManyToOne(() => PushToken, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'token_id' })
  token: PushToken;
}