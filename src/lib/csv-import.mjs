import { compactWhitespace, normalizeText } from "./normalize.mjs";

function parseCsv(csvText = "") {
  const rows = [];
  let currentField = "";
  let currentRow = [];
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentField += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      currentRow.push(currentField);
      rows.push(currentRow);
      currentField = "";
      currentRow = [];
      continue;
    }

    currentField += char;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((field) => compactWhitespace(field)));
}

function normalizeHeader(header = "") {
  return normalizeText(header).replace(/\s+/g, "_");
}

function buildRecords(csvText = "") {
  const rows = parseCsv(csvText);

  if (!rows.length) {
    return [];
  }

  const [headerRow, ...bodyRows] = rows;
  const headers = headerRow.map((header) => normalizeHeader(header));

  return bodyRows.map((row, rowIndex) => {
    const record = {
      _row: rowIndex + 2
    };

    headers.forEach((header, columnIndex) => {
      record[header] = compactWhitespace(row[columnIndex] ?? "");
    });

    return record;
  });
}

function lookup(record, aliases = []) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);

    if (record[normalizedAlias]) {
      return record[normalizedAlias];
    }
  }

  return "";
}

function splitMultiValue(value = "") {
  return compactWhitespace(value)
    .split(/[|,]/)
    .map((item) => compactWhitespace(item))
    .filter(Boolean);
}

function mapProduct(record) {
  return {
    id: lookup(record, ["id", "product_id", "product_code_id"]),
    code: lookup(record, ["product_code", "code", "sku"]),
    name: lookup(record, ["product_name", "name", "product"]),
    family: lookup(record, ["product_family", "family"]),
    supplier: lookup(record, ["supplier", "vendor"]),
    casNumber: lookup(record, ["cas_number", "cas"]),
    packageQty: lookup(record, ["package_qty", "package_quantity"]),
    uom: lookup(record, ["uom", "unit_of_measure"]),
    onOrder: lookup(record, ["on_order"]),
    onHand: lookup(record, ["on_hand"]),
    available: lookup(record, ["available"]),
    committed: lookup(record, ["committed"]),
    allocated: lookup(record, ["allocated"]),
    avgUnitCost: lookup(record, ["avg_unit_cost", "average_unit_cost"]),
    reorderPoint: lookup(record, ["reorder_point"]),
    unNumber: lookup(record, ["un_na_number", "un_number", "na_number"]),
    packingGroup: lookup(record, ["packing_group"]),
    hazardClass: lookup(record, ["hazard_class"]),
    specialDesignation: lookup(record, ["special_designation"]),
    properShippingName: lookup(record, ["proper_shipping_name"]),
    pallet: lookup(record, ["pallet"]),
    packagesPerPallet: lookup(record, ["packages_per_pallet"]),
    synonyms: splitMultiValue(lookup(record, ["synonyms", "aliases"])),
    raw: record
  };
}

function mapCustomer(record) {
  return {
    id: lookup(record, ["id", "customer_id"]),
    name: lookup(record, ["name", "customer", "customer_name", "company"]),
    email: lookup(record, ["email", "emails"]),
    website: lookup(record, ["website", "url"]),
    phone: lookup(record, ["phone", "phone_number", "contact_information"]),
    status: lookup(record, ["status"]),
    defaultSalesPerson: lookup(record, ["default_sales_person", "sales_person"]),
    defaultCsr: lookup(record, ["default_csr", "csr"]),
    creditLimit: lookup(record, ["credit_limit"]),
    tags: splitMultiValue(lookup(record, ["tags"])),
    raw: record
  };
}

function mapContact(record) {
  return {
    id: lookup(record, ["id", "contact_id"]),
    name: lookup(record, ["name", "contact_name"]),
    companyName: lookup(record, ["company", "customer", "customer_name", "supplier"]),
    title: lookup(record, ["role_title", "role", "title"]),
    email: lookup(record, ["email"]),
    officePhone: lookup(record, ["phone", "office_number", "office_phone"]),
    mobilePhone: lookup(record, ["mobile_number", "mobile_phone"]),
    faxPhone: lookup(record, ["fax_number", "fax_phone"]),
    companyType: lookup(record, ["company_type", "relationship_type", "type"]),
    documentTypes: splitMultiValue(lookup(record, ["document_types"])),
    tags: splitMultiValue(lookup(record, ["tags"])),
    raw: record
  };
}

function mapLocation(record) {
  return {
    id: lookup(record, ["id", "address_id", "location_id"]),
    name: lookup(record, ["name", "location_name"]),
    customerName: lookup(record, ["customer", "customer_name", "company"]),
    type: lookup(record, ["type", "address_type"]),
    email: lookup(record, ["email"]),
    phone: lookup(record, ["phone", "phone_number"]),
    street1: lookup(record, ["street_address", "address", "street_1"]),
    street2: lookup(record, ["street_address_2", "address_2", "street_2"]),
    city: lookup(record, ["city"]),
    state: lookup(record, ["state", "state_region", "region"]),
    zip: lookup(record, ["zip", "postal_code"]),
    country: lookup(record, ["country"]),
    shippingInstructions: lookup(record, [
      "default_shipping_instructions_for_orders",
      "shipping_instructions"
    ]),
    raw: record
  };
}

export function inferEntityType(fileName = "", headers = []) {
  const normalizedFileName = normalizeText(fileName);
  const haystack = `${normalizedFileName} ${headers.join(" ")}`.toLowerCase();

  if (/\bcustomers?\b/.test(normalizedFileName)) {
    return "customers";
  }

  if (/\bcontacts?\b/.test(normalizedFileName)) {
    return "contacts";
  }

  if (haystack.includes("customer")) {
    return "customers";
  }

  if (haystack.includes("contact")) {
    return "contacts";
  }

  if (haystack.includes("address") || haystack.includes("location")) {
    return "locations";
  }

  return "products";
}

export function importCsv({ csvText = "", entityType = "", fileName = "" }) {
  const rows = buildRecords(csvText);
  const headers = rows[0] ? Object.keys(rows[0]).filter((key) => key !== "_row") : [];
  const resolvedType = entityType || inferEntityType(fileName, headers);

  const mapper =
    resolvedType === "customers"
      ? mapCustomer
      : resolvedType === "contacts"
        ? mapContact
        : resolvedType === "locations"
          ? mapLocation
          : mapProduct;

  return {
    entityType: resolvedType,
    rowCount: rows.length,
    headers,
    records: rows.map(mapper)
  };
}
