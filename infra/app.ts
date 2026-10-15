#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { getConfig } from './config';
import { PipelineStack } from './stacks/pipeline.stack';
import { DatabaseStack } from './stacks/database.stack';

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
 * Modo standalone — despliega SOLO el DatabaseStack (tablas DynamoDB vacías),
 * sin el pipeline. Útil para crear la estructura en una cuenta nueva.
 * Uso: cdk deploy --context env=staging --context standalone=true
 */
const standalone = app.node.tryGetContext('standalone') === 'true';

if (standalone) {
  new DatabaseStack(app, `${config.prefix}-database`, {
    config,
    env: envProps,
  });
} else {
  /**
   * Pipeline Stack — se deploya una sola vez manualmente.
   * Después se auto-actualiza con cada push a la rama staging.
   * Todos los stacks de aplicación van dentro del Stage del pipeline.
   */
  new PipelineStack(app, 'skyalert-mini-pipeline-stack', {
    env: envProps,
  });
}

// Aplicar tags globales
Object.entries(config.tags).forEach(([key, value]) => {
  cdk.Tags.of(app).add(key, value);
});

app.synth();
