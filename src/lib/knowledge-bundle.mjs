import { dedupeObjects, extractDomain, safeArray, uniqueStrings, compactWhitespace } from "./normalize.mjs";
import { deriveNotebookEntityAliases, normalizeNotebookIntelligence } from "./notebook-intelligence.mjs";

function normalizeEntity(entity = {}) {
  return Object.fromEntries(
    Object.entries(entity).map(([key, value]) => {
      if (typeof value === "string") {
        return [key, compactWhitespace(value)];
      }

      if (Array.isArray(value)) {
        return [key, value.map((item) => (typeof item === "string" ? compactWhitespace(item) : item))];
      }

      return [key, value];
    })
  );
}

function deriveCustomerDomains(customers = []) {
  return uniqueStrings(
    customers.flatMap((customer) => [extractDomain(customer.website), extractDomain(customer.email)]).filter(Boolean)
  );
}

function isRelationshipType(entity = {}, type = "") {
  return compactWhitespace(entity.companyType || entity.type || entity.raw?.company_type).toLowerCase() === type;
}

function deriveContactEmails(contacts = [], predicate = () => true) {
  return uniqueStrings(contacts.filter(predicate).map((contact) => contact.email).filter(Boolean));
}

function deriveContactDomains(contacts = [], predicate = () => true) {
  return uniqueStrings(
    contacts
      .filter(predicate)
      .map((contact) => extractDomain(contact.email))
      .filter(Boolean)
  );
}

function deriveUnambiguousRelationshipDomains(contacts = [], type = "") {
  const domainRelationships = new Map();

  for (const contact of contacts) {
    const domain = extractDomain(contact.email);

    if (!domain) {
      continue;
    }

    const relationship = isRelationshipType(contact, "customer")
      ? "customer"
      : isRelationshipType(contact, "supplier")
        ? "supplier"
        : "";

    if (!relationship) {
      continue;
    }

    if (!domainRelationships.has(domain)) {
      domainRelationships.set(domain, new Set());
    }

    domainRelationships.get(domain).add(relationship);
  }

  return uniqueStrings(
    [...domainRelationships.entries()]
      .filter(([, relationships]) => relationships.size === 1 && relationships.has(type))
      .map(([domain]) => domain)
  );
}

function deriveSupplierNames(products = [], suppliers = [], contacts = []) {
  return uniqueStrings([
    ...suppliers.map((supplier) => supplier.name),
    ...products.map((product) => product.supplier),
    ...contacts.filter((contact) => isRelationshipType(contact, "supplier")).map((contact) => contact.companyName)
  ]);
}

function deriveProductAliases(products = []) {
  const aliases = [];

  for (const product of products) {
    aliases.push(product.code, product.name);

    for (const synonym of safeArray(product.synonyms)) {
      aliases.push(synonym);
    }
  }

  return uniqueStrings(aliases.filter(Boolean));
}

function deriveVendorNames(opsVendors = []) {
  return uniqueStrings(opsVendors.map((vendor) => vendor.name));
}

function deriveVendorDomains(opsVendors = []) {
  return uniqueStrings(opsVendors.map((vendor) => extractDomain(vendor.domain || vendor.email)).filter(Boolean));
}

function buildCustomerMap(customers = []) {
  const map = {};

  for (const customer of customers) {
    const name = compactWhitespace(customer.name);
    const domain = extractDomain(customer.website || customer.email);

    if (name) {
      map[name.toLowerCase()] = name;
    }

    if (domain) {
      map[domain] = name || domain;
    }
  }

  return map;
}

function buildLookupMaps({ customers, contacts, products, suppliers, opsVendors, internalUsers, internalDomains, notebookIntelligence }) {
  const customerDomains = uniqueStrings([
    ...deriveCustomerDomains(customers),
    ...deriveUnambiguousRelationshipDomains(contacts, "customer")
  ]);
  const supplierNames = deriveSupplierNames(products, suppliers, contacts);
  const supplierDomains = uniqueStrings([
    ...suppliers.map((supplier) => extractDomain(supplier.domain || supplier.email)).filter(Boolean),
    ...deriveUnambiguousRelationshipDomains(contacts, "supplier")
  ]);
  const contactEmails = deriveContactEmails(contacts);
  const customerContactEmails = deriveContactEmails(contacts, (contact) => isRelationshipType(contact, "customer"));
  const supplierContactEmails = deriveContactEmails(contacts, (contact) => isRelationshipType(contact, "supplier"));
  const internalEmails = uniqueStrings(internalUsers.map((user) => user.email).filter(Boolean));
  const productAliases = deriveProductAliases(products);
  const opsVendorNames = deriveVendorNames(opsVendors);
  const opsVendorDomains = deriveVendorDomains(opsVendors);
  const notebookEntityAliases = deriveNotebookEntityAliases(notebookIntelligence);

  return {
    customerDomains,
    supplierDomains,
    supplierNames,
    contactEmails,
    customerContactEmails,
    supplierContactEmails,
    internalEmails,
    internalDomains: uniqueStrings(internalDomains),
    productAliases,
    notebookEntityAliases,
    opsVendorNames,
    opsVendorDomains
  };
}

export function createKnowledgeBundle({
  referenceData = {},
  suppliers = [],
  opsVendors = [],
  internalUsers = [],
  internalDomains = ["clear-edge.net"],
  metadata = {}
} = {}) {
  const customers = dedupeObjects(
    safeArray(referenceData.customers).map(normalizeEntity),
    (item) => item.id || item.name || JSON.stringify(item)
  );
  const contacts = dedupeObjects(
    safeArray(referenceData.contacts).map(normalizeEntity),
    (item) => item.id || item.email || item.name || JSON.stringify(item)
  );
  const products = dedupeObjects(
    safeArray(referenceData.products).map(normalizeEntity),
    (item) => item.id || item.code || item.name || JSON.stringify(item)
  );
  const locations = dedupeObjects(
    safeArray(referenceData.locations).map(normalizeEntity),
    (item) => item.id || `${item.customerName}:${item.name}:${item.street1}` || JSON.stringify(item)
  );
  const normalizedSuppliers = dedupeObjects(
    safeArray(suppliers).map(normalizeEntity),
    (item) => item.id || item.domain || item.email || item.name || JSON.stringify(item)
  );
  const normalizedOpsVendors = dedupeObjects(
    safeArray(opsVendors).map(normalizeEntity),
    (item) => item.id || item.domain || item.email || item.name || JSON.stringify(item)
  );
  const normalizedInternalUsers = dedupeObjects(
    safeArray(internalUsers).map(normalizeEntity),
    (item) => item.email || item.name || JSON.stringify(item)
  );
  const notebookIntelligence = dedupeObjects(
    normalizeNotebookIntelligence(referenceData.notebookIntelligence ?? []),
    (item) => item.id || item.entity || JSON.stringify(item)
  );

  const lookups = buildLookupMaps({
    customers,
    contacts,
    products,
    suppliers: normalizedSuppliers,
    opsVendors: normalizedOpsVendors,
    internalUsers: normalizedInternalUsers,
    internalDomains,
    notebookIntelligence
  });
  const customerMap = buildCustomerMap(customers);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    organization: metadata.organization || "ClearEdge Solutions",
    metadata,
    internalUsers: normalizedInternalUsers,
    internalDomains: lookups.internalDomains,
    customerMap,
    normalizedProducts: products,
    customers,
    contacts,
    products,
    locations,
    notebookIntelligence,
    suppliers: normalizedSuppliers,
    opsVendors: normalizedOpsVendors,
    lookups
  };
}
