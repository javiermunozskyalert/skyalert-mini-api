import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as pipelines from 'aws-cdk-lib/pipelines';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import { DatabaseStack } from './database.stack';
import { AuthStack } from './auth.stack';
import { ApiStack } from './api.stack';
import { getConfig, EnvironmentConfig } from '../config';

/**
 * Pipeline Stack — self-mutating CDK Pipeline.
 * Se deploya una sola vez manualmente, luego se actualiza solo.
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'skyalert-mini-pipeline',
      crossAccountKeys: false, // Mismo account — ahorra costos de KMS ($1/mes)
      pipelineType: codepipeline.PipelineType.V2,
      synth: new pipelines.ShellStep('Synth', {
        input: pipelines.CodePipelineSource.connection(
          'javiermunozskyalert/skyalert-mini-api',
          'staging',
          {
            connectionArn:
              'arn:aws:codeconnections:us-east-1:438633446050:connection/76f90140-952c-44ec-8c40-de11fd773365',
            triggerOnPush: true,
          }
        ),
        installCommands: [
          'n 20',
          'corepack enable',
          'corepack prepare pnpm@9.15.4 --activate',
        ],
        commands: [
          'pnpm install',
          'pnpm build',
          'npx cdk synth --context env=staging',
        ],
      }),
      dockerEnabledForSynth: false,
    });

    // --- Stage: Deploy Staging ---
    const stagingConfig = getConfig('staging');
    pipeline.addStage(new SkyAlertStage(this, 'Staging', {
      config: stagingConfig,
      env: {
        account: stagingConfig.account,
        region: stagingConfig.region,
      },
    }));
  }
}

/**
 * Stage que agrupa todos los stacks de un ambiente.
 * Permite reutilizar para staging y production.
 */
interface SkyAlertStageProps extends cdk.StageProps {
  config: EnvironmentConfig;
}

class SkyAlertStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props: SkyAlertStageProps) {
    super(scope, id, props);

    const { config } = props;

    const databaseStack = new DatabaseStack(this, `${config.prefix}-database`, {
      config,
    });

    const authStack = new AuthStack(this, `${config.prefix}-auth`, {
      config,
    });

    new ApiStack(this, `${config.prefix}-api`, {
      config,
      tables: databaseStack.tables,
      userPool: authStack.userPool,
    });
  }
}
