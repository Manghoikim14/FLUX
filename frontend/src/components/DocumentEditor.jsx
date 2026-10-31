import { useEffect, useState } from 'react';

export default function DocumentEditor({ socket, peerId, onClose }) {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    socket.emit('document:join', { peerId }, (result) => {
      if (result.error) setError(result.error);
      else setContent(result.content);
    });
    const onUpdated = (update) => setContent(update.content);
    socket.on('document:updated', onUpdated);
    return () => socket.off('document:updated', onUpdated);
  }, [socket, peerId]);

  function updateContent(value) {
    setContent(value);
    socket.emit('document:update', { peerId, content: value }, (result) => {
      if (result.error) setError(result.error);
      else setError('');
    });
  }

  return (
    <section className="document-panel">
      <div className="section-heading">
        <div>
          <h3>Shared notes</h3>
          <p>Changes are saved and shared live.</p>
        </div>
        <button type="button" className="text-button" onClick={onClose}>Close</button>
      </div>
      <textarea
        aria-label="Collaborative document"
        value={content}
        onChange={(event) => updateContent(event.target.value)}
        maxLength={20000}
        placeholder="Write something together..."
      />
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
