/**
 * Environment configuration schema (BACKEND_SPEC §12).
 *
 * `@nestjs/config` loads from environment; required keys are validated at boot.
 * Optional infra URLs are present so local startup (no services) still works.
 */
import { IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

const DEFAULT_PORT = 3000;

export class AppConfig {
  @IsInt()
  @Min(1)
  @Max(65535)
  port: number = Number(process.env.PORT ?? DEFAULT_PORT);

  @IsString()
  @IsOptional()
  databaseUrl?: string;

  @IsString()
  @IsOptional()
  redisUrl?: string;

  @IsString()
  @IsOptional()
  rabbitMqUrl?: string;

  @IsString()
  nodeEnv: string = process.env.NODE_ENV ?? 'development';
}

export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const config = plainToInstance(AppConfig, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(config, { whitelist: true });
  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');
    throw new Error(`Environment validation failed: ${messages}`);
  }
  return config;
}
