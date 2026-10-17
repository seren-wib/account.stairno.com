export {
  MAIL_FROM,
  createMailer,
  createResendMailer,
  type MailMessage,
  type Mailer,
} from './mailer';
export { renderMail, resolveLocale, type RenderedMail } from './render';
export type { TemplateName } from './templates/types';
