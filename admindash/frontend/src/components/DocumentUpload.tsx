import { useState, useRef } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import './DocumentUpload.css';

const ACCEPTED_FORMATS = ['.pdf', '.png', '.jpg', '.jpeg'];
const ACCEPTED_MIME = ['application/pdf', 'image/png', 'image/jpeg'];

interface DocumentUploadProps {
  onExtracted: (fields: Record<string, string>) => void;
  onUpload: (file: File) => Promise<Record<string, string>>;
}

export default function DocumentUpload({ onExtracted, onUpload }: DocumentUploadProps) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): boolean => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ACCEPTED_FORMATS.includes(ext) && !ACCEPTED_MIME.includes(file.type)) {
      setError(t('addStudent.unsupportedFormat'));
      return false;
    }
    return true;
  };

  const handleFile = async (file: File) => {
    setError(null);
    if (!validateFile(file)) return;

    setFileName(file.name);
    setUploading(true);
    try {
      const fields = await onUpload(file);
      onExtracted(fields);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="document-upload">
      <div
        className={`document-upload-dropzone ${dragging ? 'dragging' : ''} ${uploading ? 'uploading' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_FORMATS.join(',')}
          onChange={handleSelect}
          style={{ display: 'none' }}
        />
        {uploading ? (
          <div className="document-upload-status">
            <div className="document-upload-spinner" />
            <p>{t('addStudent.extracting')}</p>
            {fileName && <p className="document-upload-filename">{fileName}</p>}
          </div>
        ) : (
          <div className="document-upload-prompt">
            <p className="document-upload-title">{t('addStudent.dropOrClick')}</p>
            <p className="document-upload-hint">{t('addStudent.supportedFormats')}</p>
          </div>
        )}
      </div>
      {error && <div className="document-upload-error">{error}</div>}
    </div>
  );
}
