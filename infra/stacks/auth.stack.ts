import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { BaseStackProps } from '../shared/stack-props';

/**
 * Auth Stack — importa el User Pool existente creado externamente.
 * No crea un nuevo Cognito, solo lo referencia para que otros stacks lo usen.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.IUserPool;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);

    const { config } = props;

    // User Pool existente en us-east-1 (creado externamente)
    const existingUserPoolId = config.envName === 'staging'
      ? 'us-east-1_jWSv0ZVCp'  // skyalert-mini-staging
      : '';  // TODO: configurar para production

    this.userPool = cognito.UserPool.fromUserPoolId(
      this,
      'ImportedUserPool',
      existingUserPoolId
    );

    // --- Outputs ---
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${config.prefix}-user-pool-id`,
    });
  }
}
