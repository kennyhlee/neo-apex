import { useCallback, useState } from "react";
import "./FileUploader.css";

interface Props {
  /** Called whenever the selected file set changes. */
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPTED = ".pdf,.docx,.txt";

export default function FileUploader({ onFilesChange, disabled }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const addFiles = useCallback(
    (incoming: File[]) => {
      setFiles((prev) => {
        // De-dupe by name + size so re-dropping the same file is a no-op.
        const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
        const next = [...prev];
        for (const f of incoming) {
          const key = `${f.name}:${f.size}`;
          if (!seen.has(key)) {
            seen.add(key);
            next.push(f);
          }
        }
        onFilesChange(next);
        return next;
      });
    },
    [onFilesChange]
  );

  const removeFile = useCallback(
    (index: number) => {
      setFiles((prev) => {
        const next = prev.filter((_, i) => i !== index);
        onFilesChange(next);
        return next;
      });
    },
    [onFilesChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length) addFiles(dropped);
    },
    [disabled, addFiles]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(e.target.files ?? []);
      if (picked.length) addFiles(picked);
      // Reset so selecting the same file again still fires change.
      e.target.value = "";
    },
    [addFiles]
  );

  return (
    <div
      className={`file-uploader ${dragOver ? "file-uploader--active" : ""} ${disabled ? "file-uploader--disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="file-uploader__inner">
        <div className="file-uploader__icon">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <polyline points="9 15 12 12 15 15" />
          </svg>
        </div>
        {files.length > 0 ? (
          <div className="file-uploader__list">
            {files.map((file, i) => (
              <div key={`${file.name}:${file.size}`} className="file-uploader__selected">
                <span className="file-uploader__filename">{file.name}</span>
                <span className="file-uploader__size">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
                {!disabled && (
                  <button
                    type="button"
                    className="file-uploader__remove"
                    onClick={() => removeFile(i)}
                    title="Remove file"
                    aria-label={`Remove ${file.name}`}
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
            {!disabled && (
              <label className="file-uploader__add-more">
                + Add more files
                <input
                  type="file"
                  accept={ACCEPTED}
                  multiple
                  onChange={handleChange}
                  hidden
                  disabled={disabled}
                />
              </label>
            )}
          </div>
        ) : (
          <>
            <p className="file-uploader__text">
              Drop your documents here or{" "}
              <label className="file-uploader__browse">
                browse
                <input
                  type="file"
                  accept={ACCEPTED}
                  multiple
                  onChange={handleChange}
                  hidden
                  disabled={disabled}
                />
              </label>
            </p>
            <p className="file-uploader__hint">
              PDF, DOCX, or TXT — one or more files
            </p>
          </>
        )}
      </div>
      <div className="file-uploader__corners">
        <span /><span /><span /><span />
      </div>
    </div>
  );
}
