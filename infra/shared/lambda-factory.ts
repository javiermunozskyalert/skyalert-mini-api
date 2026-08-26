import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config';

interface LambdaFactoryProps {
  config: EnvironmentConfig;
  entry: string;
  environment?: Record<string, string>;
  timeout?: cdk.Duration;
  memorySize?: number;
}

/**
 * Factory para crear Lambdas con configuración consistente por ambiente.
 * Centraliza: runtime, bundling, logs, timeouts, arquitectura.
 */
export function createLambdaFunction(
  scope: Construct,
  id: string,
  props: LambdaFactoryProps
): NodejsFunction {
  const { config, entry, environment = {} } = props;

  const fn = new NodejsFunction(scope, id, {
    entry,
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    architecture: lambda.Architecture.ARM_64, // Graviton — ~20% más barato
    memorySize: props.memorySize ?? config.lambda.memoryMb,
    timeout: props.timeout ?? cdk.Duration.seconds(config.lambda.timeoutSeconds),
    reservedConcurrentExecutions: config.lambda.reservedConcurrency,
    environment: {
      NODE_OPTIONS: '--enable-source-maps',
      ENV_NAME: config.envName,
      LOG_LEVEL: config.logging.level,
      ...environment,
    },
    bundling: {
      minify: true,
      sourceMap: true,
      target: 'es2022',
      format: OutputFormat.CJS,
      externalModules: ['@aws-sdk/*'], // SDK v3 ya incluido en runtime
    },
    logRetention: mapRetentionDays(config.logging.retentionDays),
  });

  return fn;
}

function mapRetentionDays(days: number): logs.RetentionDays {
  const mapping: Record<number, logs.RetentionDays> = {
    7: logs.RetentionDays.ONE_WEEK,
    14: logs.RetentionDays.TWO_WEEKS,
    30: logs.RetentionDays.ONE_MONTH,
    60: logs.RetentionDays.TWO_MONTHS,
    90: logs.RetentionDays.THREE_MONTHS,
    180: logs.RetentionDays.SIX_MONTHS,
    365: logs.RetentionDays.ONE_YEAR,
  };
  return mapping[days] ?? logs.RetentionDays.ONE_MONTH;
}
