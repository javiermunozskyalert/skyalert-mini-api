import { EnvironmentConfig, EnvironmentName } from './environment.types';
import { stagingConfig } from './staging';
import { productionConfig } from './production';

const configs: Record<EnvironmentName, EnvironmentConfig> = {
  staging: stagingConfig,
  production: productionConfig,
};

export function getConfig(envName: string): EnvironmentConfig {
  if (!isValidEnvironment(envName)) {
    throw new Error(
      `Invalid environment: "${envName}". Valid options: ${Object.keys(configs).join(', ')}`
    );
  }
  return configs[envName];
}

function isValidEnvironment(env: string): env is EnvironmentName {
  return env in configs;
}

export { EnvironmentConfig, EnvironmentName };
