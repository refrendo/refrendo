import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Enlaces de comparticion firmados.
 *
 * El recibo de un run solo vale si se puede enseñar: a quien revisa el PR, al
 * cliente que encargo el trabajo, al auditor. Dar el token del servidor para eso
 * seria dar acceso a todo el historial, asi que cada enlace lleva su propia
 * firma y solo abre **un** run, en solo lectura y con caducidad.
 *
 * La firma cubre el identificador y el vencimiento juntos: firmarlos por
 * separado permitiria coger la firma de un run y pegarla en otro.
 */

const SEPARATOR = ".";

export interface ShareToken {
  token: string;
  expiresAt: number;
}

/**
 * Secreto de firma.
 *
 * Deriva del token del servidor cuando lo hay, para que los enlaces sobrevivan
 * a un reinicio. Sin token se genera uno al vuelo: los enlaces caducan al
 * reiniciar, que para un servidor local es el comportamiento correcto — y es
 * mejor que un secreto fijo escrito en el codigo.
 */
export function shareSecret(serverToken: string | undefined): Buffer {
  if (serverToken) return createHmac("sha256", "refrendo-share-v1").update(serverToken).digest();
  return randomBytes(32);
}

export function signShare(secret: Buffer, runId: string, ttlSeconds = 7 * 24 * 3600): ShareToken {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = sign(secret, runId, expiresAt);
  return { token: `${expiresAt}${SEPARATOR}${signature}`, expiresAt };
}

export function verifyShare(secret: Buffer, runId: string, token: string | null): boolean {
  if (!token) return false;

  const index = token.indexOf(SEPARATOR);
  if (index <= 0) return false;

  const expiresAt = Number(token.slice(0, index));
  const provided = token.slice(index + 1);
  if (!Number.isFinite(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;

  const expected = sign(secret, runId, expiresAt);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function sign(secret: Buffer, runId: string, expiresAt: number): string {
  return createHmac("sha256", secret).update(`${runId}${SEPARATOR}${expiresAt}`).digest("base64url");
}
