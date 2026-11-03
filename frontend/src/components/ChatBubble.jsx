import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { translateText } from '../services/translation';

export default function ChatBubble({ message, mine }) {
  const [translated, setTranslated] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [isTranslating, setTranslating] = useState(false);
  const [remaining, setRemaining] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!message.expiresAt) return undefined;
    const update = () => {
      const diff = new Date(message.expiresAt) - new Date();
      if (diff <= 0) { setRemaining("Expired"); return; }
      setRemaining(`${Math.ceil(diff / 1000 / 60)}m`);
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [message.expiresAt]);

  function detectLanguage(text) {
    const hasHindi = /[\u0900-\u097F]/.test(text);
    return hasHindi ? "hi" : "en";
  }

  async function toggleTranslation() {
    if (translated) {
      setShowOriginal(!showOriginal);
      return;
    }
    try {
      setTranslating(true);
      setError("");
      const sourceLang = detectLanguage(message.content);
      const target = sourceLang === "hi" ? "en" : "hi";
      const result = await translateText(message.content, target);
      setTranslated(result);
      setShowOriginal(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className={`message-row ${mine ? 'message-row-mine' : ''}`}>
      <article className={`chat-bubble ${mine ? 'chat-bubble-mine' : ''}`}>
        <p>{showOriginal || !translated ? message.content : translated}</p>
        {translated && (
          <div className="translated-label">
            {showOriginal ? 'Original' : 'Translated to Hindi'}
          </div>
        )}
        {remaining && <span className="expiry">{remaining}</span>}
        <div className="bubble-actions">
          <button type="button" onClick={toggleTranslation} disabled={translating}>
            <Languages size={14} />
            {translating ? ' Translating...' : translated ? (showOriginal ? ' Translated' : ' Original') : ' Translate'}
          </button>
        </div>
        {error && <span className="form-error">{error}</span>}
      </article>
    </div>
  );
}