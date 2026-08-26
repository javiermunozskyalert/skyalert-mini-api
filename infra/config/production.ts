import { EnvironmentConfig } from './environment.types';

export const productionConfig: EnvironmentConfig = {
  envName: 'production',
  account: process.env.CDK_DEFAULT_ACCOUNT ?? '',
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  prefix: 'skyalert-prod',

  tags: {
    Environment: 'production',
    Project: 'skyalert-lite',
    Team: 'skyalert-backend',
    ManagedBy: 'cdk',
  },

  lambda: {
    memoryMb: 512,
    timeoutSeconds: 30,
    reservedConcurrency: 100,
  },

  dynamodb: {
    billingMode: 'PAY_PER_REQUEST',
    pointInTimeRecovery: true,
    deletionProtection: true,
  },

  apiGateway: {
    throttleRateLimit: 1000,
    throttleBurstLimit: 500,
  },

  logging: {
    retentionDays: 90,
    level: 'INFO',
  },

  monitoring: {
    enableAlarms: true,
    alarmEmail: '', // Configurar con el email real del equipo
  },
};
