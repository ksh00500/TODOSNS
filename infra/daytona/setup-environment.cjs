const { randomBytes } = require('node:crypto');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '../..');
if (existsSync(resolve(root, '.env'))) throw new Error('An environment already exists; refusing to overwrite it.');
const privateDir = resolve(root, '.daytona-private');
mkdirSync(privateDir, { recursive: true, mode: 0o700 });
const secret = () => randomBytes(24).toString('hex');
const passwords = { bootstrap: secret(), runtime: secret(), migrator: secret(), backup: secret() };
const database = (role, password) => `postgresql://${role}:${password}@127.0.0.1:5432/mungsil_dev?schema=public`;
const runtime = database('mungsil_runtime', passwords.runtime);
const migrator = database('mungsil_migrator', passwords.migrator) + '&options=-c%20role%3Dmungsil_owner';
const backup = database('mungsil_backup', passwords.backup);
const values = {
  NODE_ENV: 'development', DATABASE_URL: runtime, REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: secret(), JWT_REFRESH_SECRET: secret(),
  WEB_ORIGIN: 'http://localhost:8080,http://127.0.0.1:8080,http://localhost:3000,http://127.0.0.1:3000', SITE_ORIGIN: 'http://localhost:8080',
  API_ORIGIN: 'http://localhost:4000', GOOGLE_AUTH_ENABLED: 'false', PUSH_ENABLED: 'false',
  MINIO_ENDPOINT: 'http://127.0.0.1:9000', MINIO_PUBLIC_ENDPOINT: 'http://localhost:9000',
  MINIO_ACCESS_KEY: 'sandbox' + randomBytes(8).toString('hex'), MINIO_SECRET_KEY: secret(), MINIO_BUCKET: 'mungsil-media',
  SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_FROM: 'sandbox@mungsil.test', SMTP_SECURE: 'false',
  COOKIE_SECURE: 'false', TRUST_PROXY_HOPS: '0', SWAGGER_ENABLED: 'true', INVITE_REQUIRED: 'false',
  APP_TIMEZONE: 'Asia/Seoul', ANALYTICS_COLLECTION_ENABLED: 'false', ANALYTICS_EXPORT_ENABLED: 'false',
  NEXT_PUBLIC_API_URL: '/api/v1', NEXT_PUBLIC_SOCKET_URL: '', NEXT_PUBLIC_SITE_URL: 'http://localhost:8080', NEXT_PUBLIC_ENABLE_DEMO: 'false',
  DEV_POSTGRES_PASSWORD: passwords.bootstrap,
};
const save = (path, text) => writeFileSync(resolve(root, path), text, { mode: 0o600 });
save('.env', Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
save('.daytona-private/database.env', Object.entries({
  MUNGSIL_RUNTIME_DB_PASSWORD: passwords.runtime, MUNGSIL_MIGRATOR_DB_PASSWORD: passwords.migrator,
  MUNGSIL_BACKUP_DB_PASSWORD: passwords.backup, PGPASSWORD: passwords.bootstrap,
}).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
save('.daytona-private/runtime-url', runtime + '\n');
save('.daytona-private/migrator-url', migrator + '\n');
save('.daytona-private/backup-url', backup + '\n');
console.log('Generated sandbox-only environment and database credentials; Google and FCM disabled.');
