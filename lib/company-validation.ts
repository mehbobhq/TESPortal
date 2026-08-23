// lib/company-validation.ts

// ... (keep the levenshtein and normalizeSuffix helper functions from before) ...

export function validateCompany(newCompany: any, existingCompanies: any[]) {
  // 1. HARD BLOCKS: Business, Carrier, Tax, and Customs Identifiers
  // None of these can be shared between two companies under any circumstances.
  const strictUniqueFields = [
    // Business Information
    { key: 'incorporationNumber', label: 'Incorporation Number' },
    { key: 'businessNumber', label: 'Business Number' },
    { key: 'gstNumber', label: 'GST Number' },
    { key: 'ein', label: 'EIN' },
    // Carrier Information
    { key: 'mvidRin', label: 'MVID/RIN' },
    { key: 'nscCvor', label: 'NSC/CVOR' },
    { key: 'usDotNumber', label: 'US DOT Number' },
    { key: 'mcNumber', label: 'MC Number' },
    // Tax & Compliance Accounts
    { key: 'irpAccount', label: 'IRP Account' },
    { key: 'iftaAccount', label: 'IFTA Account' },
    { key: 'nyHut', label: 'NY HUT Account' },
    { key: 'nmWdt', label: 'NM Weight Distance Tax' },
    { key: 'kyu', label: 'Kentucky KYU' },
    { key: 'oregonAccount', label: 'Oregon Account' },
    { key: 'connecticutDrs', label: 'Connecticut DRS' },
    // Customs Information
    { key: 'scac', label: 'SCAC' },
    { key: 'carrierCode', label: 'Carrier Code' }
  ];

  for (const field of strictUniqueFields) {
    if (newCompany[field.key]) {
      const matchingEntity = existingCompanies.find(c => c[field.key] === newCompany[field.key]);
      if (matchingEntity) {
        return {
          isValid: false,
          warning: false,
          message: `CRITICAL ERROR: The ${field.label} '${newCompany[field.key]}' is already registered to '${matchingEntity.name}'. This identifier must be globally unique.`
        };
      }
    }
  }

  // 2. HARD BLOCK: Exact Name Match
  if (newCompany.name) {
    const normalizedNewName = normalizeSuffix(newCompany.name);
    if (existingCompanies.some(c => c.name.toLowerCase() === newCompany.name.toLowerCase())) {
      return {
        isValid: false,
        warning: false,
        message: "This exact company name already exists in the directory."
      };
    }

    // 3. WARNING: Fuzzy Match for Name (Catches "Inc" vs "Inc.")
    const similarCompanies = existingCompanies.filter(company => 
      levenshtein(company.name.toLowerCase(), newCompany.name.toLowerCase()) < 3 || 
      normalizeSuffix(company.name) === normalizedNewName
    );

    if (similarCompanies.length > 0) {
      const similarNames = similarCompanies.map(c => c.name).join(', ');
      return {
        isValid: true, // It's allowed, but we warn the user
        warning: true,
        message: `Potential duplicate detected. Similar companies found: ${similarNames}. Are you sure you want to add this?`
      };
    }
  }

  // 4. Note: We explicitly DO NOT check Address or Contact Info, as one person/yard can manage multiple fleets.
  return { isValid: true, warning: false, message: "Valid company details." };
}
