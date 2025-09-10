import jwt from "jsonwebtoken";

const JWT_SECRET = Bun.env.JWT_SECRET || "dev-jwt-secret-please-change-in-production";
const JWT_EXPIRY = "24h";

export interface JWTPayload {
	userId: string;
	sessionId: string;
	iat?: number;
	exp?: number;
}

export function generateJWT(payload: { userId: string; sessionId: string }): string {
	return jwt.sign(payload, JWT_SECRET, {
		expiresIn: JWT_EXPIRY,
	});
}

export function verifyJWT(token: string): JWTPayload | null {
	try {
		const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
		return payload;
	} catch (error) {
		console.error("JWT verification failed:", error);
		return null;
	}
}

export function decodeJWT(token: string): JWTPayload | null {
	try {
		const payload = jwt.decode(token) as JWTPayload;
		return payload;
	} catch (error) {
		return null;
	}
}
