import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { BaseStackProps } from '../shared/stack-props';
import { DynamoTables } from './database.stack';
import { createLambdaFunction } from '../shared/lambda-factory';

interface ApiStackProps extends BaseStackProps {
  tables: DynamoTables;
  userPool: cognito.IUserPool;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config, tables, userPool } = props;

    // --- HTTP API Gateway ---
    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: `${config.prefix}-api`,
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: config.envName === 'production'
          ? ['https://dashboard.skyalert.mx'] // Cambiar al dominio real
          : ['http://localhost:3000', 'https://staging.skyalert.mx'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Throttling en stage default
    const defaultStage = httpApi.defaultStage?.node.defaultChild as apigatewayv2.CfnStage;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingRateLimit: config.apiGateway.throttleRateLimit,
        throttlingBurstLimit: config.apiGateway.throttleBurstLimit,
      };
    }

    // --- Cognito JWT Authorizer ---
    const authorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${config.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: ['placeholder'], // Se reemplaza con el client ID real post-deploy
      }
    );

    // --- Lambda: Clients ---
    const clientsFn = createLambdaFunction(this, 'ClientsFunction', {
      config,
      entry: 'src/functions/clients/handler.ts',
      environment: {
        TABLE_NAME: tables.clients.tableName,
      },
    });
    tables.clients.grantReadWriteData(clientsFn);

    // --- Lambda: Devices ---
    const devicesFn = createLambdaFunction(this, 'DevicesFunction', {
      config,
      entry: 'src/functions/devices/handler.ts',
      environment: {
        TABLE_NAME: tables.devices.tableName,
      },
    });
    tables.devices.grantReadWriteData(devicesFn);

    // --- Lambda: Users ---
    const usersFn = createLambdaFunction(this, 'UsersFunction', {
      config,
      entry: 'src/functions/users/handler.ts',
      environment: {
        TABLE_NAME: tables.users.tableName,
        USER_POOL_ID: userPool.userPoolId,
      },
    });
    tables.users.grantReadWriteData(usersFn);

    // --- Lambda: Seismic ---
    const seismicFn = createLambdaFunction(this, 'SeismicFunction', {
      config,
      entry: 'src/functions/seismic/handler.ts',
      environment: {
        TABLE_NAME: tables.seismic.tableName,
      },
    });
    tables.seismic.grantReadData(seismicFn);

    // --- Routes ---
    this.addRoutes(httpApi, authorizer, '/clients', clientsFn);
    this.addRoutes(httpApi, authorizer, '/devices', devicesFn);
    this.addRoutes(httpApi, authorizer, '/users', usersFn);
    this.addRoutes(httpApi, authorizer, '/seismic', seismicFn);

    // --- Outputs ---
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      exportName: `${config.prefix}-api-url`,
    });
  }

  private addRoutes(
    httpApi: apigatewayv2.HttpApi,
    authorizer: apigatewayv2Authorizers.HttpJwtAuthorizer,
    basePath: string,
    handler: lambda.IFunction
  ): void {
    const integration = new apigatewayv2Integrations.HttpLambdaIntegration(
      `${basePath}-integration`,
      handler
    );

    httpApi.addRoutes({
      path: basePath,
      methods: [
        apigatewayv2.HttpMethod.GET,
        apigatewayv2.HttpMethod.POST,
      ],
      integration,
      authorizer,
    });

    httpApi.addRoutes({
      path: `${basePath}/{proxy+}`,
      methods: [
        apigatewayv2.HttpMethod.GET,
        apigatewayv2.HttpMethod.PUT,
        apigatewayv2.HttpMethod.DELETE,
      ],
      integration,
      authorizer,
    });
  }
}
