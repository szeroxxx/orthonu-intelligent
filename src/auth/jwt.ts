import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config/index.js';
import { UnauthorizedError } from '../lib/errors.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);
const ALGORITHM = 'HS256';
const EXPIRY = '8h';

export interface OverlayJwtPayload {
  sub: string;        // clinicId
  clinicId: string;
  iat: number;
  exp: number;
}

export async function signOverlayToken(clinicId: string): Promise<string> {
  return new SignJWT({ clinicId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(clinicId)
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(secret);
}

export async function verifyOverlayToken(token: string): Promise<OverlayJwtPayload> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALGORITHM] });
    return payload as unknown as OverlayJwtPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}
