export interface CompareRow {
  name: string;
  source: string;
  target: string;
  isDifferent: boolean;
}

export interface CompareFieldSets {
  source?: Record<string, string>;
  target?: Record<string, string>;
}

/**
 * Derive the rows rendered in the compare panel's table from fetched field data.
 *
 * - Merges own and (when showStandardFields) standard fields per side.
 * - Computes the union of field names across sides, sorted alphabetically.
 * - A field missing on one side counts as different against an empty string.
 * - When showAllFields is false, filters out rows where source equals target.
 * - Returns [] when ownFields is null (initial load has not completed).
 */
export function computeCompareRows(
  ownFields: CompareFieldSets | null,
  standardFields: CompareFieldSets | null,
  showAllFields: boolean,
  showStandardFields: boolean,
): CompareRow[] {
  if (!ownFields) return [];

  const sourceMap = {
    ...(ownFields.source ?? {}),
    ...(showStandardFields ? standardFields?.source ?? {} : {}),
  };
  const targetMap = {
    ...(ownFields.target ?? {}),
    ...(showStandardFields ? standardFields?.target ?? {} : {}),
  };

  const names = new Set<string>([
    ...Object.keys(sourceMap),
    ...Object.keys(targetMap),
  ]);

  const rows: CompareRow[] = [];
  for (const name of Array.from(names).sort()) {
    const source = sourceMap[name] ?? '';
    const target = targetMap[name] ?? '';
    rows.push({ name, source, target, isDifferent: source !== target });
  }

  return showAllFields ? rows : rows.filter((r) => r.isDifferent);
}
