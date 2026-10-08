"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { browserDb } from "@/lib/supabase/browser";
import { analyzeReport, confirmReport, prepareUpload } from "../../actions";

/** Reduz a foto no próprio celular: envio rápido mesmo em 4G, sem perder a leitura dos números. */
async function shrink(file: File): Promise<{ blob: Blob; ext: string }> {
  const fallbackExt = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    if (blob) return { blob, ext: "jpg" };
  } catch {
    // navegador sem suporte: envia o arquivo original
  }
  return { blob: file, ext: fallbackExt };
}

export function UploadPrints({ matchId, resend }: { matchId: string; resend: boolean }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<"idle" | "upload" | "ai">("idle");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!resend);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    // copia os arquivos AGORA: o campo é limpo logo depois e a FileList esvazia junto
    const picked = Array.from(list);
    setError(null);
    setFiles((cur) => [...cur, ...picked].slice(0, 4));
  };

  const send = async () => {
    setError(null);
    try {
      setStep("upload");
      const prepared = await Promise.all(files.map(shrink));
      const prep = await prepareUpload(matchId, prepared.map((p) => p.ext));
      if (!prep.ok) throw new Error(prep.error);
      const db = browserDb();
      for (let i = 0; i < prepared.length; i++) {
        const { error: upErr } = await db.storage
          .from("prints")
          .uploadToSignedUrl(prep.uploads[i].path, prep.uploads[i].token, prepared[i].blob, {
            contentType: prepared[i].ext === "jpg" ? "image/jpeg" : `image/${prepared[i].ext}`,
          });
        if (upErr) throw new Error("O envio de uma imagem falhou. Confira a conexão e tente de novo.");
      }
      setStep("ai");
      const res = await analyzeReport(matchId, prep.uploads.map((u) => u.path));
      if (!res.ok) throw new Error(res.error);
      setFiles([]);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Algo deu errado. Tente de novo.");
    } finally {
      setStep("idle");
    }
  };

  if (!open) {
    return (
      <button className="btn btn-ghost mt-4 w-full" onClick={() => setOpen(true)}>
        Enviar outras prints
      </button>
    );
  }

  const busy = step !== "idle";
  return (
    <section className="panel mt-5 p-4">
      <h2 className="text-2xl">{resend ? "Enviar outras prints" : "Reportar resultado"}</h2>
      <p className="mt-1 text-sm text-muted">
        Envie as duas prints da partida, em qualquer ordem: a tela de resultado (vitória ou colocação) e o placar
        completo do esquadrão, com a coluna Baixas visível.
      </p>

      <input ref={gallery} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />

      {files.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative overflow-hidden rounded border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(f)} alt={`Print ${i + 1}`} className="aspect-video w-full object-cover" />
              {!busy && (
                <button
                  className="absolute right-1 top-1 rounded bg-base/90 px-2 py-1 text-xs"
                  onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                >
                  Remover
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!busy && files.length < 4 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="btn btn-ghost" onClick={() => gallery.current?.click()}>Galeria ou arquivos</button>
          <button className="btn btn-ghost" onClick={() => camera.current?.click()}>Tirar foto</button>
        </div>
      )}

      {files.length === 1 && !busy && (
        <p className="mt-3 text-sm text-amber">Falta a segunda print. Com uma só, o report vai para conferência manual.</p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-win">{error}</p>}

      <button className="btn mt-4 w-full" disabled={busy || files.length === 0} onClick={send}>
        {step === "upload" ? "Enviando as prints…" : step === "ai" ? "Lendo as prints…" : "Enviar prints"}
      </button>
      {step === "ai" && <p className="mt-2 text-center text-xs text-muted">A leitura leva de 10 a 30 segundos. Não feche esta tela.</p>}
    </section>
  );
}

export function ConfirmButtons({ matchId, needsReview, manual = false }: { matchId: string; needsReview: boolean; manual?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (dispute: boolean) => {
    setBusy(true);
    setError(null);
    const res = await confirmReport(matchId, dispute, note);
    if (!res.ok) setError(res.error);
    else router.refresh();
    setBusy(false);
  };

  return (
    <div className="mt-5 border-t border-line pt-4">
      {disputing ? (
        <>
          <label className="label" htmlFor="note">O que está errado na leitura?</label>
          <textarea
            id="note" className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Ex.: o Coronel fez 6 baixas, não 4."
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn btn-ghost" disabled={busy} onClick={() => setDisputing(false)}>Voltar</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => submit(true)}>
              {busy ? "Enviando…" : "Informar divergência"}
            </button>
          </div>
        </>
      ) : (
        <div className={`grid gap-2 ${manual ? "" : "sm:grid-cols-2"}`}>
          <button className="btn" disabled={busy} onClick={() => submit(false)}>
            {busy ? "Enviando…" : manual ? "Enviar para o administrador" : needsReview ? "Enviar para conferência" : "Confirmar report"}
          </button>
          {!manual && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => setDisputing(true)}>
              Informar divergência
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-win">{error}</p>}
    </div>
  );
}
