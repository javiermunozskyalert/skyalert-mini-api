import * as cdk from 'aws-cdk-lib';
import { EnvironmentConfig } from '../config';

export interface BaseStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}
