/**
 * Authenticated encryption for server island props.
 *
 * Props are **encrypted** (confidentiality + integrity) via the shared
 * `payloadCrypto` module — the token on the wire is opaque ciphertext, not
 * readable JSON. The secret key and compression setting come from the shared
 * Mochi config (initialized by `Mochi.serve()`).
 *
 * The component name is bound as **AAD** — the only request-identifying part
 * of the island URL (`/_mochi/island/<componentName>?props=…`). This prevents
 * replaying a props token sealed for one component against a different one.
 */
import { parse as devalParse } from 'devalue';
import { getMochiConfig } from './mochiConfig';
import { requestContext } from './requestContext';
import { encryptPayload, decryptPayload } from './payloadCrypto';

export function encryptProps(propsJson: string, componentName: string): string {
  const { options } = getMochiConfig();
  const token = encryptPayload(propsJson, { aad: componentName, compress: options.compressServerIslandProps ?? true });

  // Encrypted props are opaque on the wire, so the client can't decode them for
  // the debug bar. Record the decoded snapshot keyed by the token the client
  // will see in the island's `signed-props` attribute. Best-effort — ignore
  // failures (e.g. invalid devalue JSON) so encryption never depends on it.
  try {
    const ctx = requestContext.getStore();
    if (ctx?.debugBarData?.serverProps) {
      ctx.debugBarData.serverProps[token] = JSON.stringify(devalParse(propsJson), null, 2);
    }
  } catch {
    // Debug recording is best-effort; ignore failures.
  }

  return token;
}

export function decryptProps(token: string, componentName: string): string | null {
  return decryptPayload(token, { aad: componentName });
}
