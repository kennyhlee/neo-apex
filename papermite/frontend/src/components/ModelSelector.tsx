interface Props {
  models: string[];
  selected: string;
  onChange: (model: string) => void;
}

function formatModelName(id: string): string {
  const parts = id.split(":");
  const provider = parts[0];
  const model = parts.slice(1).join(":");
  const icons: Record<string, string> = {
    anthropic: "A",
    openai: "O",
    ollama: "L",
  };
  return `${icons[provider] || "?"} ${model}`;
}

export default function ModelSelector({ models, selected, onChange }: Props) {
  return (
    <div className="model-selector">
      <label className="model-selector__label">LLM Model</label>
      <select
        className="select"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
      >
        {models.map((m) => (
          <option key={m} value={m}>
            {formatModelName(m)}
          </option>
        ))}
      </select>
    </div>
  );
}
