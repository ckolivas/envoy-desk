import { ImagePlus, Send } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ComposeBox({
  placeholder,
  onSend,
  allowImages,
  disabled,
  hint,
}: {
  placeholder: string;
  onSend: (text: string, files: File[]) => void;
  allowImages?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function submit() {
    if (disabled) return;
    if (!text.trim() && files.length === 0) return;
    onSend(text, files);
    setText("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <form
      className="border-t border-fg/10 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {files.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <li
              key={f.name + f.size}
              className="rounded-sm bg-elevated px-2 py-1 font-mono text-2xs text-muted"
            >
              {f.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-end gap-2">
        {allowImages ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              disabled={disabled}
              aria-label="Attach image"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="size-4" />
            </Button>
          </>
        ) : (
          <span className="size-11 shrink-0" aria-hidden />
        )}
        <textarea
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            if (!allowImages) return;
            const pasted = Array.from(e.clipboardData.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (pasted.length) setFiles((cur) => [...cur, ...pasted]);
          }}
          rows={1}
          placeholder={placeholder}
          className={cn(
            "max-h-28 min-h-11 flex-1 resize-none rounded-md bg-elevated px-3 py-2.5 text-sm text-fg",
            "placeholder:text-subtle shadow-[var(--shadow-border)]",
            "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-bg),0_0_0_4px_var(--color-fg)]",
            "disabled:opacity-40",
          )}
        />
        <Button type="submit" size="icon" disabled={disabled} aria-label="Send">
          <Send className="size-4" />
        </Button>
      </div>
      {hint ? <p className="mt-2 px-1 text-xs text-subtle">{hint}</p> : null}
    </form>
  );
}
