export interface TwilioSendSmsResult {
  ok: boolean;
  sid?: string;
  status?: string;
  error?: string;
}

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromPhone: string;
}

function getTwilioConfig(): TwilioConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromPhone) {
    throw new Error(
      "Missing Twilio environment variables. Expected TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER."
    );
  }

  return {
    accountSid,
    authToken,
    fromPhone,
  };
}

export function normalizeUsPhoneNumber(input: string | null | undefined): string | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (hasPlus && digits.length >= 10) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return null;
}

export function getCoachPhoneNumber(): string {
  const fromEnv = process.env.COACH_PHONE_NUMBER || "7206122979";
  const normalized = normalizeUsPhoneNumber(fromEnv);

  if (!normalized) {
    throw new Error(
      "Invalid COACH_PHONE_NUMBER. Provide a valid US number (10 digits or E.164 format)."
    );
  }

  return normalized;
}

export async function sendSmsViaTwilio(to: string, body: string): Promise<TwilioSendSmsResult> {
  const normalizedTo = normalizeUsPhoneNumber(to);
  if (!normalizedTo) {
    return {
      ok: false,
      error: `Invalid destination phone number: ${to}`,
    };
  }

  const { accountSid, authToken, fromPhone } = getTwilioConfig();
  const normalizedFrom = normalizeUsPhoneNumber(fromPhone);

  if (!normalizedFrom) {
    throw new Error("Invalid TWILIO_PHONE_NUMBER format.");
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: normalizedTo,
        From: normalizedFrom,
        Body: body,
      }),
      cache: "no-store",
    }
  );

  const payload = (await response.json()) as {
    sid?: string;
    status?: string;
    message?: string;
    code?: number;
  };

  if (!response.ok) {
    return {
      ok: false,
      error: payload.message || `Twilio API error (${response.status})`,
      status: payload.status,
    };
  }

  return {
    ok: true,
    sid: payload.sid,
    status: payload.status,
  };
}
