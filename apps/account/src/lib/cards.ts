import { CARD_COMPANY_CODES, type CardCompanyCode, type Dictionary } from '../i18n/types';

// A card as people read it: the card company in the page language and the last four digits.
// The API only ever has these two (DR-4).
export function cardLabel(
  dict: Dictionary['paymentMethods'],
  card: { cardCompany: string | null; cardLast4: string | null },
): string {
  const known = (CARD_COMPANY_CODES as readonly string[]).includes(card.cardCompany ?? '');
  const company = known ? dict.cards[card.cardCompany as CardCompanyCode] : dict.unknownCard;
  return `${company} •••• ${card.cardLast4 ?? '····'}`;
}
