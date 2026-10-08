"use client";

import { useRef, useState } from "react";
import type { PhotoDTO } from "@/lib/gallery";
import { PhotoGrid, type GalleryStrings } from "./PhotoGrid";
import type { ConsentTexts } from "@/lib/consentView";
import { ConsentText } from "./ConsentText";

export type FaceStrings = {
  title: string;
  intro: string;
  consentLabel: string;
  consentLabelGuardian: string;
  consentDetail: string;
  /** Disclosure summary for the full consent text ("What you're agreeing to"). */
  consentFull: string;
  consentVersion: string;
  rememberLabel: string;
  rememberDetail: string;
  searchFor: string;
  me: string;
  takeSelfie: string;
  searching: string;
  again: string;
  noMatches: string;
  resultsTitle: string;
  familyTitle: string;
  previous: string;
  errors: Record<string, string>;
};

type Subject = { id: string; label: string };
type Result = { subject: string; photos: PhotoDTO[] };

type Props = {
  strings: FaceStrings;
  consentTexts: ConsentTexts;
  gallery: GalleryStrings;
  subjects: Subject[];
  canRemember: boolean;
  canFavorite: boolean;
  previous: { me: PhotoDTO[]; family: Array<{ guestId: string; name: string; photos: PhotoDTO[] }> };
};

export function FaceSearch({ strings: S, consentTexts, gallery, subjects, canRemember, canFavorite, previous }: Props) {
  const [subject, setSubject] = useState(subjects[0]?.id ?? "me");
  const [consent, setConsent] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("subject", subject);
      fd.append("consent", consent ? "on" : "");
      if (remember && subject === "me") fd.append("remember", "on");
      const res = await fetch("/api/face/search", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({ ok: false, reason: "unavailable" }))) as { ok: boolean; reason?: string; photos?: PhotoDTO[] };
      if (!body.ok) setError(S.errors[body.reason ?? ""] ?? S.errors.unavailable);
      else setResult({ subject, photos: body.photos ?? [] });
    } catch {
      setError(S.errors.unavailable);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const subjectLabel = subjects.find((s) => s.id === subject)?.label ?? S.me;

  return (
    <div className="space-y-10">
      <section className="card mx-auto max-w-xl p-5 sm:p-6">
        <p className="text-sm text-muted">{S.intro}</p>

        {subjects.length > 1 && (
          <label className="mt-5 block text-sm">
            <span className="mb-1 block text-muted">{S.searchFor}</span>
            <select
              value={subject}
              onChange={(e) => {
                // Consent is per subject: searching for yourself and for a child are different texts.
                setSubject(e.target.value);
                setConsent(false);
              }}
              className="input"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
          <span>
            <span className="font-medium">{subject === "me" ? S.consentLabel : S.consentLabelGuardian}</span>
            <span className="mt-1 block text-muted">{S.consentDetail}</span>
          </span>
        </label>
        <ConsentText
          key={subject === "me" ? "self" : "guardian"}
          summary={S.consentFull}
          versionLabel={S.consentVersion}
          text={subject === "me" ? consentTexts.self : consentTexts.guardian}
          testId="face-consent-text"
        />

        {canRemember && subject === "me" && (
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
            <span>
              <span className="font-medium">{S.rememberLabel}</span>
              <span className="mt-1 block text-muted">{S.rememberDetail}</span>
            </span>
          </label>
        )}
        {canRemember && subject === "me" && (
          <ConsentText summary={S.consentFull} versionLabel={S.consentVersion} text={consentTexts.profile} testId="face-profile-consent-text" />
        )}

        <div className="mt-6">
          <input ref={fileRef} id="selfie" type="file" accept="image/*" capture="user" className="sr-only" onChange={onFile} disabled={!consent || busy} />
          <label htmlFor="selfie" className={`btn w-full ${!consent || busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`} aria-disabled={!consent || busy}>
            {busy ? S.searching : result ? S.again : S.takeSelfie}
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-theme border border-line bg-bg px-4 py-3 text-sm">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section>
          <h2 className="eyebrow mb-4">
            {S.resultsTitle} · {subjectLabel}
          </h2>
          {result.photos.length === 0 ? (
            <p className="card px-5 py-8 text-center text-sm text-muted">{S.noMatches}</p>
          ) : (
            <PhotoGrid photos={result.photos} strings={gallery} canFavorite={canFavorite} />
          )}
        </section>
      )}

      {!result && previous.me.length > 0 && (
        <section>
          <h2 className="eyebrow mb-4">{S.previous}</h2>
          <PhotoGrid photos={previous.me} strings={gallery} canFavorite={canFavorite} />
        </section>
      )}

      {previous.family.some((f) => f.photos.length > 0) && (
        <section>
          <h2 className="eyebrow mb-4">{S.familyTitle}</h2>
          <div className="space-y-8">
            {previous.family
              .filter((f) => f.photos.length > 0)
              .map((f) => (
                <div key={f.guestId}>
                  <h3 className="mb-3 font-display text-xl">{f.name}</h3>
                  <PhotoGrid photos={f.photos} strings={gallery} canFavorite={canFavorite} />
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
