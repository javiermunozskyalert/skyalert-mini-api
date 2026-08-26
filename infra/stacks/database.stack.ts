import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { BaseStackProps } from '../shared/stack-props';

export interface DynamoTables {
  clients: dynamodb.ITable;
  devices: dynamodb.ITable;
  seismic: dynamodb.ITable;
  users: dynamodb.ITable;
}

export class DatabaseStack extends cdk.Stack {
  public readonly tables: DynamoTables;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);

    const { config } = props;

    const billingMode =
      config.dynamodb.billingMode === 'PAY_PER_REQUEST'
        ? dynamodb.BillingMode.PAY_PER_REQUEST
        : dynamodb.BillingMode.PROVISIONED;

    const removalPolicy = config.dynamodb.deletionProtection
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // --- Tabla: Clients ---
    const clientsTable = new dynamodb.Table(this, 'ClientsTable', {
      tableName: `${config.prefix}-clients`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode,
      removalPolicy,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      deletionProtection: config.dynamodb.deletionProtection,
    });

    // --- Tabla: Devices ---
    const devicesTable = new dynamodb.Table(this, 'DevicesTable', {
      tableName: `${config.prefix}-devices`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode,
      removalPolicy,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      deletionProtection: config.dynamodb.deletionProtection,
    });

    // GSI para buscar dispositivos por cliente
    devicesTable.addGlobalSecondaryIndex({
      indexName: 'GSI-ClientId',
      partitionKey: { name: 'clientId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- Tabla: Seismic ---
    const seismicTable = new dynamodb.Table(this, 'SeismicTable', {
      tableName: `${config.prefix}-seismic`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode,
      removalPolicy,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      deletionProtection: config.dynamodb.deletionProtection,
    });

    // GSI para queries por rango de tiempo
    seismicTable.addGlobalSecondaryIndex({
      indexName: 'GSI-DeviceTime',
      partitionKey: { name: 'deviceId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- Tabla: Users ---
    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: `${config.prefix}-users`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode,
      removalPolicy,
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      deletionProtection: config.dynamodb.deletionProtection,
    });

    // GSI para buscar usuarios por email
    usersTable.addGlobalSecondaryIndex({
      indexName: 'GSI-Email',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.tables = {
      clients: clientsTable,
      devices: devicesTable,
      seismic: seismicTable,
      users: usersTable,
    };

    // --- Outputs ---
    new cdk.CfnOutput(this, 'ClientsTableName', {
      value: clientsTable.tableName,
      exportName: `${config.prefix}-clients-table-name`,
    });

    new cdk.CfnOutput(this, 'DevicesTableName', {
      value: devicesTable.tableName,
      exportName: `${config.prefix}-devices-table-name`,
    });
  }
}
