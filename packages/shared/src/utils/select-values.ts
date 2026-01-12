/**
 * Sentinel values for Radix Select components
 *
 * Radix Select reserves empty string ("") for clearing selection, so we use
 * sentinel values to represent "no selection" states like Unassigned, None, All, etc.
 *
 * @see https://github.com/radix-ui/primitives/issues/1569
 */

// Sentinel value constants
export const SELECT_SENTINELS = {
  UNASSIGNED: '__UNASSIGNED__',
  NONE: '__NONE__',
  ALL: '__ALL__',
  NO_SPRINT: '__NO_SPRINT__',
  NO_TASK: '__NO_TASK__',
  PERSONAL: '__PERSONAL__',
} as const

export type SelectSentinel = typeof SELECT_SENTINELS[keyof typeof SELECT_SENTINELS]

/**
 * Encode a nullable value for use with Radix Select
 * Converts null/undefined to a sentinel value that Select can handle
 *
 * @param value - The value to encode (can be null, undefined, or a string)
 * @param sentinel - The sentinel value to use when value is null/undefined
 * @returns The original value or the sentinel
 *
 * @example
 * // For an assignee select
 * <Select value={encodeNullable(assigneeId, SELECT_SENTINELS.UNASSIGNED)}>
 *   <SelectItem value={SELECT_SENTINELS.UNASSIGNED}>Unassigned</SelectItem>
 *   {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
 * </Select>
 */
export function encodeNullable(
  value: string | null | undefined,
  sentinel: SelectSentinel = SELECT_SENTINELS.NONE
): string {
  return value || sentinel
}

/**
 * Decode a Select value back to nullable form
 * Converts sentinel values back to null for API/database use
 *
 * @param value - The value from the Select component
 * @param sentinel - The sentinel value that represents null
 * @returns The original value or null if it was a sentinel
 *
 * @example
 * const handleValueChange = (v: string) => {
 *   const actualValue = decodeNullable(v, SELECT_SENTINELS.UNASSIGNED)
 *   setAssigneeId(actualValue) // null or actual UUID
 * }
 */
export function decodeNullable(
  value: string,
  sentinel: SelectSentinel = SELECT_SENTINELS.NONE
): string | null {
  return value === sentinel ? null : value
}

/**
 * Check if a value is a sentinel value
 *
 * @param value - The value to check
 * @returns true if the value is any of the known sentinel values
 */
export function isSentinel(value: string): value is SelectSentinel {
  return Object.values(SELECT_SENTINELS).includes(value as SelectSentinel)
}

/**
 * Get an appropriate placeholder value for a Select
 * Use this when you want the Select to show placeholder text (no selection)
 *
 * In Radix Select:
 * - undefined = show placeholder
 * - string value = show that value's label
 *
 * @param value - The current value
 * @param sentinel - The sentinel that represents "no selection"
 * @returns undefined (to show placeholder) or the actual value
 */
export function getSelectValue(
  value: string | null | undefined,
  sentinel: SelectSentinel
): string | undefined {
  if (!value || value === sentinel) {
    return undefined
  }
  return value
}

/**
 * Higher-order helper to create encode/decode functions for a specific sentinel
 *
 * @example
 * const { encode, decode } = createNullableHandler(SELECT_SENTINELS.UNASSIGNED)
 *
 * // In component:
 * <Select value={encode(assigneeId)} onValueChange={v => setAssigneeId(decode(v))}>
 */
export function createNullableHandler(sentinel: SelectSentinel) {
  return {
    encode: (value: string | null | undefined) => encodeNullable(value, sentinel),
    decode: (value: string) => decodeNullable(value, sentinel),
    sentinel,
  }
}

// Pre-configured handlers for common use cases
export const assigneeSelect = createNullableHandler(SELECT_SENTINELS.UNASSIGNED)
export const sprintSelect = createNullableHandler(SELECT_SENTINELS.NO_SPRINT)
export const taskSelect = createNullableHandler(SELECT_SENTINELS.NO_TASK)
export const repoSelect = createNullableHandler(SELECT_SENTINELS.ALL)
