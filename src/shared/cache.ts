import Redis from 'ioredis';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { logger } from './logger';

/**
 * Caché Redis (Redis Cloud) para optimizar respuestas.
 *
 * Diseño serverless-friendly:
 *  - El cliente se crea FUERA del handler y se reutiliza entre invocaciones
 *    calientes (una conexión por contenedor Lambda).
 *  - `lazyConnect`: no bloquea el cold start; conecta al primer uso.
 *  - Fallback seguro: si Redis no responde o falla, las operaciones NO lanzan;
 *    el caller cae a la fuente de datos real. El caché nunca rompe una request.
 */

const REDIS_URL_PARAM = process.env.REDIS_URL_PARAM ?? '/skyalert-mini-api/staging/redis.url';
/** Timeout corto para no penalizar la request si Redis está lento. */
const OP_TIMEOUT_MS = 300;

const ssm = new SSMClient({});

let clientPromise: Promise<Redis | null> | null = null;

async function resolveRedisUrl(): Promise<string | null> {
  try {
    const res = await ssm.send(
      new GetParameterCommand({ Name: REDIS_URL_PARAM, WithDecryption: true })
    );
    return res.Parameter?.Value ?? null;
  } catch (error) {
    logger.warn('Could not read Redis URL from SSM', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/** Devuelve el cliente Redis (singleton por contenedor) o null si no disponible. */
async function getClient(): Promise<Redis | null> {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const url = await resolveRedisUrl();
    if (!url) return null;

    const client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: OP_TIMEOUT_MS,
      // TLS ya viene implícito por el esquema rediss:// de la URL.
    });

    client.on('error', (err) => {
      logger.warn('Redis client error', { error: err.message });
    });

    try {
      await client.connect();
      return client;
    } catch (error) {
      logger.warn('Redis connect failed; cache disabled for this invocation', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  })();

  return clientPromise;
}

/** Ejecuta una promesa con timeout; si expira, resuelve a `fallback`. */
async function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), OP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Patrón cache-aside: devuelve el valor cacheado si existe; si no, ejecuta
 * `producer`, guarda el resultado con TTL y lo devuelve.
 *
 * Si Redis no está disponible, simplemente ejecuta `producer` (sin cachear).
 */
export async function getOrSet<T>(
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>
): Promise<T> {
  const client = await getClient();

  if (client) {
    try {
      const cached = await withTimeout(client.get(key), null);
      if (cached !== null) {
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      logger.warn('Redis GET failed; falling back to source', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const value = await producer();

  if (client && value !== undefined && value !== null) {
    // Escritura best-effort; no esperamos ni rompemos si falla.
    client
      .set(key, JSON.stringify(value), 'EX', ttlSeconds)
      .catch((error) =>
        logger.warn('Redis SET failed', {
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      );
  }

  return value;
}

/** Invalida (borra) una clave del caché. Best-effort. */
export async function invalidate(key: string): Promise<void> {
  const client = await getClient();
  if (!client) return;
  try {
    await withTimeout(client.del(key).then(() => undefined), undefined);
  } catch (error) {
    logger.warn('Redis DEL failed', {
      key,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Cierra la conexión Redis. Solo para scripts/tests o shutdown explícito.
 * En Lambda NO se llama: el cliente se reutiliza entre invocaciones calientes.
 */
export async function closeCache(): Promise<void> {
  if (!clientPromise) return;
  const client = await clientPromise;
  clientPromise = null;
  if (client) {
    client.disconnect();
  }
}
