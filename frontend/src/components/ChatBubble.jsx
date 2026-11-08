import { useRef, useState } from "react";
import { Copy, Forward, Info, Languages, Reply, Trash2, X } from "lucide-react";
import { translateText } from "../services/translation.js";

export default function ChatBubble({
  message,
  mine,
  onReply,
  onCopy,
  onForward,
  onInfo,
  onDelete,
}) {
  const [translated, setTranslated] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const pressTimer = useRef(null);

  function cancelLongPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function startLongPress(event) {
    if (event.target.closest("button")) return;
    cancelLongPress();
    pressTimer.current = setTimeout(() => setShowActions(true), 500);
  }

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
      <div
        className={`chat-bubble-wrapper message-context-anchor ${showActions ? "has-context-menu" : ""}`}
        onContextMenu={(event) => {
          event.preventDefault();
          setShowActions(true);
        }}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
      >
        <article className={`chat-bubble ${mine ? "chat-bubble-mine" : "chat-bubble-theirs"}`}>
          {message.replyToContent && (
            <blockquote className="message-reply-quote">{message.replyToContent}</blockquote>
          )}
          {message.forwarded && <span className="message-forwarded-label">Forwarded</span>}
          <p>{displayText}</p>
          <div className="message-meta">
            {mine && message.scheduledFor && (
              <span className="message-scheduled-status">
                Scheduled for {new Date(message.scheduledFor).toLocaleString()}
              </span>
            )}
            {mine && message.expiresAt && (
              <span className="message-expiry-status">
                Scheduled to delete at {new Date(message.expiresAt).toLocaleString()}
              </span>
            )}
            {mine && message.readAt && (
              <span className="message-read-receipt" title="Seen" aria-label="Seen">
                👁️
              </span>
            )}
            <button
              type="button"
              className="translate-button"
              onPointerDown={cancelLongPress}
              onClick={toggleTranslation}
              disabled={isTranslating}
              aria-label={isTranslating ? "Translation in progress" : translated ? (showOriginal ? "Show translation" : "Show original") : "Translate message"}
            >
              <Languages size={14} />
            </button>
            <time className="message-timestamp" dateTime={message.createdAt}>
              {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </time>
          </div>
        </article>
        {showActions && (
          <div className="message-context-menu" role="menu" aria-label="Message actions">
            <button type="button" role="menuitem" onClick={() => { onReply(message); setShowActions(false); }}>
              <Reply size={15} /> Reply
            </button>
            <button type="button" role="menuitem" onClick={() => { onCopy(message); setShowActions(false); }}>
              <Copy size={15} /> Copy
            </button>
            <button type="button" role="menuitem" onClick={() => { onForward(message); setShowActions(false); }}>
              <Forward size={15} /> Forward
            </button>
            <button type="button" role="menuitem" onClick={() => { onInfo(message); setShowActions(false); }}>
              <Info size={15} /> Info
            </button>
            <div className="message-context-divider" />
            <button type="button" role="menuitem" className="message-context-delete" onClick={() => { onDelete(message, false); setShowActions(false); }}>
              <Trash2 size={15} /> Delete for me
            </button>
            {mine && (
              <button type="button" role="menuitem" className="message-context-delete" onClick={() => { onDelete(message, true); setShowActions(false); }}>
                <Trash2 size={15} /> Delete for everyone
              </button>
            )}
            <button type="button" role="menuitem" className="message-context-close" onClick={() => setShowActions(false)}>
              <X size={15} /> Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}