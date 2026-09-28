// ── WebAuthn Helper (FaceID / TouchID / Passkeys) ─────
import { webauthnRegisterOptions, webauthnRegisterVerify, webauthnLoginOptions, webauthnLoginVerify } from './api.js';

export function isWebAuthnSupported() {
  return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
}

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64ToBuffer(base64) {
  let str = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export async function enableBiometricAuth() {
  if (!isWebAuthnSupported()) {
    throw new Error('FaceID / TouchID stöds inte i denna webbläsare');
  }

  const options = await webauthnRegisterOptions();
  const challengeBuffer = base64ToBuffer(options.challenge);
  const userIdBuffer = Uint8Array.from(options.userId, c => c.charCodeAt(0));

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: challengeBuffer,
      rp: { name: 'Whooply' },
      user: {
        id: userIdBuffer,
        name: options.nickname,
        displayName: options.realName || options.nickname
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }  // RS256
      ],
      authenticatorSelection: {
        userVerification: 'preferred'
      },
      timeout: 60000
    }
  });

  if (!cred) throw new Error('Biometrisk registrering avbröts');

  const credentialId = bufferToBase64(cred.rawId);
  const res = await webauthnRegisterVerify(credentialId, 'device_key');
  return res;
}

export async function loginWithBiometrics() {
  if (!isWebAuthnSupported()) {
    throw new Error('FaceID / TouchID stöds inte i denna webbläsare');
  }

  const options = await webauthnLoginOptions();
  const challengeBuffer = base64ToBuffer(options.challenge);

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: challengeBuffer,
      userVerification: 'preferred',
      timeout: 60000
    }
  });

  if (!assertion) throw new Error('Inloggning med FaceID avbröts');

  const credentialId = bufferToBase64(assertion.rawId);
  const user = await webauthnLoginVerify(credentialId);
  return user;
}
