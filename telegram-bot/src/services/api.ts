import axios from 'axios';
import crypto from 'crypto';

const api = axios.create({
  baseURL: process.env.API_URL || 'http://backend-api:8080',
  timeout: 10000,
});

export async function resolveDomain(domain: string) {
  const { data } = await api.get(`/api/dns/resolve/${domain}`);
  return data;
}

export async function getGamingDomains() {
  const { data } = await api.get('/api/dns/gaming-domains');
  return data;
}

export async function syncToRedis() {
  const { data } = await api.post('/api/dns/sync-redis');
  return data;
}

export async function getStats() {
  const domains = await getGamingDomains();
  return {
    totalGamingDomains: domains.length,
    activeDomains: domains.filter((d: any) => d.isActive).length,
  };
}

/** Fetch bot token from the backend settings API (no auth needed for bot internal calls) */
export async function fetchBotToken(): Promise<{ token: string; isConfigured: boolean } | null> {
  try {
    const { data } = await api.get('/api/settings/bot-token', {
      headers: { 'X-Internal-Service': 'telegram-bot' }
    });
    return data;
  } catch {
    return null;
  }
}

// === Subscription / IP Registration API ===

export interface UserDto {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  isNewUser: boolean;
  activeSubscription: SubscriptionDto | null;
}

export interface SubscriptionDto {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  registeredIp: string | null;
  remainingTime: string;
  isExpired: boolean;
}

export interface SubscriptionStatusDto {
  hasActiveSubscription: boolean;
  currentSubscription: SubscriptionDto | null;
  history: SubscriptionDto[];
}

export interface RegisterIpResponse {
  success: boolean;
  message: string;
  registeredIp?: string;
}

export interface IpDetectionResponse {
  ip: string;
  country?: string;
  isRegistered: boolean;
}

export async function getOrCreateUser(telegramId: number, username?: string, firstName?: string, provisionTrial = true) {
  const { data } = await api.post('/api/subscription/get-or-create', {
    telegramId,
    username,
    firstName,
    provisionTrial,
  });
  return data as {
    user: UserDto;
    trialProvisioned: boolean;
    trial: SubscriptionDto | null;
  };
}

export async function getSubscriptionStatus(telegramId: number) {
  const { data } = await api.get('/api/subscription/status', {
    params: { telegramId },
  });
  return data as SubscriptionStatusDto;
}

export async function registerIp(telegramId: number, ipAddress: string) {
  const { data } = await api.post('/api/subscription/register-ip', {
    telegramId,
    ipAddress,
  });
  return data as RegisterIpResponse;
}

export async function detectIp() {
  const { data } = await api.get('/api/ip/detect');
  return data as IpDetectionResponse;
}

/** Generate HMAC-SHA256 signature for quick-register URL */
export function buildQuickRegisterUrl(telegramId: number): string {
  const hmacSecret = process.env.HMAC_SECRET || "RhynoDns_Secure_HMAC_Secret_Key_2026_!@#";
  const sign = crypto.createHmac("sha256", hmacSecret).update(telegramId.toString()).digest("hex");
  const baseUrl = process.env.PORTAL_PUBLIC_URL || 'https://dns.rhynoai.ir';
  return `${baseUrl}/ip?id=${telegramId}&sign=${sign}`;
}