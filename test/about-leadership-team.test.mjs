import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const aboutPath = path.resolve(__dirname, "../src/routes/about.tsx");

test("About Leadership Team: file exists and can be read", () => {
  assert.ok(fs.existsSync(aboutPath), "src/routes/about.tsx must exist");
});

test("About Leadership Team: MOHAMMED_MAAZ_TITLE_UPDATED = VERIFIED", () => {
  const content = fs.readFileSync(aboutPath, "utf-8");

  assert.ok(content.includes("Mohammed Maaz A"), "Must contain exact name Mohammed Maaz A");
  assert.ok(
    content.includes("Founder · Product & Technology"),
    "Must contain exact title: Founder · Product & Technology"
  );
  assert.ok(
    content.includes("Builds and leads the BMS NEXT product, technology architecture, automation,"),
    "Must contain exact description for Mohammed Maaz A"
  );
  // Ensure legacy title is removed
  assert.ok(
    !content.includes("Co-Founder & Developer"),
    "Must not contain legacy title 'Co-Founder & Developer'"
  );
});

test("About Leadership Team: KHAISAR_HUSSAIN_TITLE_UPDATED = VERIFIED", () => {
  const content = fs.readFileSync(aboutPath, "utf-8");

  assert.ok(content.includes("Khaisar Hussain"), "Must contain exact name Khaisar Hussain");
  assert.ok(
    content.includes("Founder · Sales & Operations"),
    "Must contain exact title: Founder · Sales & Operations"
  );
  assert.ok(
    content.includes("Leads business operations, sales strategy, customer coordination,"),
    "Must contain exact description for Khaisar Hussain"
  );
  // Ensure legacy title is removed
  assert.ok(
    !content.includes("Co-Founder — Sales & Operations"),
    "Must not contain legacy title 'Co-Founder — Sales & Operations'"
  );
});

test("About Leadership Team: ARIF_RUMAN_ADDED = VERIFIED", () => {
  const content = fs.readFileSync(aboutPath, "utf-8");

  assert.ok(content.includes("Arif Ruman"), "Must contain exact name Arif Ruman");
  assert.ok(
    content.includes("Co-Founder · Technical Lead · Head of Client Acquisition & Relations"),
    "Must contain exact title: Co-Founder · Technical Lead · Head of Client Acquisition & Relations"
  );
  assert.ok(
    content.includes("Leads technical coordination, client acquisition, customer relationships,"),
    "Must contain exact description for Arif Ruman"
  );
});

test("About Leadership Team: ARIF_PLACEHOLDER_NO_FAKE_PHOTO = VERIFIED", () => {
  const content = fs.readFileSync(aboutPath, "utf-8");

  // Verify Arif card uses AR initials in rounded container
  assert.ok(content.includes(">AR<") || /\bAR\b/.test(content), "Must contain AR initials placeholder");
  assert.ok(
    !content.includes("arif.png") &&
    !content.includes("arif.jpg") &&
    !content.includes("avatar.iran.liara.run") &&
    !content.includes("unsplash") &&
    !content.includes("randomuser.me") &&
    !content.includes("pravatar"),
    "Must NOT use fake photo or random stock avatar for Arif Ruman"
  );
});

test("About Leadership Team: Order is Mohammed Maaz A, Khaisar Hussain, Arif Ruman", () => {
  const content = fs.readFileSync(aboutPath, "utf-8");

  const maazPos = content.indexOf("Mohammed Maaz A");
  const khaisarPos = content.indexOf("Khaisar Hussain");
  const arifPos = content.indexOf("Arif Ruman");

  assert.ok(maazPos !== -1, "Maaz must exist");
  assert.ok(khaisarPos !== -1, "Khaisar must exist");
  assert.ok(arifPos !== -1, "Arif must exist");

  assert.ok(maazPos < khaisarPos, "Mohammed Maaz A must precede Khaisar Hussain");
  assert.ok(khaisarPos < arifPos, "Khaisar Hussain must precede Arif Ruman");
});

test("About Leadership Team: ABOUT_RESPONSIVE = VERIFIED (Grid layout and card equality)", () => {
  const content = fs.readFileSync(aboutPath, "utf-8");

  assert.ok(
    content.includes("grid-cols-1") &&
    content.includes("md:grid-cols-2") &&
    content.includes("lg:grid-cols-3"),
    "Must support 1 col mobile, 2 cols tablet, 3 cols desktop"
  );

  assert.ok(
    content.includes("md:col-span-2") &&
    content.includes("md:max-w-md") &&
    content.includes("lg:col-span-1"),
    "Arif card must center on tablet in 2+1 layout and fit 1 col on desktop"
  );
});
