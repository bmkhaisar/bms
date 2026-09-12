/**
 * Public and Centralized Configuration for BMS NEXT
 * Safe for client-side and server-side import.
 */

// Session Security Policy: persistent (default per client PRD), idle, strict
export type SessionSecurityPolicy = "persistent" | "idle" | "strict";
export const DEFAULT_SESSION_POLICY: SessionSecurityPolicy = "persistent";

// Maximum session age (in seconds) used only when strict session policy is explicitly enabled
export const MAX_SESSION_AGE_SECONDS = 7200;
export const MAX_SESSION_AGE_MS = MAX_SESSION_AGE_SECONDS * 1000;

// Superseded bootstrap legacy UID strictly rejected across the platform
export const SUPERSEDED_LEGACY_UID = "8Sqybhv41hhtuzcsN2JrMsnBdov2";

// Centralized brand & support configuration
export const PUBLIC_SUPPORT_EMAIL = "maazmohammed112@gmail.com";
export const PRODUCT_NAME = "BMS NEXT";
export const BRAND_ATTRIBUTION = "MMA";
export const BRAND_TAGLINE = "BMS NEXT · an MMA product";
