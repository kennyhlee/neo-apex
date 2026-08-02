import { useEffect, useMemo, useState } from 'react';
import { createEntity, createLead, fetchNextEntityId } from '../api/client.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import DynamicForm from './DynamicForm.tsx';
import type { ModelDefinition, Lead } from '../types/models.ts';
import type { Proposal } from '../api/chat';
import './CreateEntityForm.css';

interface Props {
  proposal: Proposal;
  tenantId: string;
  onDone: (msg: string) => void;
}

const LABELS: Record<string, string> = {
  create_student: 'student',
  create_lead: 'lead',
  create_program: 'program',
};

/** A model containing only the required (or only the optional) fields. */
function splitModel(model: ModelDefinition, required: boolean): ModelDefinition {
  return {
    base_fields: model.base_fields.filter((f) => f.required === required),
    custom_fields: model.custom_fields.filter((f) => f.required === required),
  };
}

/**
 * Model-driven two-step create form rendered inside the chat panel. Step 1
 * collects every required field (pre-filled with whatever the assistant parsed);
 * step 2 collects optional fields. Submitting creates the entity. Nothing is
 * written until the user submits — the form IS the confirmation.
 */
export function CreateEntityForm({ proposal, tenantId, onDone }: Props) {
  const { getModel } = useModel();
  const entityType = proposal.entity_type;
  const label = LABELS[proposal.action] ?? entityType;

  const [model, setModel] = useState<ModelDefinition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState<string[]>([]);
  const [initial, setInitial] = useState<Record<string, unknown>>({ ...proposal.fields });
  const [step, setStep] = useState<'required' | 'optional'>('required');
  const [collected, setCollected] = useState<{
    base: Record<string, unknown>;
    custom: Record<string, unknown>;
  }>({ base: {}, custom: {} });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getModel(tenantId, entityType),
      fetchNextEntityId(tenantId, entityType).catch(() => null),
    ])
      .then(([def, nextId]) => {
        if (!alive) return;
        setModel(def);
        const idField = `${entityType}_id`;
        const hasIdField = [...def.base_fields, ...def.custom_fields].some(
          (f) => f.name === idField,
        );
        if (nextId && hasIdField) {
          setInitial((prev) => ({ ...prev, [idField]: nextId.next_id }));
          setReadOnly([idField]);
        }
      })
      .catch(() => {
        if (alive) setLoadError('Could not load the form for this record type.');
      });
    return () => {
      alive = false;
    };
  }, [getModel, tenantId, entityType]);

  const requiredModel = useMemo(() => (model ? splitModel(model, true) : null), [model]);
  const optionalModel = useMemo(() => (model ? splitModel(model, false) : null), [model]);
  const hasOptional =
    !!optionalModel &&
    optionalModel.base_fields.length + optionalModel.custom_fields.length > 0;

  const create = async (base: Record<string, unknown>, custom: Record<string, unknown>) => {
    setSubmitting(true);
    setError(null);
    try {
      if (entityType === 'lead') {
        await createLead(tenantId, { ...base, ...custom } as Partial<Lead>);
      } else {
        await createEntity(tenantId, entityType, base, custom);
      }
      const summary =
        Object.values(base)
          .filter((v) => typeof v === 'string' && v)
          .slice(0, 3)
          .join(' ') || '(new record)';
      setDone(true);
      onDone(`Created ${label}: ${summary}`);
    } catch {
      setError(`Failed to create ${label}. Please review the fields and try again.`);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="create-form create-form--done" role="status">
        <span aria-hidden="true">✓ </span>{label} created.
      </div>
    );
  }
  if (loadError) {
    return <div className="create-form create-form--error" role="alert">{loadError}</div>;
  }
  if (!model || !requiredModel || !optionalModel) {
    return <div className="create-form" role="status">Loading form…</div>;
  }

  if (step === 'required') {
    return (
      <div className="create-form">
        <div className="create-form__title">New {label} — required details</div>
        {proposal.duplicates.length > 0 && (
          <div className="create-form__warn" role="alert">
            <span aria-hidden="true">⚠ </span>
            {proposal.duplicates.length} possible duplicate {label}(s) already exist.
          </div>
        )}
        <DynamicForm
          modelDefinition={requiredModel}
          initialValues={initial}
          readOnlyFields={readOnly}
          submitting={submitting}
          error={error}
          submitButtonText={hasOptional ? 'Next: optional details' : `Create ${label}`}
          onSubmit={(base, custom) => {
            setCollected({ base, custom });
            if (hasOptional) {
              setInitial((prev) => ({ ...prev, ...base, ...custom }));
              setStep('optional');
            } else {
              void create(base, custom);
            }
          }}
          onCancel={() => onDone('Cancelled.')}
        />
      </div>
    );
  }

  return (
    <div className="create-form">
      <div className="create-form__title">New {label} — additional (optional) details</div>
      <DynamicForm
        modelDefinition={optionalModel}
        initialValues={initial}
        submitting={submitting}
        error={error}
        submitButtonText={`Create ${label}`}
        cancelButtonText="Skip"
        onSubmit={(base, custom) =>
          void create({ ...collected.base, ...base }, { ...collected.custom, ...custom })
        }
        onCancel={() => void create(collected.base, collected.custom)}
      />
    </div>
  );
}
