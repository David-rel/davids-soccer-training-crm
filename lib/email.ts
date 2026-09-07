import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    const user = process.env.GMAIL_USER_GROUPS;
    const pass = process.env.GMAIL_PASS_GROUPS;
    if (!user || !pass) throw new Error('GMAIL_USER_GROUPS and GMAIL_PASS_GROUPS must be set');
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }
  return transporter;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  /** Plain-text alternative, for clients that don't render HTML. */
  text?: string;
  /**
   * A calendar invite to ride along with the message. Mail clients surface it
   * as "add to calendar" / RSVP rather than as a file to download.
   */
  icalEvent?: { filename: string; method: string; content: string };
}

export async function sendEmail(opts: SendEmailOptions) {
  const user = process.env.GMAIL_USER_GROUPS;
  if (!user) throw new Error('GMAIL_USER_GROUPS is not set');
  await getTransporter().sendMail({
    from: `"David's Soccer Training" <${user}>`,
    to: Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    replyTo: opts.replyTo ?? user,
    icalEvent: opts.icalEvent,
  });
}
