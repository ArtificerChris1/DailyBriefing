import { buildKeyring } from "@/lib/server/vault";

/**
 * `/keyring.json`: the data key, wrapped by the password and by each
 * registered passkey. Safe to publish; see lib/vault-format.ts.
 */
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  return Response.json(await buildKeyring());
}
