import { useCallback, useEffect, useRef, useState } from "react";
import { startFaceCheck, submitFaceCheck, type FaceCheckStart } from "../api";

/** Sign-up's face check (gdb_bank.face_check): consent, the camera, a short run
 *  of prompts in a random order — look straight, turn left, turn right — one
 *  frame per prompt, and the server's verdict.
 *
 *  The browser decides nothing. It guides the person and sends the frames; the
 *  face service compares them with the photo on record, which never comes here.
 *  Frames are held only in memory until they are sent. */

const PROMPT: Record<string, string> = {
  center: "Look straight at the camera",
  left: "Slowly turn your head to your left",
  right: "Slowly turn your head to your right",
  up: "Tilt your head up a little",
  blink: "Blink slowly, two or three times",
};
// The blink is a short burst rather than one picture — a single frame almost
// never lands mid-blink.
const BURST_FRAMES = 8;
const BURST_GAP_MS = 200;
const COUNTDOWN = 3;

type Phase = "consent" | "camera" | "checking" | "failed";

export function FaceCheck({
  nationalId,
  start,
  onPassed,
  onBack,
}: {
  nationalId: string;
  start: FaceCheckStart;
  onPassed: (faceToken: string) => void;
  onBack: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [check, setCheck] = useState(start);
  const [phase, setPhase] = useState<Phase>("consent");
  const [stepAt, setStepAt] = useState(0);
  const [count, setCount] = useState(COUNTDOWN);
  const [frames, setFrames] = useState<{ step: string; image: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [left, setLeft] = useState<number | null>(start.attempts_left ?? null);
  const [giveUp, setGiveUp] = useState<string | null>(null);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const openCamera = async () => {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      setFrames([]);
      setStepAt(0);
      setCount(COUNTDOWN);
      setPhase("camera");
    } catch {
      setError(
        "We couldn't open your camera. Allow camera access for this site, or use a phone with a front camera.",
      );
    }
  };

  // Attach the stream once the <video> is on screen.
  useEffect(() => {
    if (phase === "camera" && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current.play().catch(() => undefined);
    }
  }, [phase]);

  /** One frame as a JPEG, at most `maxWidth` wide (burst frames are smaller). */
  const grab = (maxWidth = 640, quality = 0.85): string | null => {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, maxWidth / v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  };

  const [bursting, setBursting] = useState(false);
  const burst = async (): Promise<string[]> => {
    const shots: string[] = [];
    for (let i = 0; i < BURST_FRAMES; i++) {
      const shot = grab(480, 0.75);
      if (shot) shots.push(shot);
      await new Promise((r) => window.setTimeout(r, BURST_GAP_MS));
    }
    return shots;
  };

  const advance = (next: { step: string; image: string }[]) => {
    setFrames(next);
    if (stepAt + 1 < check.steps!.length) {
      setStepAt(stepAt + 1);
      setCount(COUNTDOWN);
    } else {
      void verify(next);
    }
  };

  // One prompt at a time: count down, take the frame, move on.
  useEffect(() => {
    if (phase !== "camera") return;
    if (count > 0) {
      const t = window.setTimeout(() => setCount((c) => c - 1), 1000);
      return () => window.clearTimeout(t);
    }
    const step = check.steps![stepAt];
    if (step === "blink") {
      if (bursting) return;
      setBursting(true);
      void burst().then((shots) => {
        setBursting(false);
        advance([...frames, ...shots.map((image) => ({ step, image }))]);
      });
      return;
    }
    const image = grab();
    if (!image) {
      setCount(1);
      return;
    }
    advance([...frames, { step, image }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, count]);

  const verify = async (all: { step: string; image: string }[]) => {
    setPhase("checking");
    stop();
    try {
      const result = await submitFaceCheck(check.check!, all);
      setFrames([]);
      if (result.passed && result.face_token) {
        onPassed(result.face_token);
        return;
      }
      setMessages(result.messages ?? []);
      setLeft(result.attempts_left ?? 0);
      setGiveUp(result.give_up ?? null);
      setPhase("failed");
    } catch (err) {
      setFrames([]);
      setMessages([
        err instanceof Error
          ? err.message
          : "The face check failed. Try again.",
      ]);
      setPhase("failed");
    }
  };

  const retry = async () => {
    setError(null);
    try {
      const next = await startFaceCheck(nationalId);
      if (!next.required) return onPassed("");
      setCheck(next);
      setLeft(next.attempts_left ?? null);
      await openCamera();
    } catch (err) {
      setGiveUp(err instanceof Error ? err.message : "Try again later.");
    }
  };

  const steps = check.steps ?? [];

  return (
    <div className="mx-auto max-w-[460px]">
      <h2 className="mt-5 font-display text-[26px] leading-[1.2] font-extrabold tracking-[-0.02em]">
        Confirm it's you
      </h2>

      {phase === "consent" && (
        <>
          <p className="mt-1 text-[15px] text-gdb-ink/65">
            We'll compare a live picture of you with the photo GDB already has
            on record for this ID — then send your code.
          </p>
          <ul className="mt-5 space-y-2 rounded-xl border border-gdb-border bg-gdb-paper px-4 py-3 text-[14px] text-gdb-ink/80">
            <li>• Find good light, and remove a hat or sunglasses.</li>
            <li>
              • You'll look straight at the camera, then do {steps.length - 1}{" "}
              quick things as asked — turn your head, look up or blink.
            </li>
            <li>
              • The pictures are used once for this check and are not kept.
            </li>
          </ul>
          {error && (
            <p
              className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-[14px] font-medium text-red-700"
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void openCamera()}
            className="mt-6 w-full cursor-pointer rounded-xl bg-brand-dark py-3.5 text-[16px] font-extrabold text-white hover:bg-[#071a3d]"
          >
            I agree — open my camera
          </button>
          <button
            type="button"
            onClick={onBack}
            className="mt-3 w-full cursor-pointer border-0 bg-transparent text-[14px] font-bold text-gdb-ink/60 hover:underline"
          >
            Back to my details
          </button>
        </>
      )}

      {phase === "camera" && (
        <>
          <p
            className="mt-1 text-[15px] font-bold text-brand-dark"
            aria-live="polite"
          >
            {PROMPT[steps[stepAt]] ?? "Hold still"}
          </p>
          <div className="relative mt-4 overflow-hidden rounded-2xl bg-black">
            <video
              ref={video}
              playsInline
              muted
              className="aspect-[4/3] w-full -scale-x-100 object-cover"
            />
            {/* The oval to fill, and how long until the picture. */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="h-[72%] w-[48%] rounded-[50%] border-4 border-amber-300/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            <span className="absolute top-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-[20px] font-black text-white">
              {bursting ? "●" : count || "•"}
            </span>
          </div>
          <ol
            className="mt-4 flex justify-center gap-2"
            aria-label="Pictures taken"
          >
            {steps.map((s, i) => (
              <li
                key={s}
                className={`h-2 w-10 rounded-full ${i < stepAt ? "bg-brand" : i === stepAt ? "bg-amber-400" : "bg-gdb-border"}`}
              />
            ))}
          </ol>
        </>
      )}

      {phase === "checking" && (
        <div className="mt-8 flex flex-col items-center gap-3 py-8 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
          <p className="text-[15px] font-bold text-gdb-ink">
            Checking it's you…
          </p>
        </div>
      )}

      {phase === "failed" && (
        <>
          <div
            className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700"
            role="alert"
          >
            {messages.map((m) => (
              <p key={m} className="font-semibold">
                {m}
              </p>
            ))}
          </div>
          {giveUp ? (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] font-semibold text-amber-900">
              {giveUp}
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void retry()}
                className="mt-6 w-full cursor-pointer rounded-xl bg-brand-dark py-3.5 text-[16px] font-extrabold text-white hover:bg-[#071a3d]"
              >
                Try again
              </button>
              {left !== null && (
                <p className="mt-2 text-center text-[13px] text-gdb-ink/55">
                  {left} attempt{left === 1 ? "" : "s"} left
                </p>
              )}
            </>
          )}
          <button
            type="button"
            onClick={onBack}
            className="mt-3 w-full cursor-pointer border-0 bg-transparent text-[14px] font-bold text-gdb-ink/60 hover:underline"
          >
            Back to my details
          </button>
        </>
      )}
    </div>
  );
}
