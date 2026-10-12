import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('policy_acceptance_history')
export class PolicyAcceptanceHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('uuid')
  userId: string;

  @Column()
  policyVersion: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  acceptedAt: Date;

  @Column({ nullable: true })
  source: string;

  @Column({ nullable: true })
  notes: string;
}
