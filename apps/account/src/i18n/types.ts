// One shape for both languages (FR-76): ko and en are typed `Dictionary`, so a key in one
// language only fails `astro check`. `{name}` in a string is replaced where it is used.
export type Dictionary = {
  meta: { title: string; description: string };
  nav: {
    overview: string;
    switchLocale: string;
    theme: { light: string; dark: string; toggle: string };
  };
  footer: { heading: string; hub: string; source: string };
  overview: { heading: string };
  notFound: { heading: string; home: string };
};
