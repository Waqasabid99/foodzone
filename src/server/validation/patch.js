import { z } from "zod";

/**
 * The body schema for a partial update, built from the create schema.
 *
 * Why not simply `createSchema.partial()`: in Zod 4 a `.default()` still fires
 * inside `.partial()`. Every field that has a create-time default is filled in
 * when a PATCH leaves it out, so `{ isDefault: true }` on a variant parses to
 * `{ name: "Regular", isDefault: true, sortOrder: 0 }` — renaming the size — and
 * `{ name }` on a branch parses to one that also sets `isActive: true`,
 * reopening a closed outlet. It also defeats the "at least one field" check,
 * because the injected defaults are fields.
 *
 * A default answers "what should a *new* record get?". On an update the only
 * correct reading of an absent field is "leave it alone", so every default is
 * stripped here, at any depth of optional/nullable wrapping, before the fields
 * are made optional. A unit test walks every update schema to keep it that way.
 */
function withoutDefault(field) {
  const def = field?._zod?.def;
  switch (def?.type) {
    case "default":
    case "prefault":
      return withoutDefault(def.innerType);
    case "optional":
      return withoutDefault(def.innerType).optional();
    case "nullable":
      return withoutDefault(def.innerType).nullable();
    default:
      return field;
  }
}

export function patchSchema(objectSchema, { message = "Provide at least one field to update" } = {}) {
  const shape = Object.fromEntries(
    Object.entries(objectSchema.shape).map(([key, field]) => [key, withoutDefault(field).optional()]),
  );
  return z.object(shape).refine((value) => Object.keys(value).length > 0, message);
}

/** The fields of `schema` that invent a value when absent. Empty for a correct update schema. */
export function injectedDefaults(schema) {
  const shape = schema?.shape ?? schema?._zod?.def?.in?.shape;
  if (!shape) return [];
  return Object.entries(shape)
    .filter(([, field]) => {
      const result = field.safeParse(undefined);
      return result.success && result.data !== undefined;
    })
    .map(([key]) => key);
}
