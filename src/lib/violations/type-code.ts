/**
 * A violation type no longer asks the person for a "code": it is made from the name (upper case, letters and digits, words joined by
 * underscores, at most 30 characters). The code stays the stable, unique identifier the database and reports use.
 */
export function deriveViolationTypeCode(name: string): string {
  const code = name
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")        // é -> e
    .toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, 30).replace(/_+$/g, "");
  return code.length >= 2 ? code : "VIOLATION_TYPE";
}
