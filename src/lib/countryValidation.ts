/**
 * Country-aware Address & Postal Code Validation (PRD Addendum §§ 14-15)
 * 
 * Supports:
 * - India: Label "Pincode", 6-digit numeric validation when provided/required.
 * - Foreign Countries (e.g. UAE, US, UK): Label "Postal Code / ZIP Code",
 *   no Indian 6-digit requirement; permits alphanumeric or legitimately unavailable postal codes.
 */

export function isIndia(country?: string): boolean {
  if (!country) return true;
  const c = country.trim().toLowerCase();
  return c === "india" || c === "in" || c === "ind";
}

export function getPostalCodeLabel(country?: string): string {
  return isIndia(country) ? "Pincode" : "Postal Code / ZIP Code";
}

export function getPostalCodePlaceholder(country?: string): string {
  return isIndia(country) ? "6-digit Pincode" : "Postal / ZIP Code (optional if unavailable)";
}

export interface PostalCodeValidationResult {
  valid: boolean;
  error?: string;
  normalized?: string;
}

export function validatePostalCode(
  postalCode?: string,
  country?: string,
  options?: { required?: boolean }
): PostalCodeValidationResult {
  const code = (postalCode || "").trim();
  const india = isIndia(country);

  if (india) {
    if (!code) {
      if (options?.required) {
        return { valid: false, error: "Pincode is mandatory for Indian addresses." };
      }
      return { valid: true, normalized: "" };
    }
    // Indian PIN: exactly 6 digits, first digit non-zero (1-9)
    if (!/^[1-9][0-9]{5}$/.test(code)) {
      return {
        valid: false,
        error: "Indian Pincode must be a valid 6-digit number (e.g. 400001, 560001).",
      };
    }
    return { valid: true, normalized: code };
  }

  // Foreign Country:
  // "Do NOT impose Indian 6-digit PIN validation on foreign addresses.
  // Allow company/customer addresses where a postal code is legitimately unavailable according to the selected country/business workflow."
  if (!code) {
    return { valid: true, normalized: "" };
  }

  // Alphanumeric foreign postal code (e.g. "90210", "SW1A 1AA", "DXB")
  return { valid: true, normalized: code };
}
