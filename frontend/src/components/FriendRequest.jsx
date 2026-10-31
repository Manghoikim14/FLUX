import { useState } from 'react';
import { UserPlus } from 'lucide-react';

export default function FriendRequest({ onSubmit }) {
  const [friendCode, setFriendCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit(friendCode.trim().toUpperCase());
      setFriendCode('');
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="friend-form" onSubmit={submit}>
      <label htmlFor="friend-code">Add a friend by code</label>
      <div className="inline-form">
        <input
          id="friend-code"
          value={friendCode}
          onChange={(event) => setFriendCode(event.target.value.toUpperCase())}
          placeholder="8-character code"
          maxLength={8}
          required
        />
        <button className="icon-button" disabled={busy} aria-label="Send friend request">
          <UserPlus size={18} />
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
