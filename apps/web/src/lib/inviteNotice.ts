/**
 * The "this link has expired" notice on the guest sign-in form. Imported by the client SignIn
 * component, so it depends on nothing but `@hub/shared/i18n`.
 */
import { ui, type Locale } from "@hub/shared/i18n";

const FLAG = "invite";
const EXPIRED = "expired";

/** Where a dead invitation link lands: the sign-in form with the expiry heading. */
export const INVITE_EXPIRED_PATH = `/?${FLAG}=${EXPIRED}`;

/** The expiry heading after a dead invitation link, else null. */
export function inviteNotice(params: Pick<URLSearchParams, "get"> | null, locale: Locale): string | null {
  return params?.get(FLAG) === EXPIRED ? ui("inviteExpired", locale) : null;
}
