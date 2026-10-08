"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { beginUpload, completeUpload, photoStatuses } from "./actions";

type Item = { id: string; file: File; progress: number; phase: "hashing" | "uploading" | "finalizing" | "processing" | "ready" | "failed" | "duplicate"; error?: string; photoId?: string };

async function sha256Hex(file: File) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function putWithProgress(url: string, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(file);
  });
}

export function Uploader({ studioId, eventId, albumId, albumTitle, disabled }: { studioId: string; eventId: string; albumId: string | null; albumTitle: string; disabled?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const update = (id: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const run = useCallback(async (item: Item) => {
    try {
      const sha256 = await sha256Hex(item.file);
      const begin = await beginUpload({ studioId, eventId, albumId, filename: item.file.name, size: item.file.size, type: item.file.type, sha256 });
      if (!begin.ok) { update(item.id, { phase: "failed", error: begin.error }); return; }
      if (begin.duplicate) { update(item.id, { phase: "duplicate", photoId: begin.photoId, error: `Already in this event (${begin.status})` }); return; }
      update(item.id, { phase: "uploading", photoId: begin.photoId });
      try {
        await putWithProgress(begin.url, item.file, (p) => update(item.id, { progress: p }));
      } catch (e) {
        // Direct-to-bucket failed (typically CORS on local S3) → proxy through the app.
        if ((e as Error).message !== "network") throw e;
        update(item.id, { progress: 0 });
        await putWithProgress(begin.fallbackUrl, item.file, (p) => update(item.id, { progress: p }));
      }
      update(item.id, { phase: "finalizing", progress: 1 });
      const done = await completeUpload({ studioId, eventId, photoId: begin.photoId });
      if (!done.ok) { update(item.id, { phase: "failed", error: done.error }); return; }
      update(item.id, { phase: done.status === "READY" ? "ready" : "processing" });
    } catch (e) {
      update(item.id, { phase: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }, [studioId, eventId, albumId]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const fresh: Item[] = [...files].filter((f) => f.type === "image/jpeg" || f.type === "image/png").map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file, progress: 0, phase: "hashing" }));
    const rejected = [...files].length - fresh.length;
    if (rejected) setItems((xs) => [...xs, { id: `rej-${Date.now()}`, file: new File([], `${rejected} file(s) skipped`), progress: 0, phase: "failed", error: "Only JPEG/PNG" }]);
    setItems((xs) => [...xs, ...fresh]);
    // Limit concurrency to 3.
    let i = 0; const workers = Array.from({ length: Math.min(3, fresh.length) }, async () => { while (i < fresh.length) { const it = fresh[i++]; await run(it); } });
    Promise.all(workers).then(() => router.refresh());
  }, [run, router]);

  // Poll processing items every 3s.
  useEffect(() => {
    const pending = items.filter((x) => x.phase === "processing" && x.photoId);
    if (pending.length === 0) return;
    const h = setInterval(async () => {
      const map = await photoStatuses({ studioId, eventId, photoIds: pending.map((x) => x.photoId!) });
      let changed = false;
      setItems((xs) => xs.map((x) => { const s = x.photoId ? map[x.photoId] : undefined; if (x.phase === "processing" && (s === "READY" || s === "FAILED")) { changed = true; return { ...x, phase: s === "READY" ? "ready" : "failed", error: s === "FAILED" ? "Processing failed (see Jobs)" : undefined }; } return x; }));
      if (changed) router.refresh();
    }, 3000);
    return () => clearInterval(h);
  }, [items, studioId, eventId, router]);

  const label: Record<Item["phase"], string> = { hashing: "Checksum…", uploading: "Uploading", finalizing: "Finalizing", processing: "Processing (worker)", ready: "Ready", failed: "Failed", duplicate: "Duplicate" };
  const tone: Record<Item["phase"], string> = { hashing: "text-neutral-500", uploading: "text-blue-700", finalizing: "text-blue-700", processing: "text-amber-700", ready: "text-green-700", failed: "text-red-700", duplicate: "text-neutral-500" };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!disabled) addFiles(e.dataTransfer.files); }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`cursor-pointer rounded border-2 border-dashed px-4 py-6 text-center text-xs transition ${disabled ? "cursor-not-allowed border-neutral-200 text-neutral-400" : drag ? "border-neutral-900 bg-neutral-100" : "border-neutral-300 text-neutral-600 hover:border-neutral-500"}`}
      >
        <input ref={inputRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <div className="font-medium">Drop JPEG/PNG files here or click to choose</div>
        <div className="mt-0.5 text-neutral-500">Uploading into <b>{albumTitle}</b>. Files go straight to the bucket; a PROCESS_PHOTO job builds thumbnails and watermarks. Duplicates are detected by checksum.</div>
      </div>
      {items.length > 0 && (
        <ul className="mt-3 max-h-64 space-y-1 overflow-auto text-xs">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2">
              <span className="w-56 truncate" title={it.file.name}>{it.file.name}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded bg-neutral-200"><span className={`block h-full ${it.phase === "failed" ? "bg-red-500" : it.phase === "ready" ? "bg-green-600" : "bg-neutral-800"}`} style={{ width: `${Math.round((it.phase === "hashing" ? 0.05 : it.phase === "uploading" ? it.progress * 0.9 : 1) * 100)}%` }} /></span>
              <span className={`w-40 ${tone[it.phase]}`}>{label[it.phase]}{it.phase === "uploading" ? ` ${Math.round(it.progress * 100)}%` : ""}{it.error ? ` — ${it.error}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
