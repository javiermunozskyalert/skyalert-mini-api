import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { BaseStackProps } from '../shared/stack-props';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.IUserPool;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);

    const { config } = props;

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${config.prefix}-user-pool`,
      selfSignUpEnabled: false, // Solo admins crean usuarios
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        email: { required: true, mutable: false },
        fullname: { required: true, mutable: true },
      },
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }),
        clientId: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: config.dynamodb.deletionProtection
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // App Client para el frontend
    const appClient = userPool.addClient('WebAppClient', {
      userPoolClientName: `${config.prefix}-web-client`,
      authFlows: {
        userSrp: true, // SRP — password nunca viaja en texto plano
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    });

    this.userPool = userPool;

    // --- Outputs ---
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      exportName: `${config.prefix}-user-pool-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: appClient.userPoolClientId,
      exportName: `${config.prefix}-user-pool-client-id`,
    });
  }
}
