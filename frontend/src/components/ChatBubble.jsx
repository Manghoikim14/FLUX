import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { translateText } from "../services/translation.js";

export default function ChatBubble({ message, mine }) {
  const [translated, setTranslated] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [remaining, setRemaining] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!message?.expiresAt) return undefined;
    const update = () => {
      const diff = new Date(message.expiresAt) - new Date();
      if (diff <= 0) { setRemaining("Expired"); return; }
      setRemaining(`${Math.ceil(diff / 1000 / 60)}m`);
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [message?.expiresAt]);

  function detectLanguage(text) {
    if (!text) return "en";
    const hasHindi = /[\u0900-\u097F]/.test(text);
    return hasHindi ? "hi" : "en";
  }

  async function toggleTranslation() {
    if (!message?.content) return;
    if (translated) {
      setShowOriginal(!showOriginal);
      return;
    }
    try {
      setIsTranslating(true);
      setError("");
      const sourceLang = detectLanguage(message.content);
      const target = sourceLang === "hi" ? "en" : "hi";
      const result = await translateText(message.content, target);
      setTranslated(result);
      setShowOriginal(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsTranslating(false);
    }
  }

  if (!message) return null;
  const displayText = translated && !showOriginal ? translated : (message.content || "");

  return (
    <div className={`message-row ${mine ? "message-row-mine" : "message-row-theirs"}`}>
      <div className="chat-bubble-wrapper">
        <article className={`chat-bubble ${mine ? "chat-bubble-mine" : "chat-bubble-theirs"}`}>
          <p>{displayText}</p>
          {message.expiresAt && remaining && <span className="expiry">{remaining}</span>}
        </article>
        <button type="button" onClick={toggleTranslation} disabled={isTranslating || !displayText}>
          <Languages size={14} />
          {isTranslating ? ' Translating...' : showOriginal ? ' Original' : translated ? ' Original' : ' Translate'}
        </button>
        {error && <span className="form-error">{error}</span>}
      </div>
    </div>
  );
}