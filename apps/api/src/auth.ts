import {
  createHash,
  randomBytes,
  type ScryptOptions,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

import { accessTokenPrefix } from "@zakka/api-contract";

const scryptAsync = (
  password: string,
  salt: string,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });

const passwordHashAlgorithm = "scrypt";
const passwordHashCost = 16_384;
const passwordHashBlockSize = 8;
const passwordHashParallelization = 1;
const passwordHashKeyLength = 32;
const passwordHashMaxMemory = 64 * 1024 * 1024;

export const sessionCookieName = "scrapbook_session";
export const defaultSessionTtlMs = 1000 * 60 * 60 * 24 * 30;

export type SessionCookieParts = {
  sessionId: string;
  secret: string;
};

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString("base64url");
  const hash = (await scryptAsync(password, salt, passwordHashKeyLength, {
    N: passwordHashCost,
    r: passwordHashBlockSize,
    p: passwordHashParallelization,
    maxmem: passwordHashMaxMemory,
  })) as Buffer;

  return [
    passwordHashAlgorithm,
    String(passwordHashCost),
    String(passwordHashBlockSize),
    String(passwordHashParallelization),
    salt,
    hash.toString("base64url"),
  ].join("$");
};

export const verifyPassword = async (
  password: string,
  storedPasswordHash: string,
): Promise<boolean> => {
  const [algorithm, costValue, blockSizeValue, parallelizationValue, salt, expectedHashValue] =
    storedPasswordHash.split("$");

  if (
    algorithm !== passwordHashAlgorithm ||
    !costValue ||
    !blockSizeValue ||
    !parallelizationValue ||
    !salt ||
    !expectedHashValue
  ) {
    return false;
  }

  const cost = Number.parseInt(costValue, 10);
  const blockSize = Number.parseInt(blockSizeValue, 10);
  const parallelization = Number.parseInt(parallelizationValue, 10);

  if (
    !Number.isSafeInteger(cost) ||
    !Number.isSafeInteger(blockSize) ||
    !Number.isSafeInteger(parallelization)
  ) {
    return false;
  }

  const expectedHash = Buffer.from(expectedHashValue, "base64url");
  const actualHash = (await scryptAsync(password, salt, expectedHash.length, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: passwordHashMaxMemory,
  })) as Buffer;

  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
};

export const createSessionSecret = (): string => randomBytes(32).toString("base64url");

export const hashSessionSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("base64url");

export const accessTokenSecretPrefix = accessTokenPrefix;
const accessTokenDisplayLength = accessTokenSecretPrefix.length + 6;

export const createAccessTokenSecret = (): { secret: string; displayPrefix: string } => {
  const secret = `${accessTokenSecretPrefix}${randomBytes(32).toString("base64url")}`;

  return { secret, displayPrefix: secret.slice(0, accessTokenDisplayLength) };
};

export const hashAccessTokenSecret = (secret: string): string => hashSessionSecret(secret);

export const parseBearerAccessToken = (authorization: string | undefined): string | null => {
  const match = authorization?.match(/^Bearer\s+(\S+)\s*$/i);
  const token = match?.[1];

  return token?.startsWith(accessTokenSecretPrefix) ? token : null;
};

export const createSessionCookieValue = ({ sessionId, secret }: SessionCookieParts): string =>
  `${sessionId}.${secret}`;

export const parseSessionCookieValue = (value: string | undefined): SessionCookieParts | null => {
  if (!value) {
    return null;
  }

  const separatorIndex = value.indexOf(".");

  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null;
  }

  return {
    sessionId: value.slice(0, separatorIndex),
    secret: value.slice(separatorIndex + 1),
  };
};
