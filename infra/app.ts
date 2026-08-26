#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { getConfig } from './config';
import { DatabaseStack } from './stacks/database.stack';
import { AuthStack } from './stacks/auth.stack';
import { ApiStack } from './stacks/api.stack';
import { PipelineStack } from './stacks/pipeline.stack';

const app = new cdk.App();

// Leer ambiente del contexto CDK (--context env=staging|production)
const envName = app.node.tryGetContext('env');

if (!envName) {
  throw new Error(
    'Environment not specified. Use: cdk deploy --context env=staging|production'
  );
}

const config = getConfig(envName);

const envProps: cdk.Environment = {
  account: config.account || process.env.CDK_DEFAULT_ACCOUNT,
  region: config.region,
};

/**
 * Pipeline Stack — se deploya una sola vez manualmente.
 * Después se auto-actualiza con cada push a la rama staging.
 */
new PipelineStack(app, 'skyalert-mini-pipeline-stack', {
  env: envProps,
});

/**
 * Stacks individuales — para deploy manual cuando sea necesario
 * (útil para desarrollo local o emergencias).
 */
const databaseStack = new DatabaseStack(app, `${config.prefix}-database`, {
  env: envProps,
  config,
});

const authStack = new AuthStack(app, `${config.prefix}-auth`, {
  env: envProps,
  config,
});

new ApiStack(app, `${config.prefix}-api`, {
  env: envProps,
  config,
  tables: databaseStack.tables,
  userPool: authStack.userPool,
});

// Aplicar tags globales a todos los recursos del ambiente
Object.entries(config.tags).forEach(([key, value]) => {
  cdk.Tags.of(app).add(key, value);
});

app.synth();
