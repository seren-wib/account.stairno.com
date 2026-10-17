import type { Locale } from '@stairno/ui/i18n';
import { en } from './en';
import { ko } from './ko';
import type { LegalDocuments } from './types';

export type { LegalDocument, LegalDocuments, LegalSection } from './types';

export const legal: Record<Locale, LegalDocuments> = { ko, en };
