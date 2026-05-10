export const CUSTOMER_CONTACT_DOCUMENT_TYPES = Object.freeze([
  "AR Statement",
  "Price Quote",
  "Sales Confirmation",
  "Invoice",
  "Credit Note"
]);

export const SUPPLIER_CONTACT_DOCUMENT_TYPES = Object.freeze([
  "Purchase Orders",
  "Bills",
  "Marketing",
  "Logistics",
  "Warehouse",
  "Call Reports"
]);

export function allContactDocumentTypes(companyType = "customer") {
  return String(companyType || "").toLowerCase().includes("supplier")
    ? [...SUPPLIER_CONTACT_DOCUMENT_TYPES]
    : [...CUSTOMER_CONTACT_DOCUMENT_TYPES];
}

export function normalizeContactDocumentTypes(companyType = "customer", values = []) {
  const output = [];
  const seen = new Set();

  for (const value of [...allContactDocumentTypes(companyType), ...(Array.isArray(values) ? values : [values])]) {
    const text = String(value || "").trim();
    const key = text.toLowerCase();

    if (!text || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(text);
  }

  return output;
}
