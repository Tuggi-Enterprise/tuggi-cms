/**
 * Required-field check shared by the entity form modals (Places, Events).
 *
 * WHY A LIST OF NAMES AND NOT A BOOLEAN: the modals used to answer "something is missing" with
 * one fixed sentence — "Name, city and country are required." — while the field actually missing
 * was the coordinate, which the sentence does not even mention. The operator then re-read three
 * filled inputs looking for a typo. What the caller needs back is WHICH group is empty.
 *
 * A group and not a field because latitude/longitude are one thing on screen: the map.
 */

export interface RequiredFieldGroup {
  /** Key under the modal's `labels.*` namespace — the caller translates it. */
  label: string
  /** Form keys that must all be filled for the group to count as answered. */
  keys: string[]
}

/** Identity block, identical in both modals: name, city, country and the map coordinate. */
export const IDENTITY_REQUIRED_FIELDS: RequiredFieldGroup[] = [
  { label: 'name', keys: ['name'] },
  { label: 'city', keys: ['city'] },
  { label: 'country', keys: ['country'] },
  { label: 'location', keys: ['latitude', 'longitude'] },
]

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' ||
    (typeof value === 'number' && Number.isNaN(value))
}

/** The label keys of every group with at least one empty field, in the order given. */
export function missingRequiredLabels(
  form: Record<string, any>,
  groups: RequiredFieldGroup[] = IDENTITY_REQUIRED_FIELDS,
): string[] {
  return groups.filter((group) => group.keys.some((key) => isEmpty(form[key]))).map((g) => g.label)
}
