import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { translateText } from "../services/translation.js";

export default function ChatBubble({ message, mine, peerName = '' }) {
  const [translated, setTranslated] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    if (!message?.expiresAt) return undefined;
    const update = () => {
      const diff = new Date(message.expiresAt) - new Date();
      if (diff <= 0) { setRemaining("Expired"); return; }
      setRemaining(`${Math.ceil(diff / 1000 / 60)}m`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [message?.expiresAt]);

  async function toggleTranslation() {
    if (!message?.content) return;
    if (translated) {
      setShowOriginal(v => !v);
      return;
    }
    try {
      setIsTranslating(true);
      const isHindi = /[\u0900-\u097F]/.test(message.content);
      const target = isHindi ? "en" : "hi";
      const result = await translateText(message.content, target);
      setTranslated(result);
    } finally {
      setIsTranslating(false);
    }
  }

  if (!message) return null;
  const displayText = translated && !showOriginal ? translated : message.content;

  return (
    <div className={`message-row ${mine ? "message-row-mine" : "message-row-theirs"}`}>
      {!mine && (
        <span className="conversation-message-avatar" aria-hidden="true">
          {peerName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="chat-bubble-wrapper">
        <article className={`chat-bubble ${mine ? "chat-bubble-mine" : "chat-bubble-theirs"}`}>
          <p>{displayText}</p>
          {message.expiresAt && remaining && <span className="expiry">{remaining}</span>}
          <div className="message-meta">
            {mine && message.readAt && (
              <span className="message-read-receipt" title="Seen" aria-label="Seen">
                👁️
              </span>
            )}
            <button
              type="button"
              className="translate-button"
              onClick={toggleTranslation}
              disabled={isTranslating}
              aria-label={isTranslating ? "Translation in progress" : translated ? (showOriginal ? "Show translation" : "Show original") : "Translate message"}
            >
              <Languages size={14} />
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}