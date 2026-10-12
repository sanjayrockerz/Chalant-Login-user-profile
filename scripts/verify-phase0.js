const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const r1 = path.join(repo, 'services/login-page-back');
const r2 = path.join(repo, 'services/personal-email-signup-backend');

function fail(message) {
  console.error(`PHASE0_FAIL: ${message}`);
  process.exitCode = 1;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function tracked(repoRoot, pattern) {
  const result = spawnSync('git', ['-C', repoRoot, 'ls-files', '--', pattern], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`git ls-files failed for ${repoRoot}: ${result.stderr.trim()}`);
    return [];
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function ignored(repoRoot, file) {
  const result = spawnSync('git', ['-C', repoRoot, 'check-ignore', '-q', '--', file]);
  return result.status === 0;
}

const appModule = read(path.join(repo, 'services/personal-email-signup-backend/src/app.module.ts'));
if (!/from ['"]\.\/auth_cc\/auth\.module['"]/.test(appModule)) {
  fail('R3 signup AppModule does not select auth_cc as the authoritative auth module');
}
if (appModule.includes("from './auth/auth.module'")) {
  fail('R3 signup AppModule imports the stub auth module');
}
if (appModule.includes('AuthController')) {
  fail('R3 signup AppModule registers the quarantined stub AuthController');
}

const quarantinedGuard = read(path.join(repo, 'services/personal-email-signup-backend/src/auth/jwt-auth.guard.ts'));
if (!quarantinedGuard.includes('ServiceUnavailableException') || !quarantinedGuard.includes('fails closed')) {
  fail('R3 legacy JwtAuthGuard is not explicitly fail-closed during Phase 0');
}
const profileController = read(path.join(repo, 'services/personal-email-signup-backend/src/user/profile.controller.ts'));
if (!profileController.includes('@UseGuards(JwtAuthGuard)')) {
  fail('R3 profile controller is not protected by the canonical authentication seam');
}

const r1Package = path.join(r1, 'package.json');
if (fs.existsSync(r1Package)) {
  const r1Environment = read(path.join(r1, 'src/config/environment.ts'));
  if (r1Environment.includes('your-super-secret-access-key-change-in-production') ||
      r1Environment.includes('your-super-secret-refresh-key-change-in-production')) {
    fail('R1 still contains insecure JWT fallback secrets');
  }
}
const knexfilePath = path.join(r1, 'knexfile.ts');
if (fs.existsSync(knexfilePath)) {
  const knexfile = read(knexfilePath);
  if (knexfile.includes("DB_PASSWORD || 'password'")) {
    fail('R1 Knex configuration still has a password fallback');
  }
}
if (fs.existsSync(r1Package)) {
  const r1AuthRoutes = read(path.join(r1, 'src/routes/auth.routes.ts'));
  const mfaSetup = r1AuthRoutes.slice(r1AuthRoutes.indexOf("router.post('/mfa/setup'"));
  if (!mfaSetup.includes('authenticateToken') || mfaSetup.includes('req.body') || !mfaSetup.includes('req.user?.id')) {
    fail('R1 MFA setup does not bind the target account to the authenticated principal');
  }
} else {
  console.log('PHASE0_INFO: login-page-back is a specification-only service without package.json; executable checks are deferred.');
}

for (const [name, root, files] of [
  ['R1', r1, ['.env', '.env.test', 'keys/checkpoint_private.pem']],
  ['R2', r2, ['.env', '.env.test', 'key.pem']],
  ['R3 signup', repo, ['services/personal-email-signup-backend/.env']],
]) {
  for (const file of files) {
    if (tracked(root, file).includes(file)) fail(`${name} still tracks sensitive file ${file}`);
    if (!ignored(root, file)) fail(`${name} does not ignore local sensitive file ${file}`);
  }
}

const trackedNodeModules = tracked(repo, '**/node_modules/**');
if (trackedNodeModules.length !== 0) {
  fail(`R3 still tracks ${trackedNodeModules.length} node_modules paths`);
}

if (process.exitCode) process.exit();
console.log('PHASE0_OK: auth wiring, fail-closed R1 configuration, sensitive-file tracking, and generated dependency tracking checks passed.');
