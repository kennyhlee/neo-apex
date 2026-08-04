// flow-runtime/src/blocks/DocumentsBlock.tsx
import { useRef, useState } from 'react';
import type { ApplicationItem, FlowBlock, FlowMode, RequiredDoc } from '../types';
import { docsOf } from '../blockConfig';
import { useFlowT } from '../i18n';

export interface DocumentsBlockProps {
  block: FlowBlock;
  items: ApplicationItem[];
  mode: FlowMode;
  onUpload: (blockId: string, doc: RequiredDoc, file: File) => Promise<void>;
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.docx';

export function DocumentsBlock({ block, items, mode, onUpload }: DocumentsBlockProps) {
  const t = useFlowT();
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const docs = docsOf(block);

  const itemFor = (doc: RequiredDoc) =>
    items.find((i) => i.title === doc.name) ?? null;

  const handleFile = async (doc: RequiredDoc, file: File | undefined) => {
    if (!file || mode === 'preview') return;
    setUploadingDoc(doc.name);
    try {
      await onUpload(block.block_id, doc, file);
    } finally {
      setUploadingDoc(null);
    }
  };

  if (docs.length === 0) return <p className="fr-empty">{t('noFields')}</p>;

  return (
    <ul className="fr-doc-list">
      {docs.map((doc) => {
        const item = itemFor(doc);
        const status = item?.status ?? 'not_started';
        const done = status === 'submitted' || status === 'verified' || status === 'waived';
        return (
          <li key={doc.name} className="fr-doc-row">
            <div className="fr-doc-info">
              <strong>{doc.name}</strong>
              {doc.description && <p>{doc.description}</p>}
              <div className="fr-doc-flags">
                {doc.sensitive && <span className="fr-doc-flag">{t('sensitiveDoc')}</span>}
                {!doc.blocking && <span className="fr-doc-flag">{t('postApproval')}</span>}
              </div>
            </div>
            <span className={`fr-item-status fr-item-status--${status}`}>
              {t(`status.${status}`)}
            </span>
            <input
              ref={(el) => { inputRefs.current[doc.name] = el; }}
              className="fr-hidden-input"
              type="file"
              accept={ACCEPT}
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                void handleFile(doc, e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="fr-btn"
              disabled={uploadingDoc !== null || mode === 'preview'}
              aria-label={`${done ? t('replace') : t('upload')} — ${doc.name}`}
              onClick={() => inputRefs.current[doc.name]?.click()}
            >
              {uploadingDoc === doc.name
                ? t('uploading')
                : done ? t('replace') : t('upload')}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
