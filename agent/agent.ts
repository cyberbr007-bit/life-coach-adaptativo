import { defineAgent } from "eve";
import { SiwcModel } from "../src/siwc.ts";
import { Vault } from "../src/credentials.ts";
import { eveSiwcModel } from "../src/eve-model.ts";

const vault = new Vault(process.env.SIWC_CREDENTIAL_FILE || './credentials/siwc.enc.json',
  process.env.SIWC_VAULT_KEY_FILE || './secrets/vault.key');
const transport = new SiwcModel(process.env.OPENAI_MODEL || '', () => vault.token());

export default defineAgent({
  model: eveSiwcModel(transport, process.env.ENABLE_EVE_SPIKE === 'yes' && process.env.SIWC_ELIGIBILITY_CONFIRMED === 'yes'),
  modelContextWindowTokens: 32000,
  tool: false,
  limits: { maxInputTokensPerSession: 16000, maxOutputTokensPerSession: 2000 },
});
