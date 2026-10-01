/**
 * Plain-language names and groupings for the engine's entity types.
 *
 * The raw tags (PERSON, EMAIL_ADDRESS, …) stay visible wherever they are
 * what actually gets written into the document — the replacement token —
 * but every label a reviewer reads uses these names instead.
 */

export interface EntityGroup {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly types: readonly string[]
}

/**
 * Entity types the bundled engine can detect, grouped the way a lawyer
 * thinks about them. Order is the order Settings shows them in.
 */
export const ENTITY_GROUPS: readonly EntityGroup[] = [
  {
    id: 'people',
    label: 'People',
    hint: 'Names of individuals, and nationality, religious or political groups.',
    types: ['PERSON', 'NRP'],
  },
  {
    id: 'organizations',
    label: 'Organizations',
    hint: 'Companies, firms, agencies and institutions.',
    types: ['ORGANIZATION'],
  },
  {
    id: 'places',
    label: 'Places and addresses',
    hint: 'Street addresses, cities, regions and countries.',
    types: ['LOCATION'],
  },
  {
    id: 'dates',
    label: 'Dates and times',
    hint: 'Calendar dates, times and durations.',
    types: ['DATE_TIME'],
  },
  {
    id: 'contact',
    label: 'Contact details',
    hint: 'Email addresses, phone numbers, web and network addresses.',
    types: ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'URL', 'IP_ADDRESS', 'MAC_ADDRESS'],
  },
  {
    id: 'financial',
    label: 'Financial',
    hint: 'Bank accounts, IBANs, card numbers and crypto wallets.',
    types: ['IBAN_CODE', 'US_BANK_NUMBER', 'CREDIT_CARD', 'CRYPTO'],
  },
  {
    id: 'ids',
    label: 'Government and medical IDs',
    hint: 'Social security, tax, passport, licence and health numbers.',
    types: ['US_SSN', 'US_ITIN', 'US_PASSPORT', 'US_DRIVER_LICENSE', 'UK_NHS', 'MEDICAL_LICENSE'],
  },
]

export const ALL_ENTITY_TYPES: readonly string[] = ENTITY_GROUPS.flatMap((g) => g.types)

const LABELS: Record<string, string> = {
  PERSON: 'Person',
  NRP: 'Group affiliation',
  ORGANIZATION: 'Organization',
  LOCATION: 'Place',
  DATE_TIME: 'Date',
  EMAIL_ADDRESS: 'Email',
  PHONE_NUMBER: 'Phone',
  URL: 'Web address',
  IP_ADDRESS: 'IP address',
  MAC_ADDRESS: 'MAC address',
  IBAN_CODE: 'IBAN',
  US_BANK_NUMBER: 'Bank account',
  CREDIT_CARD: 'Card number',
  CRYPTO: 'Crypto wallet',
  US_SSN: 'SSN',
  US_ITIN: 'ITIN',
  US_PASSPORT: 'Passport',
  US_DRIVER_LICENSE: 'Driver licence',
  UK_NHS: 'NHS number',
  MEDICAL_LICENSE: 'Medical licence',
  USER_ADDED: 'Marked by you',
}

/** Human label for an entity tag; unknown tags are title-cased. */
export function entityLabel(type: string): string {
  const known = LABELS[type]
  if (known !== undefined) return known
  const words = type.toLowerCase().split('_')
  const joined = words.join(' ')
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}
