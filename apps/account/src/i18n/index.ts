import { type Locale } from '@stairno/ui/i18n';
import { en } from './en';
import { ko } from './ko';
import type { Dictionary } from './types';

export type { Dictionary } from './types';

// Locale list and path rules come from @stairno/ui, like on the hub; the words live here.
export {
  alternateLocale,
  defaultLocale,
  isLocale,
  localePath,
  locales,
  type Locale,
} from '@stairno/ui/i18n';

const dictionaries: Record<Locale, Dictionary> = { ko, en };

export function t(locale: Locale): Dictionary {
  return dictionaries[locale];
}
