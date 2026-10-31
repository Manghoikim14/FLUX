const TRANSLATE_URL = import.meta.env.VITE_TRANSLATE_API_URL;

export async function translateText(text, targetLanguage) {
  if (!TRANSLATE_URL) {
    throw new Error('Set VITE_TRANSLATE_API_URL to enable translation.');
  }

  const response = await fetch(TRANSLATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: 'auto', target: targetLanguage, format: 'text' }),
  });
  const result = await response.json();
  if (!response.ok || typeof result.translatedText !== 'string') {
    throw new Error(result.error || 'Translation failed.');
  }
  return result.translatedText;
}
