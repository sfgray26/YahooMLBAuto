import { prisma } from './prisma.js';

export interface ValidationPreflightOptions {
  readonly requiredTables: readonly string[];
  readonly requireRedis?: boolean;
}

export interface ValidationEnvironmentSummary {
  readonly databaseUrl: string;
  readonly databaseHost: string;
  readonly databaseName: string;
  readonly presentTables: string[];
}

function parseDatabaseUrl(databaseUrl: string): { host: string; databaseName: string } {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw new Error(
      `DATABASE_URL is not a valid URL: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return {
    host: parsed.hostname,
    databaseName: parsed.pathname.replace(/^\//, ''),
  };
}

function isRailwayInternalHost(host: string): boolean {
  return host.endsWith('.railway.internal');
}

function isRunningOnRailway(): boolean {
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
}

export async function assertValidationEnvironment(
  options: ValidationPreflightOptions
): Promise<ValidationEnvironmentSummary> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Load a reachable validation database before running DB-backed UAT.'
    );
  }

  const { host: databaseHost, databaseName } = parseDatabaseUrl(databaseUrl);

  if (isRailwayInternalHost(databaseHost) && !isRunningOnRailway()) {
    throw new Error(
      `DATABASE_URL points to Railway internal host "${databaseHost}", which is not reachable from this machine. ` +
        'Use a localhost/docker database or run the validator inside Railway.'
    );
  }

  if (options.requireRedis && !process.env.REDIS_URL) {
    throw new Error('REDIS_URL is not set. This validation path requires Redis in addition to PostgreSQL.');
  }

  let presentTables: string[];
  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    presentTables = rows.map((row) => row.table_name);
  } catch (error) {
    throw new Error(
      `Unable to inspect the configured database schema (${databaseHost}/${databaseName}): ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }

  const missingTables = options.requiredTables.filter((tableName) => !presentTables.includes(tableName));
  if (missingTables.length > 0) {
    const discoveredTables = presentTables.slice(0, 12).join(', ') || '(no public tables)';
    throw new Error(
      `Connected to "${databaseName}" on "${databaseHost}", but it does not contain the expected fantasy-baseball schema. ` +
        `Missing tables: ${missingTables.join(', ')}. Found tables: ${discoveredTables}`
    );
  }

  return {
    databaseUrl,
    databaseHost,
    databaseName,
    presentTables,
  };
}
