import type { DeepPartial, UnitConfig } from '../api/client';

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function shallowEqualArray(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Build a deep-partial diff of `next` relative to `base`, returning only the
 * fields that changed. Arrays are compared by value and emitted whole when
 * different. Returns `{}` when nothing changed.
 */
export function diffConfig(base: Plain, next: Plain): Plain {
  const out: Plain = {};
  for (const key of Object.keys(next)) {
    const a = base[key];
    const b = next[key];

    if (isPlainObject(a) && isPlainObject(b)) {
      const nested = diffConfig(a, b);
      if (Object.keys(nested).length > 0) out[key] = nested;
    } else if (Array.isArray(a) && Array.isArray(b)) {
      if (!shallowEqualArray(a, b)) out[key] = b;
    } else if (a !== b) {
      out[key] = b;
    }
  }
  return out;
}

/** Typed wrapper used by the unit editor to PATCH only changed config fields. */
export function diffUnitConfig(
  base: UnitConfig,
  next: UnitConfig,
): DeepPartial<UnitConfig> {
  return diffConfig(
    base as unknown as Plain,
    next as unknown as Plain,
  ) as DeepPartial<UnitConfig>;
}

export function isEmptyObject(o: object): boolean {
  return Object.keys(o).length === 0;
}
