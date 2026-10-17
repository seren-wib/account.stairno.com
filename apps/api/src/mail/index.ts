export {
  MAIL_FROM,
  createMailer,
  createResendMailer,
  type MailMessage,
  type Mailer,
} from './mailer';
export { locales, renderMail, resolveLocale, type Locale, type RenderedMail } from './render';
export type { TemplateName } from './templates/types';
