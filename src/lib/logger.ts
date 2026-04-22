import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
  redact: {
    paths: ['patient.email', 'patient.name', 'patientEmail', 'patientName', 'shippingAddress'],
    censor: '[REDACTED]',
  },
});
