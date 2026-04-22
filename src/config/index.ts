import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DENTIRA_BASE_URL: z.string().url().default('https://vendor-caresbx.dentira.com'),
  DENTIRA_CLIENT_ID: z.string().default('ortho_nu'),
  DENTIRA_CLIENT_SECRET: z.string().min(1, 'DENTIRA_CLIENT_SECRET is required'),
  DENTIRA_WEBHOOK_SECRET: z.string().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DEMO_MODE: z.string().transform(v => v === 'true').default('false'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
