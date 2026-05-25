import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SECRET_PATH = join(process.cwd(), ".jwt-secret");

function getSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (existsSync(SECRET_PATH)) return readFileSync(SECRET_PATH, "utf-8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(SECRET_PATH, secret, "utf-8");
  return secret;
}

const JWT_SECRET = getSecret();

export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
