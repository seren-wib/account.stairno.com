// FR-31. One shape per language: a document is a title, its effective date and numbered sections.
// Both languages are typed `LegalDocuments`, so a missing document fails `astro check`; the tests
// keep the section counts equal.
export interface LegalSection {
  heading: string;
  // Paragraphs, rendered in order.
  body: string[];
}

export interface LegalDocument {
  title: string;
  // Shown with the version (termsVersion from the contract).
  effective: string;
  sections: LegalSection[];
}

export interface LegalDocuments {
  terms: LegalDocument;
  privacy: LegalDocument;
}
