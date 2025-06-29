import { generateKeyPairSync } from 'node:crypto';

// Utility to convert PEM private key to CryptoKey for HTTP signatures
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and decode base64
  const pemHeader = '-----BEGIN PRIVATE KEY-----';
  const pemFooter = '-----END PRIVATE KEY-----';
  const pemContents = pem.substring(pemHeader.length, pem.length - pemFooter.length);
  const binaryDer = Buffer.from(pemContents, 'base64');

  // Import as CryptoKey
  return await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
}

// Sign a request with HTTP signatures
export async function signRequest(
  request: Request,
  privateKey: CryptoKey,
  keyId: URL
): Promise<Request> {
  // For now, we'll use a simple approach
  // In a production environment, you'd want to use a proper HTTP signature library
  
  // Create a new request with the signature header
  const signedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body
  });

  // Add a placeholder signature header
  // Note: This is a simplified implementation
  // For production, use a proper HTTP signature library
  signedRequest.headers.set('Signature', `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date",signature="placeholder"`);
  signedRequest.headers.set('Date', new Date().toUTCString());

  return signedRequest;
} 