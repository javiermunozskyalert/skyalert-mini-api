import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
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

    // --- Lambda Authorizer dual (web Cognito + app legacy) ---
    // Valida tanto los JWT de Cognito (Bearer, dashboard web) como los JWT HS256
    // del backend legacy (esquema "JWT", app iOS). Los usuarios de la app legacy
    // se fuerzan a rol "client" y su tenant es "legacy#<sub>".
    //
    // El secreto HS256 del legacy se replica a un SSM del propio account de
    // mini-api: /skyalert-mini-api/{envName}/jwt.secretOrKey (SecureString).
    const legacySecretParam = `/skyalert-mini-api/${config.envName}/jwt.secretOrKey`;

    const authorizerFn = createLambdaFunction(this, 'AuthorizerFunction', {
      config,
      entry: 'src/functions/authorizer/handler.ts',
      environment: {
        COGNITO_ISSUER: `https://cognito-idp.${config.region}.amazonaws.com/${userPool.userPoolId}`,
        LEGACY_ISSUER: 'api.v3.skyalert',
        LEGACY_JWT_SECRET_PARAM: legacySecretParam,
      },
    });

    // Permiso de lectura del secreto compartido del legacy (SSM SecureString).
    authorizerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${config.region}:${cdk.Stack.of(this).account}:parameter${legacySecretParam}`,
        ],
      })
    );

    const authorizer = new apigatewayv2Authorizers.HttpLambdaAuthorizer(
      'DualAuthorizer',
      authorizerFn,
      {
        responseTypes: [apigatewayv2Authorizers.HttpLambdaResponseType.SIMPLE],
        identitySource: ['$request.header.Authorization'],
        resultsCacheTtl: cdk.Duration.minutes(5),
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
        GPS_DEVICES_TABLE: 'gps-tracker-devices',
        CLIENTS_TABLE: tables.clients.tableName,
      },
    });
    tables.devices.grantReadWriteData(devicesFn);
    // Auto-provisioning de customers legacy: escribir el registro CLIENT.
    tables.clients.grantReadWriteData(devicesFn);

    // Acceso cross-project a la tabla del GPS Tracker (gps-tracker-devices).
    // Necesario para validar el device por uuid y cambiar su status al registrarlo.
    const gpsDevicesTableArn = `arn:aws:dynamodb:${config.region}:${cdk.Stack.of(this).account}:table/gps-tracker-devices`;
    devicesFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Scan', 'dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [gpsDevicesTableArn],
      })
    );

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

    // Permisos para operaciones admin de Cognito (least privilege)
    usersFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminListGroupsForUser',
          'cognito-idp:ListUsers',
        ],
        resources: [userPool.userPoolArn],
      })
    );

    // --- Lambda: Seismic ---
    const seismicFn = createLambdaFunction(this, 'SeismicFunction', {
      config,
      entry: 'src/functions/seismic/handler.ts',
      environment: {
        TABLE_NAME: tables.seismic.tableName,
        DEVICES_TABLE: tables.devices.tableName,
      },
    });
    tables.seismic.grantReadData(seismicFn);
    // Lectura sobre devices para validar acceso multi-tenant (client/collaborator)
    tables.devices.grantReadData(seismicFn);

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
    authorizer: apigatewayv2Authorizers.HttpLambdaAuthorizer,
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
