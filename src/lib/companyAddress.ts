/**
 * Canonical Company Address Formatter (PRD §§ 5-7, 75, 76)
 * Single source of truth for formatting company addresses across Quotation PDF,
 * Quotation Preview, Invoice PDF, Invoice Print, Purchase, and Receipt renderers.
 */

export interface FormattedCompanyAddress {
  companyName: string;
  addressLines: string[];
  cityStatePincode: string;
  country?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  cin?: string;
  /** Complete ordered array of address lines to print directly in headers */
  headerAddressLines: string[];
  /** Combined contact details line */
  contactLine?: string;
  /** Full single-string address representation */
  fullAddressText: string;
}

export function formatCompanyAddress(
  comp?: Record<string, any> | null
): FormattedCompanyAddress {
  if (!comp) {
    return {
      companyName: "Business Entity",
      addressLines: [],
      cityStatePincode: "",
      headerAddressLines: [],
      fullAddressText: "",
    };
  }

  const companyName =
    (comp.legalName && comp.legalName.trim()) ||
    (comp.name && comp.name.trim()) ||
    "Business Entity";

  // 1. Resolve raw address lines
  const rawAddr = (comp.address || "").trim();
  const addressLines: string[] = [];
  if (rawAddr) {
    // If address contains newlines, split them cleanly
    const split = rawAddr.split(/\r?\n+/).map((l: string) => l.trim()).filter(Boolean);
    if (split.length > 0) {
      addressLines.push(...split);
    } else {
      addressLines.push(rawAddr);
    }
  }

  // 2. Resolve city, state, pincode safely
  const city = (comp.city || "").trim();
  const state = (comp.state || comp.defaultState || "").trim();
  const pincode = (comp.pincode || comp.defaultPincode || "").trim();
  const country = (comp.country || comp.defaultCountry || "").trim();

  let cityStatePincode = "";
  if (city && state && pincode) {
    cityStatePincode = `${city}, ${state} - ${pincode}`;
  } else if (city && state) {
    cityStatePincode = `${city}, ${state}`;
  } else if (city && pincode) {
    cityStatePincode = `${city} - ${pincode}`;
  } else if (state && pincode) {
    cityStatePincode = `${state} - ${pincode}`;
  } else if (city) {
    cityStatePincode = city;
  } else if (state) {
    cityStatePincode = state;
  } else if (pincode) {
    cityStatePincode = pincode;
  }

  // Append country if non-Indian or explicitly foreign
  if (country && country.toLowerCase() !== "india" && cityStatePincode) {
    cityStatePincode = `${cityStatePincode}, ${country}`;
  } else if (country && country.toLowerCase() !== "india" && !cityStatePincode) {
    cityStatePincode = country;
  }

  // 3. Resolve tax & contact numbers
  const gstin = (comp.gstin || "").trim().toUpperCase();
  const pan = (comp.pan || "").trim().toUpperCase();
  const cin = (comp.cin || "").trim().toUpperCase();
  const phone = (comp.phone || comp.mobile || comp.altPhone || comp.altMobile || "").trim();
  const email = (comp.email || "").trim();

  // 4. Assemble header lines
  const headerAddressLines: string[] = [];
  for (const line of addressLines) {
    headerAddressLines.push(line);
  }
  if (cityStatePincode) {
    // Only push if not already identical to the last address line
    if (headerAddressLines.length === 0 || headerAddressLines[headerAddressLines.length - 1] !== cityStatePincode) {
      headerAddressLines.push(cityStatePincode);
    }
  }

  // 5. Assemble contact line
  const contactParts: string[] = [];
  if (phone) contactParts.push(`Phone: ${phone}`);
  if (email) contactParts.push(`Email: ${email}`);
  if (gstin) contactParts.push(`GSTIN: ${gstin}`);
  if (pan) contactParts.push(`PAN: ${pan}`);
  const contactLine = contactParts.join(" · ");

  // 6. Full address text
  const fullAddressText = [...headerAddressLines].join("\n");

  return {
    companyName,
    addressLines,
    cityStatePincode,
    country: country || undefined,
    phone: phone || undefined,
    email: email || undefined,
    gstin: gstin || undefined,
    pan: pan || undefined,
    cin: cin || undefined,
    headerAddressLines,
    contactLine: contactLine || undefined,
    fullAddressText,
  };
}
