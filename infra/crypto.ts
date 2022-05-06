
// @ts-nocheck

import * as forge from 'node-forge';

// Keys are in OpenSSH format
export class KeyPair {
  public: string;
  private: string;
}

// Generates an RSA keypair using forge
export function generateKeyPair(): Promise<KeyPair> {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({bits: 4096, workers: -1}, (forgeError, keypair) => {
      if (forgeError) {
        reject(new Error(`Failed to generate SSH key: ${forgeError}`));
      }
      // trim() the string because forge adds a trailing space to
      // public keys which really messes things up later.
      // 
      resolve({
        public: forge.ssh.publicKeyToOpenSSH(keypair.publicKey, '').trim(),
        private: forge.ssh.privateKeyToOpenSSH(keypair.privateKey, '').trim(),
      });
    });
  });
}
