/**
 * AES-256-GCM encryption for server island props.
 *
 * Props are **encrypted** (confidentiality + integrity) via the shared
 * `payloadCrypto` module — the token on the wire is opaque ciphertext, not
 * readable JSON. The secret key and compression setting come from the shared
 * Mochi config (initialized by `Mochi.serve()`).
 */
import { parse as devalParse } from 'devalue';
import { getMochiConfig } from './mochiConfig';
import { requestContext } from './requestContext';
import { encryptPayload, decryptPayload } from './payloadCrypto';

export function encryptProps(propsJson: string): string {
  try {
    const ctx = requestContext.getStore();
    if (ctx?.debugBarData) {
      const obj = devalParse(propsJson);
      const id = obj?.islandId;
      if (id) {
        ctx.debugBarData.islandProps[id] = JSON.stringify(obj, null, 2);
      }
    }
  } catch {
    // Debug recording is best-effort; ignore failures.
  }

  const { options } = getMochiConfig();
  return encryptPayload(propsJson, { compress: options.compressServerIslandProps ?? true });
}

export function decryptProps(token: string): string | null {
  return decryptPayload(token);
}
