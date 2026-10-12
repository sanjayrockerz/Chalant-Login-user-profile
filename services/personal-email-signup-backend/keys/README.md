# Key Management

## Overview

This directory contains encryption keys, signing keys, and key management documentation. **NO actual keys should be committed to this repository.**

## ⚠️ Security Policy

### CRITICAL RULES

1. **NEVER commit actual keys to Git**
2. **NEVER store keys in plaintext**
3. **ALWAYS use secret management systems**
4. **ALWAYS rotate keys regularly**
5. **ALWAYS restrict access to production keys**

## Key Types

### JWT Signing Keys

**Purpose**: Sign and verify JWT tokens for authentication

**Storage**:
- **Development**: `.env.local` (not committed)
- **Staging/Production**: Kubernetes Secrets or AWS Secrets Manager

**Format**: RS256 (RSA public/private key pair) or HS256 (symmetric secret)

**Rotation**: Every 90 days

---

### Encryption Keys

**Purpose**: Encrypt sensitive user data (PII, email addresses)

**Storage**:
- **Production**: AWS KMS or Vault
- **Development**: Local environment variable

**Format**: AES-256-GCM

**Rotation**: Every 180 days

---

### API Keys

**Purpose**: Third-party service authentication (email service, monitoring)

**Storage**: Kubernetes Secrets

**Rotation**: Per vendor policy (typically 90 days)

---

## Key Management Workflow

### 1. Key Generation

```bash
# Generate JWT signing key (RS256)
openssl genrsa -out private.key 2048
openssl rsa -in private.key -pubout -out public.key

# Generate symmetric secret (HS256)
openssl rand -base64 32

# Generate encryption key (AES-256)
openssl rand -hex 32
```

**⚠️ Important**: Never run these commands in this directory. Generate keys in a secure location and immediately transfer to secret management system.

---

### 2. Key Storage

#### Local Development

```bash
# .env.local (DO NOT COMMIT)
JWT_SECRET=your-development-secret-here
ENCRYPTION_KEY=your-development-encryption-key
```

#### Kubernetes Secrets

```bash
# Create secret from file
kubectl create secret generic signup-backend-secrets \
  --from-file=jwt-private-key=./private.key \
  --from-file=jwt-public-key=./public.key \
  --namespace=production

# Create secret from literal
kubectl create secret generic api-keys \
  --from-literal=EMAIL_SERVICE_KEY='sk_live_...' \
  --namespace=production
```

#### AWS Secrets Manager

```bash
# Store secret
aws secretsmanager create-secret \
  --name signup-backend/jwt-secret \
  --secret-string "your-secret-value" \
  --region us-east-1

# Retrieve secret
aws secretsmanager get-secret-value \
  --secret-id signup-backend/jwt-secret \
  --region us-east-1
```

---

### 3. Key Rotation

#### Automated Rotation (Recommended)

```bash
# Use AWS Secrets Manager auto-rotation
aws secretsmanager rotate-secret \
  --secret-id signup-backend/jwt-secret \
  --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789:function:rotate-jwt

# Schedule rotation every 90 days
aws secretsmanager put-rotation-schedule \
  --secret-id signup-backend/jwt-secret \
  --rotation-rules AutomaticallyAfterDays=90
```

#### Manual Rotation

```bash
# 1. Generate new key
NEW_SECRET=$(openssl rand -base64 32)

# 2. Update Kubernetes secret
kubectl create secret generic signup-backend-secrets \
  --from-literal=JWT_SECRET="$NEW_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Rolling restart to pick up new secret
kubectl rollout restart deployment/signup-backend -n production

# 4. Verify service health
kubectl rollout status deployment/signup-backend -n production

# 5. Revoke old key (grace period: 24 hours)
```

---

### 4. Key Access Control

#### RBAC (Kubernetes)

```yaml
# secret-reader-role.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: secret-reader
  namespace: production
rules:
- apiGroups: [""]
  resources: ["secrets"]
  resourceNames: ["signup-backend-secrets"]
  verbs: ["get", "list"]
```

#### IAM (AWS)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:signup-backend/*"
    }
  ]
}
```

---

## Key Usage in Code

### JWT Signing

```typescript
// auth.service.ts
import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthService {
  private jwtSecret: string;

  constructor() {
    // Load from environment variable or secret management
    this.jwtSecret = process.env.JWT_SECRET;
    
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET not configured');
    }
  }

  signToken(userId: string): string {
    return jwt.sign(
      { sub: userId },
      this.jwtSecret,
      { expiresIn: '1h' }
    );
  }

  verifyToken(token: string): any {
    return jwt.verify(token, this.jwtSecret);
  }
}
```

### Data Encryption

```typescript
// encryption.service.ts
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private encryptionKey: Buffer;
  private algorithm = 'aes-256-gcm';

  constructor() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new Error('ENCRYPTION_KEY not configured');
    }
    this.encryptionKey = Buffer.from(key, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      this.algorithm,
      this.encryptionKey,
      iv
    );

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();

    // Return: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(ciphertext: string): string {
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.encryptionKey,
      iv
    );
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}
```

---

## Key Rotation Checklist

### Pre-Rotation

- [ ] Schedule maintenance window
- [ ] Notify stakeholders
- [ ] Create backup of current keys
- [ ] Test rotation in staging environment
- [ ] Prepare rollback plan

### During Rotation

- [ ] Generate new key
- [ ] Update secret in secret management system
- [ ] Deploy new key to pods (rolling restart)
- [ ] Verify service health
- [ ] Monitor error rates and logs

### Post-Rotation

- [ ] Verify all pods using new key
- [ ] Monitor for authentication failures
- [ ] Grace period: Keep old key valid for 24 hours
- [ ] Revoke old key after grace period
- [ ] Update documentation with rotation date
- [ ] Archive old key securely (compliance)

---

## Incident Response

### Compromised Key

1. **Immediate Actions** (within 5 minutes):
   - Rotate compromised key immediately
   - Revoke all tokens signed with old key
   - Enable enhanced monitoring

2. **Investigation** (within 1 hour):
   - Identify scope of compromise
   - Check access logs for unauthorized usage
   - Determine root cause

3. **Remediation** (within 4 hours):
   - Deploy new key to all environments
   - Force user re-authentication
   - Update security policies

4. **Post-Incident** (within 48 hours):
   - Conduct post-mortem
   - Update security procedures
   - Notify affected users (if required by law)

### Lost Key Access

If access to production keys is lost:

1. Contact DevOps team immediately
2. Use emergency break-glass procedure
3. Retrieve key from AWS Secrets Manager backup
4. Restore access and rotate key as precaution

---

## Compliance & Audit

### Key Lifecycle Logging

All key operations should be logged:

```typescript
logger.audit('Key rotation initiated', {
  key_type: 'JWT_SECRET',
  rotated_by: 'admin@company.com',
  timestamp: new Date().toISOString(),
  environment: 'production',
});
```

### Audit Trail Requirements

- **Retention**: 2 years
- **Immutability**: Store in append-only log
- **Access Control**: SOC 2 compliance
- **Encryption**: Encrypt logs at rest

### Compliance Standards

- **PCI DSS**: Key rotation every 90 days
- **SOC 2**: Key access logging required
- **GDPR**: Encryption of personal data
- **HIPAA**: Key management procedures documented

---

## Key Directory Structure

```
keys/
├── README.md                    # This file
├── .gitignore                   # Ignore all key files
├── rotation-schedule.md         # Key rotation calendar
└── templates/
    ├── jwt-key-template.env     # Template for JWT keys
    └── encryption-key-template.env  # Template for encryption keys
```

### .gitignore

```
# Ignore all actual keys
*.key
*.pem
*.p12
*.jks
*.env
*.env.local
*.secret

# Only commit documentation
!README.md
!rotation-schedule.md
!templates/*.template.env
```

---

## Emergency Contacts

- **Security Team**: security@company.com
- **DevOps Oncall**: oncall@company.com
- **Incident Response**: incidents@company.com
- **PagerDuty**: +1-XXX-XXX-XXXX

---

## Related Documentation

- [Security Best Practices](../docs/security/README.md)
- [Incident Response Playbook](../docs/production-readiness/runbook.md)
- [AWS Secrets Manager Guide](https://docs.aws.amazon.com/secretsmanager/)
- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)

---

## Quick Reference

### Generate JWT Secret
```bash
openssl rand -base64 32
```

### View Kubernetes Secret
```bash
kubectl get secret signup-backend-secrets -o jsonpath='{.data.JWT_SECRET}' | base64 -d
```

### Rotate Secret
```bash
./scripts/rotate-secrets.sh --secret JWT_SECRET
```

### Verify Key Loading
```bash
kubectl exec -it deployment/signup-backend -- env | grep JWT_SECRET
```
