import { useCallback, useState } from "react";
import "./FileUploader.css";

interface Props {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED = ".pdf,.docx,.txt";

export default function FileUploader({ onFileSelect, disabled }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setSelectedFile(file);
      onFileSelect(file);
    },
    [onFileSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [disabled, handleFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
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
        {selectedFile ? (
          <div className="file-uploader__selected">
            <span className="file-uploader__filename">
              {selectedFile.name}
            </span>
            <span className="file-uploader__size">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </span>
          </div>
        ) : (
          <>
            <p className="file-uploader__text">
              Drop your document here or{" "}
              <label className="file-uploader__browse">
                browse
                <input
                  type="file"
                  accept={ACCEPTED}
                  onChange={handleChange}
                  hidden
                  disabled={disabled}
                />
              </label>
            </p>
            <p className="file-uploader__hint">PDF, DOCX, or TXT</p>
          </>
        )}
      </div>
      <div className="file-uploader__corners">
        <span /><span /><span /><span />
      </div>
    </div>
  );
}
