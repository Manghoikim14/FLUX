import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { translateText } from '../services/translation';

export default function ChatBubble({ message, mine, targetLanguage }) {
  const [translated, setTranslated] = useState('');
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    if (!message.expiresAt) return undefined;
    const update = () => {
      const milliseconds = new Date(message.expiresAt).getTime() - Date.now();
      if (milliseconds <= 0) {
        setRemaining('Expiring');
        return;
      }
      const seconds = Math.ceil(milliseconds / 1000);
      setRemaining(seconds >= 60 ? `${Math.ceil(seconds / 60)}m left` : `${seconds}s left`);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [message.expiresAt]);

  async function toggleTranslation() {
    setError('');
    if (translated) {
      setTranslated('');
      return;
    }
    try {
      setTranslated(await translateText(message.content, targetLanguage));
    } catch (translationError) {
      setError(translationError.message);
    }
  }

  return (
    <div className={`message-row ${mine ? 'message-row-mine' : ''}`}>
      <article className={`chat-bubble ${mine ? 'chat-bubble-mine' : ''}`}>
        <p>{message.content}</p>
        {translated && <p className="translation">{translated}</p>}
        <div className="message-meta">
          <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          {remaining && <span>{remaining}</span>}
          <button type="button" className="translate-button" onClick={toggleTranslation} aria-label="Translate message">
            <Languages size={14} /> {translated ? 'Original' : 'Translate'}
          </button>
        </div>
        {error && <span className="form-error">{error}</span>}
      </article>
    </div>
  );
}
