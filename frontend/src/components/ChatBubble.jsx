import { useEffect, useState } from 'react';
import { Languages, Undo2 } from 'lucide-react';
import { translateText } from '../services/translation';

export default function ChatBubble({ message, mine, targetLanguage = "hi" }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [translated, setTranslated] = useState('');
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState('');
    useEffect(() => {
    setTranslated('');
    setShowOriginal(false);
  }, [message.content]);

  useEffect(() => {
    if (!message.expiresAt) return undefined;
    const update = () => {
      const milliseconds = new Date(message.expiresAt).getTime() - Date.now();
      if (milliseconds <= 0) {
        setRemaining('Expiring');
        return;
      }
      const seconds = Math.ceil(milliseconds / 1000);
      setRemaining(`${Math.ceil(seconds / 60)}m ${seconds % 60}s left`);
    };
    const interval = window.setInterval(update, 1000);
    update();
    return () => window.clearInterval(interval);
  }, [message.expiresAt]);

  async function toggleTranslation() {
    if (translated) {
      setShowOriginal(!showOriginal);
      return;
    }
    try {
      setTranslating(true);
      setError('');
      const result = await translateText(message.content, "hi");
      setTranslated(result);
    } catch (translationError) {
      setError(translationError.message);
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className={`message-row ${mine ? 'message-row-mine' : ''}`}>
      <article className={`chat-bubble ${mine ? 'chat-bubble-mine' : ''}`}>
        <p>{showOriginal || !translated ? message.content : translated}</p>
        {remaining && <span className="expiry">{remaining}</span>}
        <div className="bubble-actions">
          <button
            type="button"
            onClick={toggleTranslation}
            disabled={translating}
            aria-label={translating ? 'Translating message' : translated && !showOriginal ? 'Show original message' : 'Translate message'}
            title={translating ? 'Translating message' : translated && !showOriginal ? 'Show original message' : 'Translate message'}
          >
            {translated && !showOriginal ? <Undo2 size={14} /> : <Languages size={14} />}
          </button>
        </div>
        {error && <span className="form-error">{error}</span>}
      </article>
    </div>
  );
}