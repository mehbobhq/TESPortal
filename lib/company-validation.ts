// lib/company-validation.ts

// Helper to calculate spelling differences (Levenshtein distance)
function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

// Helper to normalize suffixes (Inc, LLC, Corp) for comparison
function normalizeSuffix(name: string): string {
  if (!name) return '';
  return name.replace(/\b(Inc|LLC|Corp|Ltd|Co)\.?\b/gi, '').trim().toLowerCase();
}

/**
 * Checks a new company record against existing records to prevent duplicates 
 * based on unique identifiers AND fuzzy name matching.
 */
export function checkForDuplicates(newCompany: any, existingCompanies: any[]) {
  // 1. HARD BLOCK: Check Unique Government Identifiers First
  // An IRP account, US DOT, MC, or EIN cannot legally belong to two different companies.
  const uniqueFields = [
    { key: 'irpAccount', label: 'IRP Account' },
    { key: 'usDotNumber', label: 'US DOT Number' },
    { key: 'mcNumber', label: 'MC Number' },
    { key: 'ein', label: 'EIN' }
  ];

  for (const field of uniqueFields) {
    if (newCompany[field.key]) {
      const matchingEntity = existingCompanies.find(c => c[field.key] === newCompany[field.key]);
      if (matchingEntity) {
        return {
          isDuplicate: true,
          warning: false,
          message: `Duplicate Identifier: The ${field.label} '${newCompany[field.key]}' is already registered to '${matchingEntity.name}'.`
        };
      }
    }
  }

  // 2. HARD BLOCK: Check for exact name match
  if (newCompany.name) {
    const normalizedNewName = normalizeSuffix(newCompany.name);
    
    if (existingCompanies.some(c => c.name.toLowerCase() === newCompany.name.toLowerCase())) {
      return {
        isDuplicate: true,
        warning: false,
        message: "This company name already exists. Please select it from the list."
      };
    }

    // 3. WARNING: Check for fuzzy match (Minor spelling differences or suffix changes)
    const similarCompanies = existingCompanies.filter(company => 
      levenshtein(company.name.toLowerCase(), newCompany.name.toLowerCase()) < 3 || 
      normalizeSuffix(company.name) === normalizedNewName
    );

    if (similarCompanies.length > 0) {
      const similarNames = similarCompanies.map(c => c.name).join(', ');
      return {
        isDuplicate: false,
        warning: true,
        message: `Potential duplicate detected. Similar companies found: ${similarNames}. Are you sure you want to add this as a new company?`
      };
    }
  }

  // 4. Clean pass
  return { isDuplicate: false, warning: false, message: "Valid company details." };
}
