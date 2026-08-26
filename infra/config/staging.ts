import { EnvironmentConfig } from './environment.types';

export const stagingConfig: EnvironmentConfig = {
  envName: 'staging',
  account: '438633446050',
  region: 'us-east-2',
  prefix: 'skyalert-stg',

  tags: {
    Environment: 'staging',
    Project: 'skyalert-lite',
    Team: 'skyalert-backend',
    ManagedBy: 'cdk',
  },

  lambda: {
    memoryMb: 256,
    timeoutSeconds: 30,
    // Sin reserved concurrency en staging para ahorrar costos
  },

  dynamodb: {
    billingMode: 'PAY_PER_REQUEST',
    pointInTimeRecovery: false,
    deletionProtection: false,
  },

  apiGateway: {
    throttleRateLimit: 100,
    throttleBurstLimit: 50,
  },

  logging: {
    retentionDays: 14,
    level: 'DEBUG',
  },

  monitoring: {
    enableAlarms: false,
  },
};
