import { object } from "../src/protocol.js";

/** Accept npm versions that return either a one-item array or a package-keyed object. */
export function singlePackage(value: unknown, expectedName: string): Record<string, unknown> {
  let entry: unknown;
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error("Expected npm pack to return one package");
    [entry] = value;
  } else {
    const result = object(value);
    const names = Object.keys(result);
    if (names.length !== 1 || names[0] !== expectedName) {
      throw new Error(`Expected npm pack result for ${expectedName}`);
    }
    entry = result[expectedName];
  }

  const pack = object(entry);
  if (pack.name !== expectedName) throw new Error(`Expected package ${expectedName}`);
  return pack;
}
