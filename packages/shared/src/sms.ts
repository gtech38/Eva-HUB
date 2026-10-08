export type SmsMessage = { to: string; body: string };

export interface SmsSender {
  send(msg: SmsMessage): Promise<{ providerId: string }>;
}

/**
 * Console provider: logs instead of sending. A Twilio/Telnyx adapter slots in here
 * after 10DLC registration (docs/04-plan.md, long-lead items).
 */
class ConsoleSms implements SmsSender {
  async send(msg: SmsMessage) {
    console.log(`\n📱 [sms → ${msg.to}] ${msg.body}\n`);
    return { providerId: `console-${Date.now()}` };
  }
}

let sender: SmsSender | undefined;
export function sms(): SmsSender {
  return (sender ??= new ConsoleSms());
}

/** Rough segment count. GSM-7 → 160/153, anything else (Telugu, Hindi) → UCS-2 70/67. */
export function smsSegments(body: string) {
  const gsm = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\n\r]*$/.test(body);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return body.length <= single ? 1 : Math.ceil(body.length / multi);
}
