// Configuração central do Handly. Tudo pode ser sobrescrito por variáveis de ambiente.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const int = (name, d) => { const v = parseInt(env[name], 10); return Number.isFinite(v) ? v : d; };

export function loadConfig(overrides = {}) {
  const ENV = env.HANDLY_ENV || 'development';
  return {
    ENV,
    DEBUG_TOOLS: ENV !== 'production',          // habilita /api/dev/* (caixa de e-mails simulada)
    DB_PATH: env.HANDLY_DB || path.join(ROOT, 'data', 'handly.db'),
    PORT: int('PORT', int('HANDLY_PORT', 5000)),
    HOST: env.HANDLY_HOST || '0.0.0.0',
    SESSION_IDLE_MINUTES: int('HANDLY_SESSION_IDLE_MIN', 30),
    SESSION_REMEMBER_DAYS: int('HANDLY_SESSION_REMEMBER_DAYS', 7),
    COOKIE_NAME: 'handly_session',
    COOKIE_SECURE: env.HANDLY_COOKIE_SECURE === '1',
    LOGIN_MAX_FAILS: 5,
    LOGIN_WINDOW_MIN: 15,
    DEFAULT_MIN_NOTICE_HOURS: 2,
    MIN_NOTICE_LIMIT_HOURS: 720,
    MAX_NOTICE_LIMIT_HOURS: 4320,
    CANCEL_DEADLINE_HOURS: 2,
    CANCEL_FEE_WINDOW_HOURS: 24,
    SLOT_STEP_MIN: 30,
    REVIEW_EDIT_DAYS: 7,
    VERIFICATION_MAX_ATTEMPTS_24H: 3,
    REPORT_MAX_ROWS: 5000,
    REPORT_MAX_CONCURRENT: 2,
    REPORT_CONFIRM_DAYS: 90,
    SMTP_HOST: env.HANDLY_SMTP_HOST || '',
    SMTP_PORT: int('HANDLY_SMTP_PORT', 587),
    SMTP_USER: env.HANDLY_SMTP_USER || '',
    SMTP_PASSWORD: env.HANDLY_SMTP_PASSWORD || '',
    SMTP_FROM: env.HANDLY_SMTP_FROM || 'Handly <nao-responda@handly.local>',
    PUBLIC_URL: env.HANDLY_PUBLIC_URL || 'http://localhost:5000',
    VERIFICATION_PROVIDER: env.HANDLY_VERIFICATION_PROVIDER || 'mock',
    VERIFICATION_URL: env.HANDLY_VERIFICATION_URL || '',
    VERIFICATION_API_KEY: env.HANDLY_VERIFICATION_API_KEY || '',
    ADMIN_LOGIN: env.HANDLY_ADMIN_LOGIN || 'admin',
    ADMIN_EMAIL: env.HANDLY_ADMIN_EMAIL || 'admin@handly.local',
    ADMIN_PASSWORD: env.HANDLY_ADMIN_PASSWORD || '',
    HEARTBEAT_SECONDS: int('HANDLY_HEARTBEAT_SECONDS', 60),
    JOBS: env.HANDLY_JOBS !== '0',
    TEST_HOOKS: env.HANDLY_TEST_HOOKS === '1',
    QUIET: env.HANDLY_QUIET === '1',
    ...overrides,
  };
}
