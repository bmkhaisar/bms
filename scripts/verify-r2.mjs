#!/usr/bin/env node

/**
 * Diagnostic Verification Script for Cloudflare R2 Storage
 * 
 * Usage:
 *   npm run verify:r2
 *   node scripts/verify-r2.mjs
 * 
 * Safely verifies bucket accessibility, write test, read/head test, and delete test.
 * STRICT SECURITY: NEVER prints secrets or private access keys.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

// 1. Read .env file from project root
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.substring(0, eqIdx).trim();
      let val = trimmed.substring(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.substring(1, val.length - 1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

const accountId = (process.env.R2_ACCOUNT_ID || "").trim();
const accessKeyId = (process.env.R2_ACCESS_KEY_ID || "").trim();
const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
const bucketName = (process.env.R2_BUCKET_NAME || "bms-next-assets").trim();

console.log("=================================================");
console.log("          BMS NEXT — CLOUDFLARE R2 VERIFICATION   ");
console.log("=================================================");

function pad(label, status) {
  const dots = ".".repeat(Math.max(2, 35 - label.length));
  console.log(`${label}${dots} ${status}`);
}

function mask(str) {
  if (!str) return "MISSING";
  if (str.length <= 6) return "***";
  return `${str.substring(0, 3)}...${str.substring(str.length - 3)}`;
}

pad("Account ID", accountId ? `PRESENT (${mask(accountId)})` : "MISSING");
pad("Access Key ID", accessKeyId ? `PRESENT (${mask(accessKeyId)})` : "MISSING");
pad("Secret Access Key", secretAccessKey ? "PRESENT (hidden)" : "MISSING");
pad("Bucket Name", bucketName || "MISSING");

const missing = [];
if (!accountId) missing.push("R2_ACCOUNT_ID");
if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
if (!bucketName) missing.push("R2_BUCKET_NAME");

if (missing.length > 0) {
  console.log("-------------------------------------------------");
  console.log("STATUS: R2_NOT_CONFIGURED");
  console.log(`Missing required environment variables: ${missing.join(", ")}`);
  console.log("Tip: Add them to your .env file or Vercel Environment Variables.");
  process.exit(0);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

async function runVerification() {
  const testKey = `_diagnostic/bms_test_${Date.now()}.txt`;
  const testPayload = `BMS NEXT verification test executed at ${new Date().toISOString()}`;

  try {
    // 1. Head Bucket Check
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucketName }));
      pad("Bucket Reachability", "VERIFIED");
    } catch (headErr) {
      pad("Bucket Reachability", `WARNING (${headErr.name || "Access Limited"})`);
    }

    // 2. Put / Write Test Object
    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: testKey,
      Body: testPayload,
      ContentType: "text/plain",
    }));
    pad("Object Write (PutObject)", "SUCCESS");

    // 3. Head / Read Test Object
    await client.send(new HeadObjectCommand({
      Bucket: bucketName,
      Key: testKey,
    }));
    pad("Object Read (HeadObject)", "SUCCESS");

    // 4. Delete Test Object
    await client.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: testKey,
    }));
    pad("Object Cleanup (DeleteObject)", "SUCCESS");

    console.log("-------------------------------------------------");
    console.log("STATUS: R2_VERIFICATION_READY");
    console.log(`Cloudflare R2 bucket '${bucketName}' is fully operable.`);
  } catch (err) {
    console.log("-------------------------------------------------");
    console.log("STATUS: R2_VERIFICATION_FAILED");
    console.error("Verification error:", err.message || err);
  }
}

runVerification();
