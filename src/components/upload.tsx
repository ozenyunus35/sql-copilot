"use client";

import { AlertTriangle, CheckCircle2, FileUp, Info, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { importFiles, type Dataset } from "@/lib/engine";
import { useLang, useT } from "@/lib/i18n";
import { Button, Modal, cx } from "./ui";

export function UploadDialog({ open, onClose, onLoaded }: { open: boolean; onClose: () => void; onLoaded: (d: Dataset) => void }) {
  const t = useT();
  const { lang } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<Array<{ file: string; en: string; tr: string }>>([]);
  const [done, setDone] = useState<Dataset | null>(null);

  const take = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setBusy(true);
    setErrors([]);
    setDone(null);
    try {
      const r = await importFiles(files);
      setErrors(r.errors);
      if (r.dataset) {
        setDone(r.dataset);
        onLoaded(r.dataset);
      }
    } catch (e) {
      setErrors([{ file: files.map((f) => f.name).join(", "), en: `Reading failed: ${(e as Error).message}`, tr: `Okuma başarısız: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setErrors([]);
    setDone(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={t("uploadTitle")} footer={done ? <Button variant="primary" onClick={close}>{t("close")}</Button> : undefined}>
      <p className="mb-3 text-muted">{t("uploadText")}</p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={cx("flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors", over ? "border-accent bg-accent-soft" : "border-border-strong")}
      >
        {busy ? (
          <p className="flex items-center gap-2 text-muted" role="status">
            <Loader2 className="size-4 animate-spin" /> {t("importing")}
          </p>
        ) : (
          <>
            <FileUp className="mb-2 size-6 text-faint" aria-hidden />
            <p>
              {t("dropHere")}{" "}
              <button className="font-medium text-accent hover:underline" onClick={() => input.current?.click()}>
                {t("browse")}
              </button>
            </p>
            <p className="mt-1 text-xs text-faint">.csv · .tsv · .xlsx · .json · .sqlite · .db</p>
          </>
        )}
        <input ref={input} type="file" multiple hidden accept=".csv,.tsv,.txt,.xlsx,.xlsm,.json,.jsonl,.sqlite,.sqlite3,.db,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => take(e.target.files)} data-testid="upload-input" />
      </div>
      {errors.length > 0 && (
        <ul className="mt-3 space-y-1.5" role="alert">
          {errors.map((e, i) => (
            <li key={i} className="flex gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
              <span>{e[lang]}</span>
            </li>
          ))}
        </ul>
      )}
      {done && (
        <div className="mt-3 space-y-2 animate-enter">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            {lang === "tr" ? `${done.model.tables.length} tablo yüklendi` : `Loaded ${done.model.tables.length} table${done.model.tables.length > 1 ? "s" : ""}`}
            {done.model.relations.length > 0 && <span className="font-normal text-muted">· {done.model.relations.length} {t("relations")}</span>}
          </p>
          <ul className="space-y-1 text-muted">
            {done.model.tables.map((tb) => (
              <li key={tb.name} className="flex justify-between gap-3">
                <span className="truncate font-mono text-[12px] text-text">{tb.name}</span>
                <span className="shrink-0 tabular-nums">{t("colsAndRows", { c: tb.columns.length, r: tb.rows.toLocaleString(lang === "tr" ? "tr-TR" : "en-US") })}</span>
              </li>
            ))}
          </ul>
          {done.notes.length > 0 && (
            <ul className="space-y-1 border-t border-border pt-2 text-xs text-muted">
              {done.notes.map((n, i) => (
                <li key={i} className="flex gap-1.5">
                  {n.level === "warning" ? <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" /> : <Info className="mt-0.5 size-3 shrink-0 text-info" />}
                  {n[lang]}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
