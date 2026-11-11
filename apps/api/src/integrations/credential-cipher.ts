import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const algorithm = "aes-256-gcm";
const keyByteLength = 32;
const ivByteLength = 12;
const payloadVersion = "v1";

export type CredentialCipher = {
  encrypt: (plaintext: string) => string;
  decrypt: (payload: string) => string;
};

export class CredentialDecryptError extends Error {
  constructor() {
    super("Stored integration credentials could not be decrypted");
    this.name = "CredentialDecryptError";
  }
}

export const createCredentialCipher = (key: Buffer): CredentialCipher => {
  if (key.byteLength !== keyByteLength) {
    throw new Error(`Credential key must be ${keyByteLength} bytes`);
  }

  return {
    encrypt: (plaintext) => {
      const iv = randomBytes(ivByteLength);
      const cipher = createCipheriv(algorithm, key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

      return [
        payloadVersion,
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".");
    },
    decrypt: (payload) => {
      const [version, iv, authTag, ciphertext] = payload.split(".");

      if (version !== payloadVersion || !iv || !authTag || ciphertext === undefined) {
        throw new CredentialDecryptError();
      }

      try {
        const decipher = createDecipheriv(algorithm, key, Buffer.from(iv, "base64url"));
        decipher.setAuthTag(Buffer.from(authTag, "base64url"));

        return Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new CredentialDecryptError();
      }
    },
  };
};

export const credentialKeyPath = (dataDir: string): string =>
  join(dataDir, "secrets", "credentials.key");

/** Loads the credential key from the data directory, generating it with owner-only permissions on first use. */
export const loadOrCreateCredentialCipher = async (dataDir: string): Promise<CredentialCipher> => {
  const keyPath = credentialKeyPath(dataDir);

  try {
    return createCredentialCipher(Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const key = randomBytes(keyByteLength);
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });

  try {
    await writeFile(keyPath, `${key.toString("base64")}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return loadOrCreateCredentialCipher(dataDir);
    }

    throw error;
  }

  return createCredentialCipher(key);
};
