const languages = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['hi', 'Hindi'],
];

export default function LanguageSelect({ value, onChange, label = 'Language' }) {
  return (
    <label className="language-select">
      <span>{label}</span>
      <select name="language" value={value} onChange={(event) => onChange(event.target.value)}>
        {languages.map(([code, name]) => (
          <option value={code} key={code}>{name}</option>
        ))}
      </select>
    </label>
  );
}
