/**
 * Cálculo DERIVADO (en lectura) del estado de conectividad de un device,
 * replicando la lógica del servidor GPS. No persiste nada ni escribe en DynamoDB:
 * se calcula a partir de campos que la tabla gps-tracker-devices ya tiene.
 *
 * Reglas (umbrales idénticos a los del servidor: 120s y 300s):
 *   seconds_ago = now - last_seen_at
 *   - connection_status == "offline"  O  last_seen_at ausente/inválido → "disconnected"
 *   - seconds_ago <  120  → "active"
 *   - seconds_ago <  300  → "idle"
 *   - seconds_ago >= 300  → "stale"
 *
 * Caveat conocido: `last_seen_at` solo se actualiza con posiciones (STT ~cada 60s),
 * no con keep-alives (ALV). Un GPS que solo manda ALV podría verse "idle/stale"
 * aunque el socket siga conectado. Desfase aceptable (~1-2 min).
 *
 * NOTA: NO se usa `status_device` como fuente de verdad (puede estar
 * desactualizado y no es conectividad). La fuente de verdad es `last_seen_at`
 * + `connection_status`.
 */

export type ConnectivityStatus = 'active' | 'idle' | 'stale' | 'disconnected';

/** Umbrales en segundos (replican el servidor GPS). */
export const ACTIVE_THRESHOLD_SECONDS = 120;
export const IDLE_THRESHOLD_SECONDS = 300;

/** Subconjunto de campos del item GPS relevantes para conectividad. */
export interface ConnectivityInput {
  /** ISO 8601 UTC, ej: "2026-10-08T17:30:09.000Z". */
  last_seen_at?: string | null;
  /** "online" | "offline" (estado del socket TCP). */
  connection_status?: string | null;
}

export interface ConnectivityResult {
  connectivity_status: ConnectivityStatus;
  /** Segundos desde la última posición; null si no hay last_seen_at válido. */
  last_seen_seconds_ago: number | null;
}

/**
 * Parsea un ISO 8601 UTC de forma segura. Devuelve el epoch ms o null si es
 * ausente/invalid. Se exige el sufijo de zona (Z u offset) para evitar que
 * un string sin zona se interprete en horario local.
 */
function parseIsoUtcMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Función pura: calcula el estado de conectividad de un device GPS.
 * `now` se inyecta para testabilidad (no usar Date.now() internamente).
 */
export function computeConnectivityStatus(
  item: ConnectivityInput,
  now: Date = new Date()
): ConnectivityResult {
  const lastSeenMs = parseIsoUtcMs(item.last_seen_at);

  // Sin last_seen_at válido → desconectado (no podemos calcular antigüedad).
  if (lastSeenMs === null) {
    return { connectivity_status: 'disconnected', last_seen_seconds_ago: null };
  }

  const secondsAgo = Math.round((now.getTime() - lastSeenMs) / 1000);

  // Socket cerrado → desconectado, independientemente de la antigüedad.
  if (item.connection_status === 'offline') {
    return { connectivity_status: 'disconnected', last_seen_seconds_ago: secondsAgo };
  }

  let status: ConnectivityStatus;
  if (secondsAgo < ACTIVE_THRESHOLD_SECONDS) {
    status = 'active';
  } else if (secondsAgo < IDLE_THRESHOLD_SECONDS) {
    status = 'idle';
  } else {
    status = 'stale';
  }

  return { connectivity_status: status, last_seen_seconds_ago: secondsAgo };
}
