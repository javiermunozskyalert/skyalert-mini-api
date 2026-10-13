import { logger } from './logger';

/**
 * Cliente mínimo hacia el backend legacy (legacy-clients).
 *
 * Se usa en el auto-provisioning: cuando un Customer legacy entra por primera
 * vez (login SSO validado desde este lado) y no existe aún en mini-api, se
 * consulta su perfil al legacy para guardar name/email.
 *
 * Importante (seguridad): el endpoint GET /customers/:id del legacy devuelve
 * campos sensibles (email.token, recoveryToken, googleId, etc.). Aquí SOLO se
 * extraen name.full y email.address; el resto se descarta y nunca se loguea.
 */

/** Datos públicos del customer que mini-api persiste. */
export interface LegacyCustomerProfile {
  name?: string;
  email?: string;
}

/**
 * Resultado del lookup, discriminado para que el provisioning decida la política:
 *  - 'ok'        → el legacy devolvió name/email aprovechables (`profile`).
 *  - 'no-data'   → respondió OK pero sin name ni email.
 *  - 'not-found' → el customer no existe en el legacy (HTTP 404).
 *  - 'error'     → fallo de comunicación (red, timeout, 5xx, 4xx distinto de 404,
 *                  body inválido, o config ausente).
 */
export type LegacyLookupResult =
  | { status: 'ok'; profile: LegacyCustomerProfile }
  | { status: 'no-data' }
  | { status: 'not-found' }
  | { status: 'error' };

/** Forma parcial del payload del legacy (solo lo que nos interesa). */
interface LegacyCustomerResponse {
  // Nota: el legacy NO serializa el virtual name.full. Solo llegan las partes.
  name?: { first?: string; pLast?: string; mLast?: string } | null;
  email?: { address?: string } | null;
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Construye el nombre completo a partir de las partes que sí serializa el
 * legacy (first/pLast/mLast). El virtual `name.full` no viaja en el JSON, por
 * lo que hay que concatenar aquí. Devuelve undefined si no hay ninguna parte.
 */
function buildFullName(name: LegacyCustomerResponse['name']): string | undefined {
  if (!name) return undefined;
  const full = [name.first, name.pLast, name.mLast]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .trim();
  return full || undefined;
}

/**
 * Consulta GET {LEGACY_API_URL}/customers/{sub} con el JWT crudo del customer.
 *
 * Nunca lanza: devuelve un resultado discriminado para que el llamador aplique
 * su política (p. ej. bloquear en producción ante 'not-found'/'error').
 */
export async function fetchLegacyCustomer(
  sub: string,
  rawJwt: string,
  options?: { timeoutMs?: number }
): Promise<LegacyLookupResult> {
  const baseUrl = process.env.LEGACY_API_URL;
  if (!baseUrl || !sub || !rawJwt) {
    return { status: 'error' };
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/customers/${encodeURIComponent(sub)}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `JWT ${rawJwt}` },
      signal: controller.signal,
    });

    if (res.status === 404) {
      logger.warn('Legacy customer not found', { sub });
      return { status: 'not-found' };
    }

    if (!res.ok) {
      logger.warn('Legacy customer lookup non-OK', { sub, status: res.status });
      return { status: 'error' };
    }

    const data = (await res.json()) as LegacyCustomerResponse;
    const profile: LegacyCustomerProfile = {
      name: buildFullName(data.name),
      email: data.email?.address ?? undefined,
    };

    if (!profile.name && !profile.email) {
      return { status: 'no-data' };
    }

    return { status: 'ok', profile };
  } catch (error: unknown) {
    logger.warn('Legacy customer lookup failed', {
      sub,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { status: 'error' };
  } finally {
    clearTimeout(timeout);
  }
}
