export type EnvironmentName = 'staging' | 'production';

export interface EnvironmentConfig {
  /** Nombre del ambiente */
  envName: EnvironmentName;

  /** AWS Account ID */
  account: string;

  /** AWS Region */
  region: string;

  /** Prefijo para nombres de recursos — identifica ambiente en consola AWS */
  prefix: string;

  /** Tags obligatorios para todos los recursos */
  tags: {
    Environment: string;
    Project: string;
    Team: string;
    ManagedBy: string;
  };

  /** Configuración de Lambda */
  lambda: {
    memoryMb: number;
    timeoutSeconds: number;
    reservedConcurrency?: number;
  };

  /** Configuración de DynamoDB */
  dynamodb: {
    billingMode: 'PAY_PER_REQUEST' | 'PROVISIONED';
    pointInTimeRecovery: boolean;
    deletionProtection: boolean;
  };

  /** Configuración de API Gateway */
  apiGateway: {
    throttleRateLimit: number;
    throttleBurstLimit: number;
  };

  /** Configuración de logging */
  logging: {
    retentionDays: number;
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  };

  /** Alarmas y monitoreo */
  monitoring: {
    enableAlarms: boolean;
    alarmEmail?: string;
  };
}
