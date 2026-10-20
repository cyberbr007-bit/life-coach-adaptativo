import { readFile } from 'node:fs/promises';
export interface Config {
  databaseUrl: string; telegramUserId: string; telegramChatId: string;
  telegramToken: string; credentialFile: string; model: string;
}
export async function secret(env: NodeJS.ProcessEnv, key: string): Promise<string> {
  const file = env[key + '_FILE'];
  if (file) return (await readFile(file, 'utf8')).trim();
  return env[key]?.trim() ?? '';
}
export async function config(env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const id = env.TELEGRAM_ALLOWED_USER_ID?.trim() ?? '';
  const chat = env.TELEGRAM_PRIVATE_CHAT_ID?.trim() || id;
  if (!/^[1-9][0-9]{0,19}$/.test(id) || !/^[1-9][0-9]{0,19}$/.test(chat))
    throw new Error('CONFIG_TELEGRAM_ID_REQUIRED');
  const token = await secret(env, 'TELEGRAM_BOT_TOKEN');
  const databaseUrl = await secret(env, 'DATABASE_URL');
  if (!databaseUrl || !token) throw new Error('CONFIG_SECRETS_REQUIRED');
  return { databaseUrl, telegramUserId:id, telegramChatId:chat, telegramToken:token,
    credentialFile:env.SIWC_CREDENTIAL_FILE || './secrets/siwc.json',
    model:env.OPENAI_MODEL?.trim() ?? '' };
}

